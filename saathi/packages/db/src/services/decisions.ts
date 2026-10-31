import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  ActionType,
  DEVICE_ACTION_PARAMS,
  isDeviceAction,
  msg,
  SaathiError,
  type ActionDetailDTO,
  type ActionOption,
  type ActionState,
  type ContainmentAssessment,
  type Msg,
  type PreviewContent,
  type PreviewDTO,
  type ProbeDTO,
} from '@saathi/contracts';
import {
  computePreview,
  expectedPostconditions,
  guardKeysFor,
  PREVIEW_TTL_SECONDS,
  recommendOptions,
  relevantStateHash,
  type ActionSpec,
  type Objective,
  type VerifiedRestriction,
} from '@saathi/domain';
import { CommitThenThrow, type Db } from '../client';
import { actionProbes, actions, agentCommands, appSessions, deviceChanges, devices, evidenceIntents, incidentFindings, incidentHistory, incidents, previews, restrictions, staff } from '../schema';
import { bumpGuards, enqueue, lockGuards, recordIntent, requireMembership, type Actor } from './core';
import { gatewayDecide } from './gateway';
import { findingFromRow, reassessIncident } from './incidents';
import { deviceFreshness, loadSnapshot } from './snapshot';

const PEOPLE_ACTIONS = ['records.pause_session', 'records.disable_account', 'records.offboard_subject'] as const;

function validateSpec(spec: ActionSpec) {
  const t = ActionType.safeParse(spec.actionType);
  if (!t.success) throw new SaathiError('UNSUPPORTED_ACTION', 'This action is not supported.');
  const expectedTarget = spec.actionType === 'records.pause_session' ? 'session' : isDeviceAction(spec.actionType) ? 'device' : 'subject';
  if (spec.targetType !== expectedTarget) throw new SaathiError('VALIDATION_FAILED', 'The action does not match its target.');
  if (isDeviceAction(spec.actionType)) {
    const p = DEVICE_ACTION_PARAMS[spec.actionType].safeParse(spec.params);
    if (!p.success) throw new SaathiError('VALIDATION_FAILED', 'The action parameters are outside the supported bounds.');
  } else if (Object.keys(spec.params).length > 0) throw new SaathiError('VALIDATION_FAILED', 'This action takes no parameters.');
}

function objectiveFor(incidentFindingsList: ReturnType<typeof findingFromRow>[], spec: ActionSpec): Objective {
  const f = incidentFindingsList.find((x) => x.status === 'open' && x.target.type === 'session');
  return f && !isDeviceAction(spec.actionType) ? { capability: f.harmfulCapability, targetType: 'session', targetId: f.target.id } : null;
}

/**
 * Create and persist a consequence preview (build.md Ph07.5). Incident previews accept only
 * options the server itself derived for that incident; standalone previews accept the
 * people/device action set for an existing target.
 */
export async function createPreview(db: Db, actor: Actor, spec: ActionSpec, incidentId: string | null, now = new Date()): Promise<{ previewId: string }> {
  await requireMembership(db, actor, incidentId ? 'incidents.preview' : 'people.preview');
  validateSpec(spec);
  const snapshot = await loadSnapshot(db, actor.orgId, now);
  let objective: Objective = null;
  if (incidentId) {
    const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId)));
    if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
    if (['dismissed', 'recovered'].includes(inc.state)) throw new SaathiError('CONFLICT', 'This incident is closed.');
    const findings = (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, inc.id))).map(findingFromRow);
    const { options } = recommendOptions(snapshot, findings, now.toISOString());
    const allowed = options.some((o) => o.actionType === spec.actionType && o.targetId === spec.targetId && JSON.stringify(o.params) === JSON.stringify(spec.params));
    if (!allowed) throw new SaathiError('UNSUPPORTED_ACTION', 'That response is not available for this incident.');
    objective = objectiveFor(findings, spec);
  } else if (!isDeviceAction(spec.actionType) && !(PEOPLE_ACTIONS as readonly string[]).includes(spec.actionType)) {
    throw new SaathiError('UNSUPPORTED_ACTION', 'That response is not available here.');
  }
  // Target must exist in this organization's snapshot (no cross-tenant references).
  const exists =
    spec.targetType === 'session' ? snapshot.sessions.some((s) => s.id === spec.targetId) : spec.targetType === 'subject' ? snapshot.subjects.some((s) => s.id === spec.targetId) : snapshot.devices.some((d) => d.id === spec.targetId);
  if (!exists) throw new SaathiError('NOT_FOUND', 'The selected target was not found.');

  const at = now.toISOString();
  const content = computePreview(snapshot, spec, objective, at);
  const [p] = await db
    .insert(previews)
    .values({
      orgId: actor.orgId,
      incidentId,
      actorUserId: actor.userId,
      actionType: spec.actionType,
      targetType: spec.targetType,
      targetId: spec.targetId,
      params: spec.params,
      stateHash: relevantStateHash(snapshot, spec, at),
      policyVersion: snapshot.policyVersion,
      guardKeys: guardKeysFor(snapshot, spec),
      content,
      observedAt: now,
      expiresAt: new Date(now.getTime() + PREVIEW_TTL_SECONDS * 1000),
    })
    .returning({ id: previews.id });
  if (incidentId) {
    await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId, kind: 'preview_created', text: msg('history.preview_created', { action: spec.actionType }), actorUserId: actor.userId, at: now });
    await reassessIncident(db, actor.orgId, incidentId, { previewCreated: true, at: now });
  }
  await recordIntent(db, actor.orgId, 'preview.created', { previewId: p.id, actionType: spec.actionType, targetType: spec.targetType, targetId: spec.targetId, params: spec.params, policyVersion: snapshot.policyVersion, by: actor.userId }, { incidentId });
  return { previewId: p.id };
}

export async function getPreview(db: Db, actor: Actor, previewId: string, now = new Date()): Promise<PreviewDTO> {
  const { role } = await requireMembership(db, actor, 'actions.read');
  const [p] = await db.select().from(previews).where(and(eq(previews.orgId, actor.orgId), eq(previews.id, previewId)));
  if (!p) throw new SaathiError('NOT_FOUND', 'Preview not found.');
  const [a] = await db.select({ id: actions.id }).from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.previewId, p.id)));
  const content = p.content as PreviewContent;
  const expired = p.status === 'active' && p.expiresAt.getTime() <= now.getTime();
  const status = expired ? 'expired' : (p.status as PreviewDTO['status']);
  let alternatives: ActionOption[] = [];
  if (p.incidentId) {
    const findings = (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, p.incidentId))).map(findingFromRow);
    alternatives = recommendOptions(await loadSnapshot(db, actor.orgId, now), findings, now.toISOString()).options;
  }
  let approveBlockedReason: Msg | null = null;
  if (!['owner', 'approver'].includes(role)) approveBlockedReason = msg('approve.blocked.role');
  else if (p.actorUserId !== actor.userId) approveBlockedReason = msg('approve.blocked.other_actor');
  else if (status !== 'active') approveBlockedReason = msg(`approve.blocked.${status}`);
  else if (!content.supported) approveBlockedReason = content.unsupportedReason ?? msg('approve.blocked.unsupported');
  else if (content.targetType === 'device') {
    const [d] = await db.select().from(devices).where(and(eq(devices.orgId, actor.orgId), eq(devices.id, content.targetId)));
    if (!d || deviceFreshness(d.lastSeenAt, now) !== 'fresh') approveBlockedReason = msg('approve.blocked.device_offline', { lastSeen: d?.lastSeenAt?.toISOString() ?? '' });
  }
  return {
    id: p.id,
    incidentId: p.incidentId,
    createdAt: p.createdAt.toISOString(),
    expiresAt: p.expiresAt.toISOString(),
    status,
    observedAt: p.observedAt.toISOString(),
    content,
    actionId: a?.id ?? null,
    canApprove: approveBlockedReason === null,
    approveBlockedReason,
    alternatives,
  };
}

/**
 * Transactional approval (build.md Ph08). The browser sends only previewId + idempotency
 * key. Under the guard protocol we recheck authority, expiry, actor binding and the
 * relevant state hash. Any relevant change → 409 STALE_PREVIEW and no action.
 */
export async function approvePreview(db: Db, actor: Actor, previewId: string, idempotencyKey: string, now = new Date()): Promise<{ actionId: string; duplicate: boolean }> {
  await requireMembership(db, actor, 'actions.approve');
  const [byKey] = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.idempotencyKey, idempotencyKey)));
  if (byKey) {
    if (byKey.previewId !== previewId) throw new SaathiError('CONFLICT', 'This request key was already used for a different approval.');
    return { actionId: byKey.id, duplicate: true };
  }
  const [peek] = await db.select().from(previews).where(and(eq(previews.orgId, actor.orgId), eq(previews.id, previewId)));
  if (!peek) throw new SaathiError('NOT_FOUND', 'Preview not found.');
  await lockGuards(db, actor.orgId, peek.guardKeys, 'share');
  const [p] = await db.select().from(previews).where(eq(previews.id, previewId)).for('update');
  const [existing] = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.previewId, previewId)));
  if (existing) return { actionId: existing.id, duplicate: true };

  const stale = async (reason: string, status: 'stale' | 'expired' = 'stale') => {
    await db.update(previews).set({ status }).where(eq(previews.id, p.id));
    await recordIntent(db, actor.orgId, 'approval.rejected', { previewId: p.id, reason, by: actor.userId }, { incidentId: p.incidentId });
    return new SaathiError('STALE_PREVIEW', 'The situation changed. Review the updated effects.', { reason, previewId: p.id });
  };
  if (p.status !== 'active') throw new SaathiError('STALE_PREVIEW', 'This preview can no longer be approved. Review the updated effects.', { reason: p.status, previewId: p.id });
  if (p.expiresAt.getTime() <= now.getTime()) throw await commitThen(stale('expired', 'expired'));
  if (p.actorUserId !== actor.userId) throw new SaathiError('STALE_PREVIEW', 'Review the effects yourself before approving.', { reason: 'other_actor', previewId: p.id });

  const spec: ActionSpec = { actionType: p.actionType as ActionSpec['actionType'], targetType: p.targetType as ActionSpec['targetType'], targetId: p.targetId, params: p.params as ActionSpec['params'] };
  const snapshot = await loadSnapshot(db, actor.orgId, now);
  const at = now.toISOString();
  if (snapshot.policyVersion !== p.policyVersion) throw await commitThen(stale('policy_changed'));
  if (relevantStateHash(snapshot, spec, at) !== p.stateHash) throw await commitThen(stale('state_changed'));
  const content = p.content as PreviewContent;
  if (!content.supported) throw new SaathiError('UNSUPPORTED_ACTION', 'This action is not supported for the selected target.');

  let deviceId: string | null = null;
  let simulated = false;
  if (isDeviceAction(spec.actionType)) {
    const [d] = await db.select().from(devices).where(and(eq(devices.orgId, actor.orgId), eq(devices.id, spec.targetId)));
    if (!d || d.status !== 'connected' || deviceFreshness(d.lastSeenAt, now) !== 'fresh') {
      throw new SaathiError('DEVICE_OFFLINE', `Device offline. Last seen ${d?.lastSeenAt?.toISOString() ?? 'never'}.`, { lastSeenAt: d?.lastSeenAt?.toISOString() ?? null });
    }
    deviceId = d.id;
    simulated = d.simulated;
  }

  const expected = expectedPostconditions(snapshot, spec, at);
  const [a] = await db
    .insert(actions)
    .values({
      orgId: actor.orgId,
      previewId: p.id,
      idempotencyKey,
      incidentId: p.incidentId,
      actorUserId: actor.userId,
      actionType: spec.actionType,
      targetType: spec.targetType,
      targetId: spec.targetId,
      params: spec.params,
      state: deviceId ? 'queued' : 'requested',
      expectedPostconditions: expected,
      boundaries: content.cannotControl,
      deviceId,
      simulated,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: actions.id });
  await db.update(previews).set({ status: 'consumed' }).where(eq(previews.id, p.id));

  if (!deviceId) await applyRecordsAction(db, actor.orgId, a.id, spec, p.incidentId, now);
  else {
    await db.insert(agentCommands).values({
      orgId: actor.orgId,
      deviceId,
      actionId: a.id,
      type: spec.actionType,
      params: spec.params,
      expectedStateHash: p.stateHash,
      nonce: randomBytes(18).toString('base64url'),
    });
    await enqueue(db, { orgId: actor.orgId, type: 'command.sign', payload: { actionId: a.id }, dedupeKey: `command.sign:${a.id}` });
  }
  await bumpGuards(db, actor.orgId, peek.guardKeys);
  if (p.incidentId) await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId: p.incidentId, kind: 'action_approved', text: msg('history.action_approved', { action: spec.actionType }), actorUserId: actor.userId, actionId: a.id, at: now });
  // Fallback probe job: durable even if this request ends before the inline probe runs.
  if (!deviceId) await enqueue(db, { orgId: actor.orgId, type: 'action.probe', payload: { actionId: a.id }, dedupeKey: `action.probe:${a.id}`, runAt: new Date(now.getTime() + 3000) });
  else await enqueue(db, { orgId: actor.orgId, type: 'command.expire', payload: { actionId: a.id }, dedupeKey: `command.expire:${a.id}`, runAt: new Date(now.getTime() + 5 * 60 * 1000) });
  await recordIntent(db, actor.orgId, 'action.approved', { actionId: a.id, previewId: p.id, actionType: spec.actionType, targetType: spec.targetType, targetId: spec.targetId, params: spec.params, by: actor.userId, device: !!deviceId }, { incidentId: p.incidentId });
  return { actionId: a.id, duplicate: false };
}

async function commitThen(p: Promise<SaathiError>): Promise<CommitThenThrow> {
  return new CommitThenThrow(await p);
}

async function applyRecordsAction(db: Db, orgId: string, actionId: string, spec: ActionSpec, incidentId: string | null, now: Date) {
  if (spec.actionType === 'records.pause_session') {
    await db.insert(restrictions).values({ orgId, targetType: 'session', targetId: spec.targetId, kind: 'pause', source: 'action', actionId, incidentId, startsAt: now });
  } else if (spec.actionType === 'records.disable_account') {
    await db.insert(restrictions).values({ orgId, targetType: 'subject', targetId: spec.targetId, kind: 'disable_account', source: 'action', actionId, incidentId, startsAt: now });
  } else if (spec.actionType === 'records.offboard_subject') {
    await db.update(staff).set({ status: 'offboarded', offboardedAt: now }).where(and(eq(staff.orgId, orgId), eq(staff.id, spec.targetId)));
    await db
      .update(appSessions)
      .set({ status: 'revoked', revokedAt: now, revokedReason: 'offboarded' })
      .where(and(eq(appSessions.orgId, orgId), eq(appSessions.staffId, spec.targetId), eq(appSessions.status, 'active')));
  }
  await db.update(actions).set({ state: 'executing', updatedAt: now }).where(eq(actions.id, actionId));
}

type Decider = typeof gatewayDecide;

/**
 * Side-effect-free probe of committed authorization (build.md Ph08.5). Never downloads
 * private data. `decide` is injectable so tests can simulate an enforcement failure.
 */
export async function probeRecordsAction(db: Db, orgId: string, actionId: string, opts: { decide?: Decider; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const decide = opts.decide ?? gatewayDecide;
  const [a] = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.id, actionId))).for('update');
  if (!a || isDeviceAction(a.actionType as ActionSpec['actionType'])) return null;
  if (!['requested', 'executing', 'unknown'].includes(a.state)) return a.state as ActionState;
  const expected = a.expectedPostconditions as ReturnType<typeof expectedPostconditions>;
  const sessions = await db.select({ id: appSessions.id, staffId: appSessions.staffId, label: appSessions.label }).from(appSessions).where(eq(appSessions.orgId, orgId));
  let targetOk = true;
  let unaffectedOk = true;
  let anyTarget = false;
  for (const e of expected) {
    const sess = sessions.find((s) => s.id === e.sessionId);
    if (!sess) continue;
    const r = await decide(db, { orgId, sessionId: sess.id, staffId: sess.staffId }, { capability: 'records.download', recordId: null, probe: true }, now);
    const pass = r.decision === e.expected;
    if (e.kind === 'target_denied') {
      anyTarget = true;
      if (!pass) targetOk = false;
    } else if (!pass) unaffectedOk = false;
    await db.insert(actionProbes).values({
      orgId,
      actionId,
      kind: e.kind,
      label: msg(`probe.${e.kind}`, { session: sess.label }),
      expected: e.expected,
      observed: r.decision,
      result: pass ? 'pass' : 'fail',
      checkedAt: now,
      source: 'records_gateway_policy_check',
    });
  }
  const state: ActionState = !anyTarget ? 'unknown' : targetOk && unaffectedOk ? 'confirmed' : targetOk ? 'partial' : 'failed';
  const coversTargets: VerifiedRestriction['coversTargets'] = targetOk && anyTarget ? [{ type: a.targetType as 'session' | 'subject', id: a.targetId, capability: 'records.*' }] : [];
  await db
    .update(actions)
    .set({ state, result: { coversTargets, probedAt: now.toISOString() }, updatedAt: now, completedAt: state === 'unknown' ? null : now })
    .where(eq(actions.id, actionId));
  if (a.incidentId) {
    await db.insert(incidentHistory).values({ orgId, incidentId: a.incidentId, kind: 'action_outcome', text: msg('history.action_outcome', { action: a.actionType, state }), actionId, at: now });
    await reassessIncident(db, orgId, a.incidentId, { at: now });
  }
  await recordIntent(db, orgId, 'action.outcome_observed', { actionId, state, probes: expected.length, method: 'records_gateway_policy_check' }, { incidentId: a.incidentId });
  return state;
}

export async function getActionDetail(db: Db, actor: Actor, actionId: string, now = new Date()): Promise<ActionDetailDTO> {
  await requireMembership(db, actor, 'actions.read');
  const [a] = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.id, actionId)));
  if (!a) throw new SaathiError('NOT_FOUND', 'Action not found.');
  const probes = await db.select().from(actionProbes).where(eq(actionProbes.actionId, a.id)).orderBy(actionProbes.checkedAt);
  const [p] = await db.select().from(previews).where(eq(previews.id, a.previewId));
  const content = p?.content as PreviewContent | undefined;
  let containment: ContainmentAssessment | null = null;
  let remaining: ActionDetailDTO['remainingFindings'] = [];
  if (a.incidentId) {
    const [inc] = await db.select().from(incidents).where(eq(incidents.id, a.incidentId));
    containment = (inc?.containment as ContainmentAssessment) ?? null;
    remaining = (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, a.incidentId))).map(findingFromRow).filter((f) => f.status === 'open');
  }
  let device: ActionDetailDTO['device'] = null;
  let command: ActionDetailDTO['command'] = null;
  if (a.deviceId) {
    const [d] = await db.select().from(devices).where(eq(devices.id, a.deviceId));
    if (d) device = { id: d.id, name: d.name, freshness: deviceFreshness(d.lastSeenAt, now), lastSeenAt: d.lastSeenAt?.toISOString() ?? null, simulated: d.simulated };
    const [c] = await db.select().from(agentCommands).where(eq(agentCommands.actionId, a.id));
    if (c) command = { status: c.status, issuedAt: c.issuedAt?.toISOString() ?? null, expiresAt: c.expiresAt?.toISOString() ?? null, deliveredAt: c.deliveredAt?.toISOString() ?? null };
  }
  const state = a.state as ActionState;
  const nextSteps: ActionDetailDTO['nextSteps'] = [];
  if (['requested', 'queued', 'executing', 'unknown'].includes(state)) nextSteps.push('check_status');
  if (['partial', 'failed', 'expired', 'cancelled'].includes(state)) nextSteps.push('fresh_preview');
  if (state === 'confirmed' && containment?.status === 'contained') nextSteps.push('start_recovery');
  if (remaining.length > 0) nextSteps.push('review_next_step');
  if (a.incidentId) nextSteps.push('return_to_incident');
  const intents = await db.select({ status: evidenceIntents.status, payload: evidenceIntents.payload }).from(evidenceIntents).where(and(eq(evidenceIntents.orgId, actor.orgId), inArray(evidenceIntents.type, ['action.approved', 'action.outcome_observed'])));
  const mine = intents.filter((i) => (i.payload as { actionId?: string }).actionId === a.id);
  const evidenceState: ActionDetailDTO['evidenceState'] = mine.length === 0 ? 'none' : mine.some((i) => i.status === 'pending_signature') ? 'pending_signature' : mine.some((i) => i.status === 'signing_failed') ? 'signing_failed' : 'signed';
  const result = a.result as { outcomeKey?: string } | null;
  return {
    id: a.id,
    actionType: a.actionType as ActionDetailDTO['actionType'],
    title: msg(`action.title.${a.actionType.replace('.', '_')}`),
    state,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
    incidentId: a.incidentId,
    previewId: a.previewId,
    targetLabel: content?.targetLabel ?? msg('target.unknown'),
    outcome: msg(result?.outcomeKey ?? `action.outcome.${state}`),
    probes: probes.map((x): ProbeDTO => ({ kind: x.kind, label: x.label as Msg, expected: x.expected, observed: x.observed, result: x.result as ProbeDTO['result'], checkedAt: x.checkedAt.toISOString() })),
    boundaries: (a.boundaries as Msg[]) ?? [],
    remainingFindings: remaining,
    containment,
    device,
    command,
    nextSteps,
    evidenceState,
  };
}

export async function listRecentActions(db: Db, orgId: string, limit = 5) {
  return db.select().from(actions).where(eq(actions.orgId, orgId)).orderBy(desc(actions.updatedAt)).limit(limit);
}

export { deviceChanges };
