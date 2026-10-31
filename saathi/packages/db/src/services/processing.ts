import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { msg, type EventType } from '@saathi/contracts';
import { evaluateEvent, evaluateMalwareCheck, PRESETS, type ExpectedEffect, type NormalizedEvent } from '@saathi/domain';
import type { Db } from '../client';
import { actions, devices, eventDispositions, incidentHistory, incidents, memberships, notifications, organizations, rawEvents, restrictions, signals, telegramLinks } from '../schema';
import { enqueue, recordIntent } from './core';
import { reassessIncident, upsertFinding } from './incidents';

type RawRow = typeof rawEvents.$inferSelect;

function toNormalized(r: RawRow): NormalizedEvent {
  return {
    id: r.id,
    type: r.type as EventType,
    observedAt: r.observedAt.toISOString(),
    sourceType: r.sourceType as NormalizedEvent['sourceType'],
    deviceId: r.deviceId,
    integrationId: r.integrationId,
    facts: r.facts as NormalizedEvent['facts'],
    isReplay: r.isReplay,
  };
}

/** Expected, narrowly matched side effects of confirmed Saathi commands (build.md Ph06.6). */
async function expectedEffects(db: Db, orgId: string, deviceId: string): Promise<ExpectedEffect[]> {
  const since = new Date(Date.now() - PRESETS.expectedEffectWindowSeconds * 1000);
  const rows = await db.select().from(actions).where(and(eq(actions.orgId, orgId), eq(actions.deviceId, deviceId), gte(actions.updatedAt, since)));
  const out: ExpectedEffect[] = [];
  for (const a of rows) {
    const until = new Date(a.updatedAt.getTime() + PRESETS.expectedEffectWindowSeconds * 1000).toISOString();
    const p = a.params as Record<string, string>;
    if (a.actionType === 'device.disable_local_account' && p.sid) out.push({ actionId: a.id, deviceId, type: 'auth.failed', match: { sid: p.sid, reason: 'account_disabled' }, until });
    if (a.actionType === 'device.restrict_removable_storage') out.push({ actionId: a.id, deviceId, type: 'storage.attached', match: { blockedByPolicy: true }, until });
  }
  return out;
}

async function addToSignal(db: Db, orgId: string, s: { type: string; family: string; subjectKey: string; windowSeconds: number }, ev: RawRow) {
  const windowStart = new Date(ev.observedAt.getTime() - s.windowSeconds * 1000);
  const [existing] = await db
    .select()
    .from(signals)
    .where(and(eq(signals.orgId, orgId), eq(signals.type, s.type), eq(signals.subjectKey, s.subjectKey), gte(signals.lastAt, windowStart)))
    .orderBy(desc(signals.lastAt))
    .limit(1)
    .for('update');
  if (existing) {
    const ids = [...existing.rawEventIds, ev.id].slice(-50);
    await db.update(signals).set({ count: existing.count + 1, lastAt: ev.observedAt > existing.lastAt ? ev.observedAt : existing.lastAt, rawEventIds: ids }).where(eq(signals.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(signals)
    .values({ orgId, type: s.type, family: s.family, subjectKey: s.subjectKey, count: 1, firstAt: ev.observedAt, lastAt: ev.observedAt, rawEventIds: [ev.id], provenance: { source: ev.sourceType, deviceId: ev.deviceId, integrationId: ev.integrationId }, isReplay: ev.isReplay })
    .returning({ id: signals.id });
  return row.id;
}

/**
 * Process unprocessed observations for one organization. Every event receives exactly one
 * disposition with a reason, so the noise funnel is inspectable (build.md Ph06.3).
 */
export async function processOrgEvents(db: Db, orgId: string, limit = 200) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { processed: 0 };
  const calendar = { timezone: org.timezone, workStart: org.workStart, workEnd: org.workEnd, workDays: org.workDays };
  const batch = await db
    .select()
    .from(rawEvents)
    .where(and(eq(rawEvents.orgId, orgId), isNull(rawEvents.processedAt)))
    .orderBy(asc(rawEvents.observedAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  const deviceNames = new Map((await db.select({ id: devices.id, name: devices.name }).from(devices).where(eq(devices.orgId, orgId))).map((d) => [d.id, d.name]));
  let processed = 0;
  for (const ev of batch) {
    let recent: NormalizedEvent[] = [];
    let effects: ExpectedEffect[] = [];
    if (ev.deviceId) {
      const since = new Date(ev.observedAt.getTime() - 30 * 60 * 1000);
      recent = (await db.select().from(rawEvents).where(and(eq(rawEvents.orgId, orgId), eq(rawEvents.deviceId, ev.deviceId), gte(rawEvents.observedAt, since), lte(rawEvents.observedAt, ev.observedAt)))).filter((r) => r.id !== ev.id).map(toNormalized);
      effects = await expectedEffects(db, orgId, ev.deviceId);
    }
    const outcome = evaluateEvent(toNormalized(ev), { calendar, recent, expectedEffects: effects, deviceName: ev.deviceId ? deviceNames.get(ev.deviceId) : null });
    let signalId: string | null = null;
    if (outcome.signal) signalId = await addToSignal(db, orgId, outcome.signal, ev);
    let incidentId: string | null = null;
    if (outcome.finding) incidentId = (await upsertFinding(db, orgId, outcome.finding, { rawEventId: ev.id, isReplay: ev.isReplay, at: ev.observedAt })).incidentId;
    if (outcome.schedule) await enqueue(db, { orgId, type: outcome.schedule.type, payload: outcome.schedule.payload, dedupeKey: `${outcome.schedule.type}:${ev.id}`, runAt: new Date(outcome.schedule.runAt) });
    await db.insert(eventDispositions).values({ orgId, rawEventId: ev.id, disposition: outcome.disposition, reason: outcome.reason, signalId, incidentId, isReplay: ev.isReplay }).onConflictDoNothing();
    await db.update(rawEvents).set({ processedAt: new Date() }).where(eq(rawEvents.id, ev.id));
    processed++;
  }
  if (batch.length === limit) await enqueue(db, { orgId, type: 'events.process', payload: {}, dedupeKey: `events.process:${orgId}:more:${Date.now()}` });
  return { processed };
}

/** Unresolved-malware rule: detection without matching remediation after the grace period. */
export async function malwareCheck(db: Db, orgId: string, payload: { eventId: string; deviceId: string }) {
  const [det] = await db.select().from(rawEvents).where(and(eq(rawEvents.orgId, orgId), eq(rawEvents.id, payload.eventId)));
  if (!det || !det.deviceId) return;
  const later = await db.select().from(rawEvents).where(and(eq(rawEvents.orgId, orgId), eq(rawEvents.deviceId, det.deviceId), gt(rawEvents.observedAt, det.observedAt)));
  const [d] = await db.select({ name: devices.name }).from(devices).where(eq(devices.id, det.deviceId));
  const draft = evaluateMalwareCheck(toNormalized(det), later.map(toNormalized), d?.name ?? '');
  if (draft) await upsertFinding(db, orgId, draft, { rawEventId: det.id, isReplay: det.isReplay });
  else {
    // Remediated: resolve any matching open malware finding (remediation observed).
    const open = await db.execute<{ id: string; incident_id: string }>(sql`SELECT f.id, f.incident_id FROM incident_findings f WHERE f.org_id = ${orgId} AND f.rule_id = 'unresolved_malware' AND f.target_id = ${det.deviceId} AND f.status = 'open'`);
    for (const f of open.rows) {
      await db.execute(sql`UPDATE incident_findings SET status = 'resolved', updated_at = now() WHERE id = ${f.id}`);
      await reassessIncident(db, orgId, f.incident_id);
    }
  }
}

/** Pre-expiry warning for a temporary limit (build.md Ph11.2). */
export async function warnRestriction(db: Db, orgId: string, restrictionId: string) {
  const [r] = await db.select().from(restrictions).where(and(eq(restrictions.orgId, orgId), eq(restrictions.id, restrictionId)));
  if (!r || r.liftedAt || r.warnedAt || !r.expiresAt || r.expiresAt.getTime() < Date.now()) return;
  await db.update(restrictions).set({ warnedAt: new Date() }).where(eq(restrictions.id, r.id));
  const incidentId = r.incidentId ?? (await incidentForTarget(db, orgId, r.targetId));
  if (incidentId) await db.insert(incidentHistory).values({ orgId, incidentId, kind: 'limit_expiring', text: msg('history.limit_expiring', { at: r.expiresAt.toISOString() }) });
  await createNotifications(db, orgId, { kind: 'limit_expiring', incidentId, text: msg('notify.limit_expiring'), dedupe: `limit_expiring:${r.id}` });
}

/**
 * Expire a temporary throttle: audit + notify. Only that restriction row is lifted; an
 * independent pause or revocation is a different row and is untouched (Ph11.3).
 */
export async function expireRestriction(db: Db, orgId: string, restrictionId: string) {
  const [r] = await db.select().from(restrictions).where(and(eq(restrictions.orgId, orgId), eq(restrictions.id, restrictionId))).for('update');
  if (!r || r.liftedAt || r.kind !== 'throttle' || !r.expiresAt) return;
  if (r.expiresAt.getTime() > Date.now()) {
    await enqueue(db, { orgId, type: 'restriction.expire', payload: { restrictionId }, dedupeKey: `restriction.expire:${restrictionId}:${r.expiresAt.getTime()}`, runAt: r.expiresAt });
    return;
  }
  await db.update(restrictions).set({ liftedAt: r.expiresAt, liftedReason: 'expired' }).where(eq(restrictions.id, r.id));
  const incidentId = r.incidentId ?? (await incidentForTarget(db, orgId, r.targetId));
  if (incidentId) await db.insert(incidentHistory).values({ orgId, incidentId, kind: 'limit_expired', text: msg('history.limit_expired') });
  await recordIntent(db, orgId, 'auto_guard.throttle_expired', { restrictionId: r.id, targetId: r.targetId, expiredAt: r.expiresAt.toISOString() }, { incidentId });
  await createNotifications(db, orgId, { kind: 'limit_expired', incidentId, text: msg('notify.limit_expired'), dedupe: `limit_expired:${r.id}` });
}

async function incidentForTarget(db: Db, orgId: string, targetId: string) {
  const [inc] = await db
    .select({ id: incidents.id })
    .from(incidents)
    .where(and(eq(incidents.orgId, orgId), sql`(${incidents.subjectSessionId} = ${targetId} OR ${incidents.subjectStaffId} = ${targetId})`, inArray(incidents.state, ['open', 'investigating', 'contained', 'recovering'])))
    .orderBy(desc(incidents.updatedAt))
    .limit(1);
  return inc?.id ?? null;
}

/**
 * Create one notification per owner/approver (Telegram if linked; otherwise recorded as
 * not deliverable). Delivery happens in a separate job; failure never rolls back detection.
 */
export async function createNotifications(db: Db, orgId: string, n: { kind: string; incidentId: string | null; text: ReturnType<typeof msg>; dedupe: string; userIds?: string[] }) {
  const recipients = n.userIds
    ? n.userIds
    : (await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.status, 'active'), inArray(memberships.role, ['owner', 'approver'])))).map((m) => m.userId);
  for (const userId of recipients) {
    const [link] = await db.select().from(telegramLinks).where(and(eq(telegramLinks.orgId, orgId), eq(telegramLinks.userId, userId), isNull(telegramLinks.unlinkedAt), sql`${telegramLinks.chatId} IS NOT NULL`));
    const [row] = await db
      .insert(notifications)
      .values({ orgId, userId, channel: link ? 'telegram' : 'web', kind: n.kind, incidentId: n.incidentId, text: n.text, linkPath: n.incidentId ? `/app/incidents/${n.incidentId}` : '/app/overview', dedupeKey: `${n.dedupe}:${userId}`, status: link ? 'pending' : 'not_linked' })
      .onConflictDoNothing()
      .returning({ id: notifications.id });
    if (row && link) await enqueue(db, { orgId, type: 'notify.deliver', payload: { notificationId: row.id }, dedupeKey: `notify.deliver:${row.id}` });
  }
}

export async function notifyIncident(db: Db, orgId: string, incidentId: string) {
  const [inc] = await db.select().from(incidents).where(and(eq(incidents.orgId, orgId), eq(incidents.id, incidentId)));
  if (!inc || inc.state === 'dismissed') return;
  const key = inc.family === 'records_access' ? 'notify.app_needs_review' : inc.family === 'scam_campaign' ? 'notify.messages_need_review' : 'notify.device_needs_review';
  await createNotifications(db, orgId, { kind: 'incident', incidentId, text: msg(key), dedupe: `incident:${incidentId}:${inc.version}` });
}
