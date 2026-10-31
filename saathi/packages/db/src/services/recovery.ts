import { and, eq, inArray, isNull } from 'drizzle-orm';
import { msg, SaathiError, type IncidentState, type Msg } from '@saathi/contracts';
import { canRunStep, recoveryTemplate, type RecoveryStep, type RecoveryStepKey } from '@saathi/domain';
import type { Db } from '../client';
import { actions, appSessions, deviceChanges, devices, incidentFindings, incidentHistory, incidents, integrations, recoveryCases, restrictions, staff } from '../schema';
import { bumpGuards, lockGuards, newToken, recordIntent, requireMembership, sha256, type Actor } from './core';
import { gatewayDecide } from './gateway';
import { deviceFreshness } from './snapshot';

export type RecoveryCaseDTO = {
  id: string;
  incidentId: string;
  status: 'in_progress' | 'blocked' | 'completed';
  kind: 'records_session' | 'records_account' | 'device';
  steps: RecoveryStep[];
  blockedReason: Msg | null;
  freshSessionToken?: string | null;
  createdAt: string;
  completedAt: string | null;
};

async function caseKind(db: Db, orgId: string, incidentId: string): Promise<RecoveryCaseDTO['kind']> {
  const acts = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.incidentId, incidentId), eq(actions.state, 'confirmed')));
  if (acts.some((a) => a.actionType === 'records.disable_account' || a.actionType === 'records.offboard_subject')) return 'records_account';
  if (acts.some((a) => a.actionType === 'records.pause_session')) return 'records_session';
  return 'device';
}

export async function startRecovery(db: Db, actor: Actor, incidentId: string) {
  await requireMembership(db, actor, 'recovery.manage');
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.id, incidentId))).for('update');
  if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
  const [existing] = await db.select().from(recoveryCases).where(and(eq(recoveryCases.orgId, actor.orgId), eq(recoveryCases.incidentId, incidentId)));
  if (existing) return { caseId: existing.id };
  if (inc.state !== 'contained') throw new SaathiError('CONFLICT', 'Recovery starts after the incident is contained for its scope.');
  const kind = await caseKind(db, actor.orgId, incidentId);
  const oldSessions =
    kind === 'records_session'
      ? (await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.incidentId, incidentId), eq(actions.actionType, 'records.pause_session'), eq(actions.state, 'confirmed')))).map((a) => a.targetId)
      : kind === 'records_account' && inc.subjectStaffId
        ? (await db.select({ id: appSessions.id }).from(appSessions).where(and(eq(appSessions.orgId, actor.orgId), eq(appSessions.staffId, inc.subjectStaffId)))).map((s) => s.id)
        : [];
  const [c] = await db
    .insert(recoveryCases)
    .values({ orgId: actor.orgId, incidentId, steps: recoveryTemplate(kind), oldSessionIds: oldSessions, createdBy: actor.userId })
    .returning({ id: recoveryCases.id });
  await db.update(incidents).set({ state: 'recovering', updatedAt: new Date() }).where(eq(incidents.id, incidentId));
  await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId, kind: 'recovery_started', text: msg('history.recovery_started'), actorUserId: actor.userId });
  await recordIntent(db, actor.orgId, 'recovery.started', { caseId: c.id, incidentId, kind, by: actor.userId }, { incidentId });
  return { caseId: c.id };
}

export async function getRecoveryCase(db: Db, actor: Actor, caseId: string): Promise<RecoveryCaseDTO> {
  await requireMembership(db, actor, 'incidents.read');
  const [c] = await db.select().from(recoveryCases).where(and(eq(recoveryCases.orgId, actor.orgId), eq(recoveryCases.id, caseId)));
  if (!c) throw new SaathiError('NOT_FOUND', 'Recovery case not found.');
  const steps = c.steps as RecoveryStep[];
  return {
    id: c.id,
    incidentId: c.incidentId,
    status: c.status as RecoveryCaseDTO['status'],
    kind: steps.some((s) => s.key === 'restore_device_policy') ? 'device' : (await caseKind(db, actor.orgId, c.incidentId)),
    steps,
    blockedReason: (c.blockedReason as Msg) ?? null,
    createdAt: c.createdAt.toISOString(),
    completedAt: c.completedAt?.toISOString() ?? null,
  };
}

type StepInput = { confirm?: boolean; note?: string; newPin?: string };

/**
 * Run one recovery step. Attested steps record who confirmed what; verified steps are
 * checked by the server against actual state. A failed check blocks recovery with a reason.
 */
export async function runRecoveryStep(db: Db, actor: Actor, caseId: string, key: RecoveryStepKey, input: StepInput, deps: { hashPin: (pin: string) => string }) {
  await requireMembership(db, actor, 'recovery.manage');
  const [c] = await db.select().from(recoveryCases).where(and(eq(recoveryCases.orgId, actor.orgId), eq(recoveryCases.id, caseId))).for('update');
  if (!c) throw new SaathiError('NOT_FOUND', 'Recovery case not found.');
  if (c.status === 'completed') throw new SaathiError('CONFLICT', 'Recovery is already complete.');
  const steps = structuredClone(c.steps as RecoveryStep[]);
  const gate = canRunStep(steps.map((s) => (s.key === key && s.status === 'failed' ? { ...s, status: 'pending' as const } : s)), key);
  if (!gate.ok) throw new SaathiError('CONFLICT', 'This step cannot run yet.', { reason: gate.reason });
  const step = steps.find((s) => s.key === key)!;
  const [inc] = await db.select().from(incidents).where(eq(incidents.id, c.incidentId));
  const now = new Date();
  const done = (result: Msg) => Object.assign(step, { status: 'done', result, at: now.toISOString(), by: actor.userId });
  const fail = (result: Msg) => Object.assign(step, { status: 'failed', result, at: now.toISOString(), by: actor.userId });
  let freshSessionToken: string | null = null;

  switch (key) {
    case 'verify_person':
      if (!input.confirm || !input.note || input.note.trim().length < 5) throw new SaathiError('VALIDATION_FAILED', 'Describe how you verified the person through a trusted channel.');
      done(msg('recovery.result.attested', { note: input.note.trim().slice(0, 200) }));
      break;
    case 'address_credentials': {
      if (!input.confirm) throw new SaathiError('VALIDATION_FAILED', 'Confirm that credentials were addressed.');
      if (input.newPin && inc.subjectStaffId) {
        if (!/^\d{6}$/.test(input.newPin)) throw new SaathiError('VALIDATION_FAILED', 'The new records PIN must be 6 digits.');
        await db.update(staff).set({ recordsPinHash: deps.hashPin(input.newPin) }).where(and(eq(staff.orgId, actor.orgId), eq(staff.id, inc.subjectStaffId)));
        done(msg('recovery.result.pin_changed'));
      } else done(msg('recovery.result.attested', { note: (input.note ?? '').trim().slice(0, 200) || 'Credentials addressed' }));
      break;
    }
    case 'review_findings': {
      const open = (await db.select().from(incidentFindings).where(eq(incidentFindings.incidentId, c.incidentId))).filter((f) => f.status === 'open');
      if (open.length) fail(msg('recovery.result.findings_open', { count: open.length }));
      else done(msg('recovery.result.no_open_findings'));
      break;
    }
    case 'revoke_old_session': {
      if (inc.subjectStaffId) await lockGuards(db, actor.orgId, [`subject:${inc.subjectStaffId}`], 'share');
      const ids = c.oldSessionIds;
      if (ids.length) await db.update(appSessions).set({ status: 'revoked', revokedAt: now, revokedReason: 'recovery' }).where(and(eq(appSessions.orgId, actor.orgId), inArray(appSessions.id, ids)));
      const after = ids.length ? await db.select({ status: appSessions.status }).from(appSessions).where(inArray(appSessions.id, ids)) : [];
      if (inc.subjectStaffId) await bumpGuards(db, actor.orgId, [`subject:${inc.subjectStaffId}`]);
      if (after.every((s) => s.status === 'revoked')) done(msg('recovery.result.sessions_revoked', { count: ids.length }));
      else fail(msg('recovery.result.revoke_failed'));
      break;
    }
    case 'issue_fresh_session': {
      if (!inc.subjectStaffId) {
        fail(msg('recovery.result.no_subject'));
        break;
      }
      await lockGuards(db, actor.orgId, [`subject:${inc.subjectStaffId}`], 'share');
      // The human-approved account restriction ends only through this authorized recovery.
      await db
        .update(restrictions)
        .set({ liftedAt: now, liftedReason: 'recovery' })
        .where(and(eq(restrictions.orgId, actor.orgId), eq(restrictions.targetId, inc.subjectStaffId), eq(restrictions.kind, 'disable_account'), isNull(restrictions.liftedAt)));
      const [integration] = await db.select().from(integrations).where(and(eq(integrations.orgId, actor.orgId), eq(integrations.kind, 'records_reference')));
      freshSessionToken = newToken(32);
      const [s] = await db
        .insert(appSessions)
        .values({ orgId: actor.orgId, integrationId: integration.id, staffId: inc.subjectStaffId, label: 'Fresh session (issued in recovery)', tokenHash: sha256(freshSessionToken), familiar: true, createdVia: 'recovery' })
        .returning({ id: appSessions.id });
      await db.update(recoveryCases).set({ newSessionId: s.id }).where(eq(recoveryCases.id, c.id));
      await bumpGuards(db, actor.orgId, [`subject:${inc.subjectStaffId}`]);
      done(msg('recovery.result.fresh_session_issued'));
      break;
    }
    case 'verify_old_token_rejected': {
      const [fresh] = await db.select().from(recoveryCases).where(eq(recoveryCases.id, c.id));
      const problems: string[] = [];
      for (const sid of c.oldSessionIds) {
        const r = await gatewayDecide(db, { orgId: actor.orgId, sessionId: sid, staffId: inc.subjectStaffId! }, { capability: 'records.download', recordId: null, probe: true }, now);
        if (r.decision !== 'deny') problems.push(`old:${sid}`);
      }
      if (fresh.newSessionId) {
        const r = await gatewayDecide(db, { orgId: actor.orgId, sessionId: fresh.newSessionId, staffId: inc.subjectStaffId! }, { capability: 'records.download', recordId: null, probe: true }, now);
        if (r.decision === 'deny') problems.push('fresh_denied');
      } else problems.push('no_fresh_session');
      if (problems.length) fail(msg('recovery.result.token_check_failed', { problems: problems.join(', ') }));
      else done(msg('recovery.result.old_rejected_fresh_works', { old: c.oldSessionIds.length }));
      break;
    }
    case 'restore_device_policy': {
      const deviceId = inc.subjectDeviceId;
      const active = deviceId ? await db.select().from(deviceChanges).where(and(eq(deviceChanges.orgId, actor.orgId), eq(deviceChanges.deviceId, deviceId), eq(deviceChanges.status, 'active'))) : [];
      if (active.length) fail(msg('recovery.result.device_changes_active', { count: active.length }));
      else done(msg('recovery.result.no_device_changes'));
      break;
    }
    case 'verify_device_state': {
      const [d] = inc.subjectDeviceId ? await db.select().from(devices).where(eq(devices.id, inc.subjectDeviceId)) : [];
      if (!d || deviceFreshness(d.lastSeenAt, now) !== 'fresh') fail(msg('recovery.result.device_not_fresh'));
      else done(msg('recovery.result.device_fresh'));
      break;
    }
    case 'finish': {
      if (steps.some((s) => s.key !== 'finish' && s.status !== 'done')) throw new SaathiError('CONFLICT', 'Complete every earlier step first.');
      done(msg('recovery.result.finished'));
      await db.update(recoveryCases).set({ status: 'completed', completedAt: now, blockedReason: null }).where(eq(recoveryCases.id, c.id));
      await db.update(incidents).set({ state: 'recovered' satisfies IncidentState, updatedAt: now }).where(eq(incidents.id, c.incidentId));
      await db.insert(incidentHistory).values({ orgId: actor.orgId, incidentId: c.incidentId, kind: 'recovered', text: msg('history.recovered'), actorUserId: actor.userId });
      break;
    }
  }
  const failed = step.status === 'failed';
  await db
    .update(recoveryCases)
    .set({ steps, status: failed ? 'blocked' : key === 'finish' ? 'completed' : 'in_progress', blockedReason: failed ? step.result : null })
    .where(eq(recoveryCases.id, c.id));
  await recordIntent(db, actor.orgId, 'recovery.step', { caseId: c.id, step: key, kind: step.kind, status: step.status, by: actor.userId }, { incidentId: c.incidentId });
  return { step, freshSessionToken };
}
