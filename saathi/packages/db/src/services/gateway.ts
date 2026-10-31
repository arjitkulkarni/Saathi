import { and, count, eq, gte, sql } from 'drizzle-orm';
import type pg from 'pg';
import { SaathiError, type Capability } from '@saathi/contracts';
import { authorize } from '@saathi/domain';
import { withTx, type Db } from '../client';
import { accessLog, appSessions, demoRecords, integrations, rawEvents, restrictions, staff } from '../schema';
import { bumpGuards, enqueue, lockGuards, newToken, recordIntent, sha256 } from './core';
import { loadSnapshot } from './snapshot';

// Records gateway (build.md Ph04). Every protected operation is authorized synchronously,
// the rate budget is reserved atomically under the subject guard, and a consented throttle
// is applied in the same transaction. Database failure fails closed (503).

export type GatewayResult = {
  decision: 'allow' | 'deny' | 'throttle';
  admitted: boolean;
  reason: string;
  retryAfterSeconds: number | null;
  record: { id: string; title: string; category: string; body: string } | null;
  throttleUntil: string | null;
  probe: boolean;
};

export async function resolveAppSession(pool: pg.Pool, token: string): Promise<{ orgId: string; sessionId: string; staffId: string } | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  return withTx(pool, {}, async (_db, client) => {
    const r = await client.query('SELECT org_id, session_id, staff_id FROM saathi_app_session_lookup($1)', [sha256(token)]);
    const row = r.rows[0];
    return row ? { orgId: row.org_id, sessionId: row.session_id, staffId: row.staff_id } : null;
  });
}

/**
 * Evaluate a protected request. With `probe: true` the check is side-effect free: no budget
 * reservation, no content, no events — used by post-action probes (build.md Ph08.5).
 */
export async function gatewayDecide(
  db: Db,
  ctx: { orgId: string; sessionId: string; staffId: string },
  req: { capability: Capability; recordId: string | null; probe?: boolean },
  now = new Date(),
): Promise<GatewayResult> {
  const subjectKey = `subject:${ctx.staffId}`;
  await lockGuards(db, ctx.orgId, [subjectKey], 'share');
  let snapshot = await loadSnapshot(db, ctx.orgId, now, { subjectIds: [ctx.staffId] });
  const at = now.toISOString();
  let authz = authorize(snapshot, { sessionId: ctx.sessionId, capability: req.capability, at });

  if (req.probe) {
    return { decision: authz.decision, admitted: authz.decision !== 'deny', reason: authz.reason, retryAfterSeconds: null, record: null, throttleUntil: null, probe: true };
  }

  const policy = snapshot.policy;
  const windowStart = new Date(now.getTime() - policy.burstWindowSeconds * 1000);
  const dayStart = new Date(now.getTime() - 24 * 3600 * 1000);
  const minuteStart = new Date(now.getTime() - 60 * 1000);
  const [{ n: windowAttempts }] = await db.select({ n: count() }).from(accessLog).where(and(eq(accessLog.sessionId, ctx.sessionId), gte(accessLog.at, windowStart)));
  const [{ n: dayAttempts }] = await db.select({ n: count() }).from(accessLog).where(and(eq(accessLog.sessionId, ctx.sessionId), gte(accessLog.at, dayStart)));
  const attemptsInWindow = Number(windowAttempts) + 1;
  const attemptsToday = Number(dayAttempts) + 1;

  const session = snapshot.sessions.find((s) => s.id === ctx.sessionId);
  const subject = snapshot.subjects.find((s) => s.id === ctx.staffId);
  const hasThrottle = snapshot.restrictions.some((r) => r.kind === 'throttle' && ((r.targetType === 'session' && r.targetId === ctx.sessionId) || (r.targetType === 'subject' && r.targetId === ctx.staffId)));

  // Burst rule: 20 attempts / 120 s or 100 / day per session (build.md Ph06 preset).
  const breached = authz.decision === 'allow' && !hasThrottle && (attemptsInWindow > policy.burstThreshold || attemptsToday > policy.dailyLimit);
  let throttleApplied = false;
  let throttleUntil: Date | null = null;
  if (breached && policy.autoThrottleEnabled) {
    throttleUntil = new Date(now.getTime() + policy.throttleDurationMinutes * 60 * 1000);
    const [r] = await db
      .insert(restrictions)
      .values({
        orgId: ctx.orgId,
        targetType: 'session',
        targetId: ctx.sessionId,
        kind: 'throttle',
        ratePerMinute: policy.throttleRatePerMinute,
        startsAt: now,
        expiresAt: throttleUntil,
        source: 'auto_guard',
        policyVersion: snapshot.policyVersion,
      })
      .returning({ id: restrictions.id });
    await bumpGuards(db, ctx.orgId, [subjectKey]);
    await enqueue(db, { orgId: ctx.orgId, type: 'restriction.warn', payload: { restrictionId: r.id }, dedupeKey: `restriction.warn:${r.id}`, runAt: new Date(throttleUntil.getTime() - 5 * 60 * 1000) });
    await enqueue(db, { orgId: ctx.orgId, type: 'restriction.expire', payload: { restrictionId: r.id }, dedupeKey: `restriction.expire:${r.id}`, runAt: throttleUntil });
    throttleApplied = true;
    snapshot = await loadSnapshot(db, ctx.orgId, now, { subjectIds: [ctx.staffId] });
    authz = authorize(snapshot, { sessionId: ctx.sessionId, capability: req.capability, at });
  }

  let admitted = authz.decision === 'allow';
  let retryAfterSeconds: number | null = null;
  if (authz.decision === 'throttle') {
    const [{ n: admittedLastMinute }] = await db
      .select({ n: count() })
      .from(accessLog)
      .where(and(eq(accessLog.sessionId, ctx.sessionId), eq(accessLog.admitted, true), gte(accessLog.at, minuteStart)));
    admitted = Number(admittedLastMinute) < (authz.ratePerMinute ?? 1);
    if (!admitted) retryAfterSeconds = 60;
  }

  let record: GatewayResult['record'] = null;
  let isDecoy = false;
  if (admitted && req.recordId) {
    const rows = await db.select().from(demoRecords).where(and(eq(demoRecords.orgId, ctx.orgId), eq(demoRecords.id, req.recordId)));
    if (!rows[0]) throw new SaathiError('NOT_FOUND', 'Record not found.');
    record = { id: rows[0].id, title: rows[0].title, category: rows[0].category, body: rows[0].body };
    isDecoy = rows[0].isDecoy;
  }

  const [log] = await db
    .insert(accessLog)
    .values({
      orgId: ctx.orgId,
      sessionId: ctx.sessionId,
      staffId: ctx.staffId,
      recordId: req.recordId,
      capability: req.capability,
      decision: authz.decision,
      admitted,
      reason: authz.reason,
      policyVersion: authz.policyVersion,
      at: now,
    })
    .returning({ id: accessLog.id });

  const facts = {
    sessionId: ctx.sessionId,
    staffId: ctx.staffId,
    sessionLabel: session?.label ?? null,
    staffLabel: subject?.label ?? null,
    familiar: session?.familiar ?? null,
    decision: authz.decision,
    admitted,
    reason: authz.reason,
    attemptsInWindow,
    windowSeconds: policy.burstWindowSeconds,
    attemptsToday,
    burstTriggered: breached,
    throttleApplied,
    throttleUntil: throttleUntil?.toISOString() ?? null,
    autoThrottleEnabled: policy.autoThrottleEnabled,
    recordId: req.recordId,
  };
  const integrationId = session?.integrationId ?? null;
  if (req.capability === 'records.download' || isDecoy || authz.decision === 'deny') {
    const [ev] = await db
      .insert(rawEvents)
      .values({ orgId: ctx.orgId, sourceType: 'gateway', integrationId, dedupeKey: `gw:${log.id}`, type: 'records.download', observedAt: now, facts })
      .returning({ id: rawEvents.id });
    const notable = breached || authz.reason === 'subject_offboarded';
    await enqueue(db, { orgId: ctx.orgId, type: 'events.process', payload: {}, dedupeKey: notable ? `events.process:${ctx.orgId}:${ev.id}` : `events.process:${ctx.orgId}:${Math.floor(now.getTime() / 5000)}` });
  }
  if (isDecoy) {
    const [ev] = await db
      .insert(rawEvents)
      .values({ orgId: ctx.orgId, sourceType: 'gateway', integrationId, dedupeKey: `gw-decoy:${log.id}`, type: 'decoy.access', observedAt: now, facts })
      .returning({ id: rawEvents.id });
    await enqueue(db, { orgId: ctx.orgId, type: 'events.process', payload: {}, dedupeKey: `events.process:${ctx.orgId}:${ev.id}` });
  }
  if (integrationId) await db.update(integrations).set({ lastEventAt: now }).where(eq(integrations.id, integrationId));
  if (authz.decision !== 'deny' || authz.reason === 'throttled') await db.update(appSessions).set({ lastUsedAt: now }).where(eq(appSessions.id, ctx.sessionId));

  // Evidence for policy enforcement events (not for every ordinary download).
  if (throttleApplied) {
    await recordIntent(db, ctx.orgId, 'auto_guard.throttle_applied', { sessionId: ctx.sessionId, ratePerMinute: policy.throttleRatePerMinute, expiresAt: throttleUntil!.toISOString(), policyVersion: snapshot.policyVersion, attemptsInWindow });
  } else if (authz.decision === 'deny' && ['session_revoked', 'session_paused', 'subject_offboarded', 'account_disabled'].includes(authz.reason)) {
    const recent = await db.execute(sql`SELECT 1 FROM evidence_intents WHERE org_id = ${ctx.orgId} AND type = 'access.denied' AND payload->>'sessionId' = ${ctx.sessionId} AND created_at > now() - interval '60 seconds' LIMIT 1`);
    if (recent.rows.length === 0) await recordIntent(db, ctx.orgId, 'access.denied', { sessionId: ctx.sessionId, reason: authz.reason, policyVersion: authz.policyVersion });
  }

  return { decision: authz.decision, admitted, reason: authz.reason, retryAfterSeconds, record, throttleUntil: throttleUntil?.toISOString() ?? null, probe: false };
}

/** Records-app sign-in: a session-creation writer under the subject guard. */
export async function createRecordsSession(db: Db, orgId: string, input: { employeeCode: string; pinHashCheck: (hash: string | null) => boolean; label: string; familiar: boolean; via?: string }) {
  const rows = await db.select().from(staff).where(and(eq(staff.orgId, orgId), eq(staff.employeeCode, input.employeeCode)));
  const s = rows[0];
  if (!s || !input.pinHashCheck(s.recordsPinHash)) throw new SaathiError('UNAUTHENTICATED', 'Employee code or PIN is incorrect.');
  if (s.status !== 'active') throw new SaathiError('FORBIDDEN', 'This account is not active in the records application.');
  await lockGuards(db, orgId, [`subject:${s.id}`], 'share');
  const [integration] = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), eq(integrations.kind, 'records_reference')));
  if (!integration || integration.status !== 'connected') throw new SaathiError('DEPENDENCY_UNAVAILABLE', 'The records application is not connected.');
  const token = newToken(32);
  const [sess] = await db
    .insert(appSessions)
    .values({ orgId, integrationId: integration.id, staffId: s.id, label: input.label.slice(0, 80), tokenHash: sha256(token), familiar: input.familiar, createdVia: input.via ?? 'records_login' })
    .returning({ id: appSessions.id });
  await bumpGuards(db, orgId, [`subject:${s.id}`]);
  await recordIntent(db, orgId, 'records.session_created', { sessionId: sess.id, staffId: s.id, label: input.label.slice(0, 80), familiar: input.familiar, via: input.via ?? 'records_login' });
  return { token, sessionId: sess.id, staffId: s.id, staffName: s.displayName };
}
