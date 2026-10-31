import { and, count, desc, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import {
  msg,
  SaathiError,
  type CoverageSummaryDTO,
  type HealthDTO,
  type IntegrationDTO,
  type Msg,
  type OverviewDTO,
  type PersonCardDTO,
  type PersonDetailDTO,
  type RestrictionDTO,
} from '@saathi/contracts';
import { computeHealth, type DevicePostureInput } from '@saathi/domain';
import type { Db } from '../client';
import {
  actions,
  appSessions,
  dependencies,
  deviceAccounts,
  devices,
  eventDispositions,
  grants,
  incidents,
  integrations,
  notifications,
  rawEvents,
  recoveryCases,
  restrictions,
  staff,
} from '../schema';
import { requireMembership, type Actor } from './core';
import { incidentCards } from './incidents';
import { deviceFreshness, INTEGRATION_STALE_SECONDS } from './snapshot';

export async function coverageSummary(db: Db, orgId: string, now = new Date()): Promise<CoverageSummaryDTO> {
  const devs = await db.select().from(devices).where(and(eq(devices.orgId, orgId), notInArray(devices.status, ['retired', 'revoked'])));
  const ints = await db.select().from(integrations).where(and(eq(integrations.orgId, orgId), sql`${integrations.kind} <> 'device_agent'`));
  const deps = await db.select({ confidence: dependencies.confidence }).from(dependencies).where(eq(dependencies.orgId, orgId));
  const fr = devs.map((d) => (d.status === 'waiting' ? 'waiting' : deviceFreshness(d.lastSeenAt, now)));
  const lastObs = [...devs.map((d) => d.lastEventAt ?? d.lastSeenAt), ...ints.map((i) => i.lastEventAt)].filter(Boolean) as Date[];
  const enforceable = ints.filter((i) => i.canEnforce && i.status === 'connected').length;
  return {
    devices: {
      total: devs.length,
      fresh: fr.filter((f) => f === 'fresh').length,
      stale: fr.filter((f) => f === 'stale').length,
      offline: fr.filter((f) => f === 'offline' || f === 'never').length,
      waiting: fr.filter((f) => f === 'waiting').length,
      simulated: devs.filter((d) => d.simulated).length,
    },
    applications: {
      enforceable,
      readOnly: ints.filter((i) => !i.canEnforce && i.canObserve && i.status !== 'revoked').length,
      unconnected: ints.filter((i) => !i.canObserve && !i.canEnforce).length,
      failed: ints.filter((i) => i.status === 'failed').length,
    },
    unknownDependencies: deps.filter((d) => d.confidence === 'unknown' || d.confidence === 'low').length,
    incompleteChecks: devs.reduce((n, d) => n + d.prerequisites.filter((p) => !p.met).length, 0),
    lastObservationAt: lastObs.length ? new Date(Math.max(...lastObs.map((d) => d.getTime()))).toISOString() : null,
    hasAnySource: devs.some((d) => d.status === 'connected') || enforceable > 0 || ints.some((i) => i.canObserve && i.status !== 'revoked' && i.status !== 'unconnected'),
  };
}

async function activeLimits(db: Db, orgId: string, now: Date): Promise<RestrictionDTO[]> {
  const rows = await db
    .select()
    .from(restrictions)
    .where(and(eq(restrictions.orgId, orgId), isNull(restrictions.liftedAt), eq(restrictions.kind, 'throttle'), sql`${restrictions.expiresAt} > ${now}`));
  const labels = rows.length ? await db.select({ id: appSessions.id, label: appSessions.label }).from(appSessions).where(inArray(appSessions.id, rows.map((r) => r.targetId))) : [];
  return rows.map((r) => ({
    id: r.id,
    kind: 'throttle',
    targetType: r.targetType as 'session',
    targetLabel: labels.find((l) => l.id === r.targetId)?.label ?? '',
    ratePerMinute: r.ratePerMinute,
    startsAt: r.startsAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    source: r.source as 'auto_guard',
    incidentId: r.incidentId,
  }));
}

export async function healthInputs(db: Db, orgId: string, now = new Date()): Promise<DevicePostureInput[]> {
  const devs = await db.select().from(devices).where(and(eq(devices.orgId, orgId), notInArray(devices.status, ['retired', 'revoked'])));
  const postures = await db.execute<{ device_id: string; checks: DevicePostureInput['checks'] }>(sql`SELECT DISTINCT ON (device_id) device_id, checks FROM device_posture WHERE org_id = ${orgId} ORDER BY device_id, revision DESC`);
  return devs.map((d) => ({
    deviceId: d.id,
    name: d.name,
    status: d.status,
    stale: deviceFreshness(d.lastSeenAt, now) !== 'fresh',
    simulated: d.simulated,
    supportedActions: d.capabilities.filter((c) => c.supported).map((c) => c.action),
    checks: postures.rows.find((p) => p.device_id === d.id)?.checks ?? null,
  }));
}

export async function getHealth(db: Db, actor: Actor): Promise<HealthDTO> {
  await requireMembership(db, actor, 'health.read');
  return computeHealth(await healthInputs(db, actor.orgId), new Date().toISOString());
}

export async function getOverview(db: Db, actor: Actor, opts: { sinceDays?: number } = {}): Promise<OverviewDTO> {
  await requireMembership(db, actor, 'overview.read');
  const now = new Date();
  const since = new Date(now.getTime() - (opts.sinceDays ?? 7) * 86400_000);
  const needRows = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), inArray(incidents.state, ['open', 'investigating']), eq(incidents.urgency, 'needs_attention'))).orderBy(desc(incidents.updatedAt));
  const reviewRows = await db
    .select()
    .from(incidents)
    .where(and(eq(incidents.orgId, actor.orgId), sql`((${incidents.state} IN ('open','investigating') AND ${incidents.urgency} <> 'needs_attention') OR ${incidents.state} IN ('contained','recovering'))`))
    .orderBy(desc(incidents.updatedAt));
  const recent = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), inArray(actions.state, ['confirmed', 'partial', 'failed', 'unknown', 'expired']))).orderBy(desc(actions.updatedAt)).limit(5);
  const [{ n: rawCount }] = await db.select({ n: count() }).from(rawEvents).where(and(eq(rawEvents.orgId, actor.orgId), gte(rawEvents.observedAt, since)));
  const disp = await db.select({ d: eventDispositions.disposition, n: count() }).from(eventDispositions).where(and(eq(eventDispositions.orgId, actor.orgId), gte(eventDispositions.createdAt, since))).groupBy(eventDispositions.disposition);
  const [{ n: incCount }] = await db.select({ n: count() }).from(incidents).where(and(eq(incidents.orgId, actor.orgId), gte(incidents.openedAt, since)));
  const [{ n: replay }] = await db.select({ n: count() }).from(rawEvents).where(and(eq(rawEvents.orgId, actor.orgId), eq(rawEvents.isReplay, true), gte(rawEvents.observedAt, since)));
  const [{ n: pendingRecovery }] = await db.select({ n: count() }).from(recoveryCases).where(and(eq(recoveryCases.orgId, actor.orgId), inArray(recoveryCases.status, ['in_progress', 'blocked'])));
  const [{ n: notifFail }] = await db.select({ n: count() }).from(notifications).where(and(eq(notifications.orgId, actor.orgId), inArray(notifications.status, ['failed', 'unavailable']), gte(notifications.createdAt, since)));
  const healthIn = await healthInputs(db, actor.orgId, now);
  const health = healthIn.some((d) => d.status === 'connected') ? computeHealth(healthIn, now.toISOString()) : null;
  return {
    needsAttention: await incidentCards(db, actor.orgId, needRows.slice(0, 3), now),
    needsAttentionTotal: needRows.length,
    reviewToday: await incidentCards(db, actor.orgId, reviewRows.slice(0, 5), now),
    reviewTodayTotal: reviewRows.length,
    recentlyHandled: recent.map((a) => ({
      id: a.id,
      actionType: a.actionType as OverviewDTO['recentlyHandled'][number]['actionType'],
      title: msg(`action.title.${a.actionType.replace('.', '_')}`),
      state: a.state as OverviewDTO['recentlyHandled'][number]['state'],
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      incidentId: a.incidentId,
      outcome: msg(`action.outcome.${a.state}`),
    })),
    temporaryLimits: await activeLimits(db, actor.orgId, now),
    coverage: await coverageSummary(db, actor.orgId, now),
    health: health ? { earned: health.earned, unknownPoints: health.unknownPoints, devicesCounted: health.devicesCounted } : null,
    funnel: { since: since.toISOString(), rawEvents: Number(rawCount), dispositions: Object.fromEntries(disp.map((d) => [d.d, Number(d.n)])), incidents: Number(incCount), replayIncluded: Number(replay) > 0 },
    pendingRecovery: Number(pendingRecovery),
    notificationFailures: Number(notifFail),
    refreshedAt: now.toISOString(),
  };
}

// ------------------------------------------------------------------ people

export async function listPeople(db: Db, actor: Actor): Promise<PersonCardDTO[]> {
  await requireMembership(db, actor, 'people.read');
  const people = await db.select().from(staff).where(eq(staff.orgId, actor.orgId)).orderBy(staff.displayName);
  const sess = await db.select({ staffId: appSessions.staffId, id: appSessions.id, status: appSessions.status }).from(appSessions).where(eq(appSessions.orgId, actor.orgId));
  const now = new Date();
  const rs = await db.select({ targetId: restrictions.targetId }).from(restrictions).where(and(eq(restrictions.orgId, actor.orgId), isNull(restrictions.liftedAt), sql`(${restrictions.expiresAt} IS NULL OR ${restrictions.expiresAt} > ${now})`));
  const restricted = new Set(rs.map((r) => r.targetId));
  return people.map((p) => {
    const mine = sess.filter((s) => s.staffId === p.id && s.status === 'active');
    return {
      id: p.id,
      name: p.displayName,
      status: p.status as 'active' | 'offboarded',
      sharedAccount: p.sharedAccount,
      activeSessions: mine.length,
      restrictedSessions: mine.filter((s) => restricted.has(s.id) || restricted.has(p.id)).length,
    };
  });
}

export async function getPerson(db: Db, actor: Actor, id: string): Promise<PersonDetailDTO> {
  await requireMembership(db, actor, 'people.read');
  const [card] = (await listPeople(db, actor)).filter((p) => p.id === id);
  if (!card) throw new SaathiError('NOT_FOUND', 'Person not found.');
  const now = new Date();
  const sess = await db.select({ s: appSessions, integrationName: integrations.name }).from(appSessions).innerJoin(integrations, eq(integrations.id, appSessions.integrationId)).where(and(eq(appSessions.orgId, actor.orgId), eq(appSessions.staffId, id))).orderBy(desc(appSessions.createdAt));
  const rs = await db.select().from(restrictions).where(and(eq(restrictions.orgId, actor.orgId), isNull(restrictions.liftedAt), sql`(${restrictions.expiresAt} IS NULL OR ${restrictions.expiresAt} > ${now})`, inArray(restrictions.targetId, [id, ...sess.map((x) => x.s.id)])));
  const gr = await db.select({ capability: grants.capability, integrationName: integrations.name }).from(grants).innerJoin(integrations, eq(integrations.id, grants.integrationId)).where(and(eq(grants.orgId, actor.orgId), eq(grants.staffId, id)));
  const accts = await db.select({ username: deviceAccounts.username, isAdmin: deviceAccounts.isAdmin, deviceName: devices.name }).from(deviceAccounts).innerJoin(devices, eq(devices.id, deviceAccounts.deviceId)).where(and(eq(deviceAccounts.orgId, actor.orgId), eq(deviceAccounts.staffId, id)));
  const deps = (await db.select().from(dependencies).where(eq(dependencies.orgId, actor.orgId))).filter((d) => d.subjectIds.includes(id));
  const incRows = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.subjectStaffId, id))).orderBy(desc(incidents.updatedAt)).limit(10);
  const toDto = (r: (typeof rs)[number], label: string): RestrictionDTO => ({ id: r.id, kind: r.kind as RestrictionDTO['kind'], targetType: r.targetType as RestrictionDTO['targetType'], targetLabel: label, ratePerMinute: r.ratePerMinute, startsAt: r.startsAt.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null, source: r.source as RestrictionDTO['source'], incidentId: r.incidentId });
  return {
    ...card,
    sessions: sess.map(({ s, integrationName }) => ({
      id: s.id,
      label: s.label,
      integrationName,
      status: s.status as 'active' | 'paused' | 'revoked',
      familiar: s.familiar,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt?.toISOString() ?? null,
      restrictions: rs.filter((r) => r.targetId === s.id || r.targetId === id).map((r) => toDto(r, r.targetId === id ? card.name : s.label)),
    })),
    grants: gr,
    deviceAccounts: accts,
    dependencies: deps.map((d) => ({ id: d.id, description: d.description, confidence: d.confidence, declaredAt: d.declaredAt.toISOString() })),
    incidents: await incidentCards(db, actor.orgId, incRows, now),
  };
}

// ------------------------------------------------------------------ integrations

const INTEGRATION_TEXT: Record<string, { caps: string[]; limits: string[] }> = {
  records_reference: { caps: ['integration.cap.observe_sessions', 'integration.cap.enforce_per_request', 'integration.cap.throttle', 'integration.cap.probe'], limits: ['integration.limit.synthetic', 'integration.limit.delivered_bytes'] },
  device_agent: { caps: ['integration.cap.device_events', 'integration.cap.device_actions'], limits: ['integration.limit.enrolled_only'] },
  read_only: { caps: ['integration.cap.observe_only'], limits: ['integration.limit.cannot_block'] },
  unconnected: { caps: [], limits: ['integration.limit.no_visibility'] },
};

export function integrationDto(i: typeof integrations.$inferSelect, now = new Date()): IntegrationDTO {
  const age = i.lastEventAt ? (now.getTime() - i.lastEventAt.getTime()) / 1000 : null;
  const freshness = i.kind === 'unconnected' ? 'never' : age === null ? 'never' : age < INTEGRATION_STALE_SECONDS ? 'fresh' : 'stale';
  const t = INTEGRATION_TEXT[i.kind] ?? { caps: [], limits: [] };
  return {
    id: i.id,
    name: i.name,
    kind: i.kind,
    status: i.revokedAt ? 'revoked' : i.status,
    canObserve: i.canObserve,
    canEnforce: i.canEnforce,
    lastEventAt: i.lastEventAt?.toISOString() ?? null,
    freshness,
    isReference: i.kind === 'records_reference',
    capabilities: t.caps.map((k) => msg(k)),
    limits: t.limits.map((k) => msg(k)) as Msg[],
  };
}

export async function listIntegrations(db: Db, actor: Actor) {
  await requireMembership(db, actor, 'devices.read');
  return (await db.select().from(integrations).where(eq(integrations.orgId, actor.orgId)).orderBy(integrations.name)).map((i) => integrationDto(i));
}
