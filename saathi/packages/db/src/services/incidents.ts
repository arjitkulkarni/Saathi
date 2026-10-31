import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import {
  msg,
  SaathiError,
  type ContainmentAssessment,
  type Finding,
  type IncidentCardDTO,
  type IncidentDetailDTO,
  type IncidentState,
  type Msg,
  type RestrictionDTO,
  type Urgency,
} from '@saathi/contracts';
import { assessContainment, can, findingStatusAfter, nextIncidentState, recommendOptions, type FindingDraft, type VerifiedRestriction } from '@saathi/domain';
import type { Db } from '../client';
import { actions, appSessions, devices, evidenceIntents, incidentFindings, incidentHistory, incidents, integrations, recoveryCases, reports, restrictions, staff } from '../schema';
import { enqueue, recordIntent, requireMembership, type Actor } from './core';
import { deviceFreshness, loadSnapshot } from './snapshot';

const URGENCY_RANK: Record<Urgency, number> = { needs_attention: 3, review_today: 2, weekly: 1 };
const ACTIVE_STATES = ['open', 'investigating', 'contained', 'recovering'];

type IncidentRow = typeof incidents.$inferSelect;
type FindingRow = typeof incidentFindings.$inferSelect;

export function findingFromRow(r: FindingRow): Finding {
  return {
    id: r.id,
    ruleId: r.ruleId as Finding['ruleId'],
    ruleVersion: r.ruleVersion,
    status: r.status as Finding['status'],
    harmfulCapability: r.harmfulCapability,
    target: { type: r.targetType as Finding['target']['type'], id: r.targetId },
    facts: r.facts as Msg[],
    boundaries: r.boundaries as Msg[],
  };
}

function uniqMsgs(list: Msg[]): Msg[] {
  const seen = new Set<string>();
  return list.filter((m) => {
    const k = m.key + JSON.stringify(m.params);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Coverage for the incident's own scope: every targeted source must be enforceable and fresh. */
async function scopeCoverage(db: Db, orgId: string, findings: Finding[], at: Date) {
  const sources: Msg[] = [];
  let complete = true;
  let freshness: 'fresh' | 'stale' | 'offline' | 'never' = 'fresh';
  const sessionIds = findings.filter((f) => f.target.type === 'session').map((f) => f.target.id);
  const subjectIds = findings.filter((f) => f.target.type === 'subject').map((f) => f.target.id);
  const deviceIds = findings.filter((f) => f.target.type === 'device').map((f) => f.target.id);
  if (sessionIds.length || subjectIds.length) {
    const [ri] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, 'records_reference')));
    if (ri) sources.push(msg('scope.records_app', { name: ri.name }));
    if (!ri || !ri.canEnforce || ri.status !== 'connected') complete = false;
  }
  if (deviceIds.length) {
    const ds = await db.select().from(devices).where(and(eq(devices.orgId, orgId), inArray(devices.id, deviceIds)));
    for (const d of ds) {
      const f = deviceFreshness(d.lastSeenAt, at);
      sources.push(msg(d.simulated ? 'scope.device_simulated' : 'scope.device', { name: d.name }));
      if (f !== 'fresh') {
        complete = false;
        freshness = f;
      }
    }
  }
  const unconnected = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), notInArray(integrations.kind, ['records_reference', 'device_agent'])));
  const excluded = unconnected.filter((i) => !i.canEnforce).map((i) => msg(i.canObserve ? 'scope.excluded_read_only' : 'scope.excluded_unconnected', { name: i.name }));
  return { sources, complete, excluded, freshness };
}

/** Verified restrictions from this incident's terminal actions (probe-derived coverage). */
async function verifiedRestrictions(db: Db, orgId: string, incidentId: string): Promise<VerifiedRestriction[]> {
  const rows = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.incidentId, incidentId)));
  return rows
    .filter((a) => ['confirmed', 'partial', 'failed', 'unknown'].includes(a.state))
    .map((a) => ({
      actionId: a.id,
      actionType: a.actionType,
      state: a.state as VerifiedRestriction['state'],
      coversTargets: ((a.result as { coversTargets?: VerifiedRestriction['coversTargets'] } | null)?.coversTargets ?? []) as VerifiedRestriction['coversTargets'],
    }));
}

/**
 * Recompute finding statuses, containment and incident state from persisted facts
 * (build.md Ph08.6). Called after any action outcome, new finding or remediation.
 */
export async function reassessIncident(db: Db, orgId: string, incidentId: string, opts: { newRelevantEvidence?: boolean; previewCreated?: boolean; at?: Date } = {}) {
  const at = opts.at ?? new Date();
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, orgId), eq(incidents.id, incidentId))).for('update');
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  const findingRows = await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, incidentId));
  const verified = await verifiedRestrictions(db, orgId, incidentId);
  const sessions = await db.select({ id: appSessions.id, staffId: appSessions.staffId }).from(appSessions).where(eq(appSessions.orgId, orgId));
  const owner = (sid: string) => sessions.find((s) => s.id === sid)?.staffId ?? null;
  const findings: Finding[] = [];
  for (const r of findingRows) {
    const f = findingFromRow(r);
    const status = findingStatusAfter(f, verified, owner);
    if (status !== f.status) await db.update(incidentFindings).set({ status, updatedAt: at }).where(eq(incidentFindings.id, r.id));
    findings.push({ ...f, status });
  }
  const cov = await scopeCoverage(db, orgId, findings, at);
  const assessment = assessContainment(findings, verified, cov.complete, at.toISOString());
  const prevState = inc.state as IncidentState;
  const state = nextIncidentState(prevState, assessment, opts);
  await db
    .update(incidents)
    .set({
      containment: assessment,
      state,
      facts: uniqMsgs(findings.flatMap((f) => f.facts)),
      boundaries: uniqMsgs(findings.flatMap((f) => f.boundaries)),
      scope: { sources: cov.sources, observedAt: at.toISOString(), excluded: cov.excluded, freshness: cov.freshness },
      updatedAt: at,
      version: sql`${incidents.version} + 1`,
    })
    .where(eq(incidents.id, incidentId));
  if (state !== prevState) {
    await db.insert(incidentHistory).values({ orgId, incidentId, kind: 'state_changed', text: msg('history.state_changed', { from: prevState, to: state }), at });
    await recordIntent(db, orgId, 'incident.state_changed', { incidentId, from: prevState, to: state, containment: assessment.status }, { incidentId });
  }
  return { state, assessment, findings };
}

/** Attach a finding to the matching active incident or open a new one (build.md Ph06.5). */
export async function upsertFinding(db: Db, orgId: string, draft: FindingDraft, ctx: { rawEventId?: string | null; isReplay?: boolean; at?: Date }) {
  const at = ctx.at ?? new Date();
  const existing = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), eq(incidents.family, draft.family), eq(incidents.correlationKey, draft.correlationKey), inArray(incidents.state, [...ACTIVE_STATES, 'recovered'])))
    .orderBy(desc(incidents.updatedAt))
    .limit(1)
    .for('update');
  let inc: IncidentRow | undefined = existing[0];
  // A recovered incident older than 24h does not absorb new evidence; open a new one.
  if (inc && inc.state === 'recovered' && at.getTime() - inc.updatedAt.getTime() > 24 * 3600 * 1000) inc = undefined;
  let created = false;
  if (!inc) {
    [inc] = await db
      .insert(incidents)
      .values({
        orgId,
        family: draft.family,
        correlationKey: draft.correlationKey,
        title: draft.title,
        urgency: draft.urgency,
        state: 'open',
        facts: draft.facts,
        uncertain: draft.uncertain,
        boundaries: draft.boundaries,
        scope: { sources: [], observedAt: at.toISOString(), excluded: [], freshness: 'fresh' },
        containment: { status: 'not_contained', reasons: [], assessedAt: at.toISOString() } satisfies ContainmentAssessment,
        subjectStaffId: draft.subject.staffId ?? null,
        subjectSessionId: draft.subject.sessionId ?? null,
        subjectDeviceId: draft.subject.deviceId ?? null,
        isReplay: ctx.isReplay ?? false,
        openedAt: at,
        updatedAt: at,
      })
      .returning();
    created = true;
    await db.insert(incidentHistory).values({ orgId, incidentId: inc.id, kind: 'opened', text: msg('history.opened'), at });
  }
  const [prior] = await db
    .select()
    .from(incidentFindings)
    .where(and(eq(incidentFindings.incidentId, inc.id), eq(incidentFindings.ruleId, draft.ruleId), eq(incidentFindings.targetType, draft.target.type), eq(incidentFindings.targetId, draft.target.id)));
  let newFinding = false;
  if (prior) {
    await db.update(incidentFindings).set({ facts: draft.facts, updatedAt: at }).where(eq(incidentFindings.id, prior.id));
  } else {
    newFinding = true;
    await db.insert(incidentFindings).values({
      orgId,
      incidentId: inc.id,
      ruleId: draft.ruleId,
      ruleVersion: draft.ruleVersion,
      status: draft.initialStatus,
      harmfulCapability: draft.harmfulCapability,
      targetType: draft.target.type,
      targetId: draft.target.id,
      facts: draft.facts,
      boundaries: draft.boundaries,
    });
    await db.insert(incidentHistory).values({ orgId, incidentId: inc.id, kind: 'finding_added', text: msg('history.finding_added', { rule: draft.ruleId }), at });
  }
  const urgency = URGENCY_RANK[draft.urgency] > URGENCY_RANK[inc.urgency as Urgency] ? draft.urgency : (inc.urgency as Urgency);
  await db
    .update(incidents)
    .set({ urgency, uncertain: uniqMsgs([...(inc.uncertain as Msg[]), ...draft.uncertain]) })
    .where(eq(incidents.id, inc.id));
  const res = await reassessIncident(db, orgId, inc.id, { newRelevantEvidence: newFinding && !created, at });
  if (created || newFinding) {
    await recordIntent(db, orgId, created ? 'incident.opened' : 'incident.finding_added', { incidentId: inc.id, ruleId: draft.ruleId, ruleVersion: draft.ruleVersion, target: draft.target, rawEventId: ctx.rawEventId ?? null }, { incidentId: inc.id });
    if (draft.urgency === 'needs_attention' || created) {
      await enqueue(db, { orgId, type: 'notify.incident', payload: { incidentId: inc.id }, dedupeKey: `notify.incident:${inc.id}:${created ? 'opened' : `finding:${draft.ruleId}`}` });
    }
  }
  return { incidentId: inc.id, created, newFinding, state: res.state };
}

// ------------------------------------------------------------------ read models

async function activeRestrictionsFor(db: Db, orgId: string, targetIds: string[], at: Date): Promise<RestrictionDTO[]> {
  if (targetIds.length === 0) return [];
  const rows = await db
    .select()
    .from(restrictions)
    .where(and(eq(restrictions.orgId, orgId), inArray(restrictions.targetId, targetIds), sql`${restrictions.liftedAt} IS NULL AND (${restrictions.expiresAt} IS NULL OR ${restrictions.expiresAt} > ${at})`));
  const sess = await db.select({ id: appSessions.id, label: appSessions.label }).from(appSessions).where(and(eq(appSessions.orgId, orgId), inArray(appSessions.id, targetIds)));
  const people = await db.select({ id: staff.id, name: staff.displayName }).from(staff).where(and(eq(staff.orgId, orgId), inArray(staff.id, targetIds)));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as RestrictionDTO['kind'],
    targetType: r.targetType as RestrictionDTO['targetType'],
    targetLabel: sess.find((s) => s.id === r.targetId)?.label ?? people.find((p) => p.id === r.targetId)?.name ?? '',
    ratePerMinute: r.ratePerMinute,
    startsAt: r.startsAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    source: r.source as RestrictionDTO['source'],
    incidentId: r.incidentId,
  }));
}

function nextStepFor(inc: IncidentRow, hasLimit: boolean): Msg {
  switch (inc.state) {
    case 'open':
      return msg(hasLimit ? 'next.review_limited' : 'next.review_response');
    case 'investigating':
      return msg((inc.containment as ContainmentAssessment).status === 'partially_contained' ? 'next.remaining_concern' : 'next.choose_response');
    case 'contained':
      return msg('next.start_recovery');
    case 'recovering':
      return msg('next.finish_recovery');
    case 'recovered':
      return msg('next.none_recovered');
    default:
      return msg('next.none_dismissed');
  }
}

export async function incidentCards(db: Db, orgId: string, rows: IncidentRow[], at = new Date()): Promise<IncidentCardDTO[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const counts = await db.select({ incidentId: incidentFindings.incidentId, n: sql<number>`count(*)::int` }).from(incidentFindings).where(inArray(incidentFindings.incidentId, ids)).groupBy(incidentFindings.incidentId);
  const targets = rows.flatMap((r) => [r.subjectSessionId, r.subjectStaffId].filter(Boolean) as string[]);
  const limitRows = targets.length
    ? await db
        .select({ targetId: restrictions.targetId })
        .from(restrictions)
        .where(and(eq(restrictions.orgId, orgId), inArray(restrictions.targetId, targets), eq(restrictions.kind, 'throttle'), sql`${restrictions.liftedAt} IS NULL AND (${restrictions.expiresAt} IS NULL OR ${restrictions.expiresAt} > ${at})`))
    : [];
  const limited = new Set(limitRows.map((l) => l.targetId));
  return rows.map((r) => {
    const hasLimit = (!!r.subjectSessionId && limited.has(r.subjectSessionId)) || (!!r.subjectStaffId && limited.has(r.subjectStaffId));
    const scope = r.scope as { sources: Msg[]; observedAt: string };
    return {
      id: r.id,
      title: r.title as Msg,
      state: r.state as IncidentState,
      urgency: r.urgency as Urgency,
      family: r.family,
      source: scope.sources?.[0] ?? msg('scope.unknown'),
      observedAt: r.openedAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      nextStep: nextStepFor(r, hasLimit),
      containment: (r.containment as ContainmentAssessment).status,
      findingCount: counts.find((c) => c.incidentId === r.id)?.n ?? 0,
      isReplay: r.isReplay,
      hasActiveLimit: hasLimit,
    };
  });
}

export async function getIncidentDetail(db: Db, actor: Actor, incidentId: string, at = new Date()): Promise<IncidentDetailDTO> {
  const { role } = await requireMembership(db, actor, 'incidents.read');
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId)));
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  const [card] = await incidentCards(db, actor.orgId, [inc], at);
  const findings = (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, inc.id))).map(findingFromRow);
  const snapshot = await loadSnapshot(db, actor.orgId, at);
  const { options, noSupportedOption } = ['dismissed', 'recovered'].includes(inc.state) ? { options: [], noSupportedOption: null } : recommendOptions(snapshot, findings, at.toISOString());
  const targetIds = [inc.subjectSessionId, inc.subjectStaffId, ...findings.map((f) => f.target.id)].filter(Boolean) as string[];
  const relevantTargets = targetIds.filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const activeRestrictions = (await activeRestrictionsFor(db, actor.orgId, relevantTargets, at));
  const actionRows = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.incidentId, inc.id))).orderBy(desc(actions.createdAt));
  const history = await db.select().from(incidentHistory).where(eq(incidentHistory.incidentId, inc.id)).orderBy(incidentHistory.at);
  const intents = await db.select({ id: evidenceIntents.id, status: evidenceIntents.status }).from(evidenceIntents).where(and(eq(evidenceIntents.orgId, actor.orgId), eq(evidenceIntents.incidentId, inc.id)));
  const [rc] = await db.select({ id: recoveryCases.id }).from(recoveryCases).where(and(eq(recoveryCases.orgId, actor.orgId), eq(recoveryCases.incidentId, inc.id)));
  const [rep] = await db.select({ id: reports.id }).from(reports).where(and(eq(reports.orgId, actor.orgId), eq(reports.incidentId, inc.id))).orderBy(desc(reports.createdAt)).limit(1);
  const scope = inc.scope as IncidentDetailDTO['scope'];
  const pendingSign = intents.some((i) => i.status === 'pending_signature');
  return {
    ...card,
    hasActiveLimit: activeRestrictions.some((r) => r.kind === 'throttle'),
    nextStep: nextStepFor(inc, activeRestrictions.some((r) => r.kind === 'throttle')),
    facts: inc.facts as Msg[],
    uncertain: inc.uncertain as Msg[],
    boundaries: inc.boundaries as Msg[],
    findings,
    scope: { sources: scope.sources ?? [], observedAt: scope.observedAt, excluded: scope.excluded ?? [], freshness: scope.freshness ?? 'fresh' },
    containmentAssessment: inc.containment as ContainmentAssessment,
    activeRestrictions,
    options,
    noSupportedOption,
    actions: actionRows.map((a) => ({ id: a.id, actionType: a.actionType as IncidentDetailDTO['actions'][number]['actionType'], title: msg(`action.title.${a.actionType.replace('.', '_')}`), state: a.state as IncidentDetailDTO['actions'][number]['state'], createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
    timeline: history.map((h) => ({ at: h.at.toISOString(), kind: h.kind, text: h.text as Msg, actionId: h.actionId, evidenceState: pendingSign ? 'pending_signature' : 'signed' })),
    recoveryCaseId: rc?.id ?? null,
    dismissedReason: inc.dismissedReason,
    permissions: {
      canPreview: can(role, 'incidents.preview') && !['dismissed', 'recovered'].includes(inc.state),
      canDismiss: can(role, 'incidents.dismiss') && ['open', 'investigating'].includes(inc.state),
      canRecover: can(role, 'recovery.manage') && ['contained', 'recovering'].includes(inc.state),
      canExport: can(role, 'reports.create'),
      canExplain: can(role, 'explain.request'),
    },
    reportId: rep?.id ?? null,
  };
}

export async function listIncidents(db: Db, actor: Actor, filter: { tab: 'needs_attention' | 'investigating' | 'recovering' | 'all'; cursor?: string | null; limit?: number }) {
  await requireMembership(db, actor, 'incidents.read');
  const limit = Math.min(filter.limit ?? 25, 50);
  const conds = [eq(incidents.orgId, actor.orgId)];
  if (filter.tab === 'needs_attention') conds.push(inArray(incidents.state, ['open', 'investigating']), eq(incidents.urgency, 'needs_attention'));
  if (filter.tab === 'investigating') conds.push(inArray(incidents.state, ['open', 'investigating', 'contained']));
  if (filter.tab === 'recovering') conds.push(inArray(incidents.state, ['recovering']));
  if (filter.cursor) {
    const [ts, id] = Buffer.from(filter.cursor, 'base64url').toString().split('|');
    conds.push(sql`(${incidents.updatedAt}, ${incidents.id}) < (${new Date(ts)}, ${id}::uuid)`);
  }
  const rows = await db.select().from(incidents).where(and(...conds)).orderBy(desc(incidents.updatedAt), desc(incidents.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: await incidentCards(db, actor.orgId, page),
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.updatedAt.toISOString()}|${last.id}`).toString('base64url') : null,
  };
}

export async function dismissIncident(db: Db, actor: Actor, incidentId: string, reason: string) {
  await requireMembership(db, actor, 'incidents.dismiss');
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId))).for('update');
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  if (!['open', 'investigating'].includes(inc.state)) throw new SaathiError('CONFLICT', 'Only open or investigating incidents can be dismissed.');
  await db.update(incidents).set({ state: 'dismissed', dismissedReason: reason, updatedAt: new Date() }).where(eq(incidents.id, inc.id));
  await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId, kind: 'dismissed', text: msg('history.dismissed', { reason }), actorUserId: actor.userId });
  await recordIntent(db, actor.orgId, 'incident.dismissed', { incidentId, reason, by: actor.userId }, { incidentId });
}
