import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import type { Freshness, Snapshot } from '@saathi/contracts';
import type { Db } from '../client';
import { appSessions, dependencies, deviceAccounts, devicePosture, devices, grants, integrations, orgPolicy, restrictions, staff } from '../schema';

export const DEVICE_FRESH_SECONDS = 120;
export const DEVICE_STALE_SECONDS = 15 * 60;
export const INTEGRATION_STALE_SECONDS = 24 * 3600;

export function deviceFreshness(lastSeenAt: Date | null, now = new Date()): Freshness {
  if (!lastSeenAt) return 'never';
  const age = (now.getTime() - lastSeenAt.getTime()) / 1000;
  if (age <= DEVICE_FRESH_SECONDS) return 'fresh';
  if (age <= DEVICE_STALE_SECONDS) return 'stale';
  return 'offline';
}

/**
 * Load the organization's known state (build.md Ph07.1). Call inside a tenant transaction,
 * after taking the relevant guard locks when the result is used for a decision.
 * `subjectIds` limits sessions/grants/restrictions to those people (gateway fast path).
 */
export async function loadSnapshot(db: Db, orgId: string, at: Date, scope: { subjectIds?: string[] } = {}): Promise<Snapshot> {
  const subjFilter = scope.subjectIds && scope.subjectIds.length ? inArray(staff.id, scope.subjectIds) : undefined;
  // Sequential: one checked-out client runs one query at a time.
  const policyRows = await db.select().from(orgPolicy).where(eq(orgPolicy.orgId, orgId));
  const subjectRows = await db.select().from(staff).where(subjFilter ? and(eq(staff.orgId, orgId), subjFilter) : eq(staff.orgId, orgId));
  const integrationRows = await db.select().from(integrations).where(eq(integrations.orgId, orgId));
  const dependencyRows = await db.select().from(dependencies).where(eq(dependencies.orgId, orgId));
  const deviceRows = await db.select().from(devices).where(eq(devices.orgId, orgId));
  const subjectIds = subjectRows.map((s) => s.id);
  const sessionRows = subjectIds.length ? await db.select().from(appSessions).where(and(eq(appSessions.orgId, orgId), inArray(appSessions.staffId, subjectIds))) : [];
  const grantRows = subjectIds.length ? await db.select().from(grants).where(and(eq(grants.orgId, orgId), inArray(grants.staffId, subjectIds))) : [];
  const targetIds = [...subjectIds, ...sessionRows.map((s) => s.id)];
  const restrictionRows = targetIds.length
    ? await db
        .select()
        .from(restrictions)
        .where(and(eq(restrictions.orgId, orgId), inArray(restrictions.targetId, targetIds), isNull(restrictions.liftedAt), or(isNull(restrictions.expiresAt), gt(restrictions.expiresAt, at))))
    : [];
  const deviceIds = deviceRows.map((d) => d.id);
  const accountRows = deviceIds.length ? await db.select().from(deviceAccounts).where(and(eq(deviceAccounts.orgId, orgId), inArray(deviceAccounts.deviceId, deviceIds))) : [];
  const postureRows = deviceIds.length ? await db.select().from(devicePosture).where(and(eq(devicePosture.orgId, orgId), inArray(devicePosture.deviceId, deviceIds))) : [];
  const latestPosture = new Map<string, (typeof postureRows)[number]>();
  for (const p of postureRows) if (!latestPosture.has(p.deviceId) || latestPosture.get(p.deviceId)!.revision < p.revision) latestPosture.set(p.deviceId, p);

  const p = policyRows[0];
  return {
    orgId,
    observedAt: at.toISOString(),
    policyVersion: p?.version ?? 0,
    policy: {
      autoThrottleEnabled: p?.autoThrottleEnabled ?? false,
      throttleRatePerMinute: p?.throttleRatePerMinute ?? 1,
      throttleDurationMinutes: p?.throttleDurationMinutes ?? 30,
      burstThreshold: p?.burstThreshold ?? 20,
      burstWindowSeconds: p?.burstWindowSeconds ?? 120,
      dailyLimit: p?.dailyLimit ?? 100,
    },
    subjects: subjectRows.map((s) => ({ id: s.id, label: s.displayName, status: s.status as 'active' | 'offboarded', sharedAccount: s.sharedAccount })),
    sessions: sessionRows.map((s) => ({ id: s.id, subjectId: s.staffId, integrationId: s.integrationId, label: s.label, status: s.status as 'active' | 'paused' | 'revoked', familiar: s.familiar })),
    grants: grantRows.map((g) => ({ subjectId: g.staffId, integrationId: g.integrationId, capability: g.capability as Snapshot['grants'][number]['capability'] })),
    restrictions: restrictionRows.map((r) => ({
      id: r.id,
      targetType: r.targetType as 'session' | 'subject',
      targetId: r.targetId,
      kind: r.kind as 'throttle' | 'pause' | 'disable_account',
      ratePerMinute: r.ratePerMinute,
      expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
      source: r.source as 'auto_guard' | 'action',
    })),
    integrations: integrationRows.map((i) => {
      const stale = i.kind === 'read_only' && i.lastEventAt && (at.getTime() - i.lastEventAt.getTime()) / 1000 > INTEGRATION_STALE_SECONDS;
      return { id: i.id, name: i.name, kind: i.kind, canObserve: i.canObserve, canEnforce: i.canEnforce, status: stale ? 'stale' : i.status, lastEventAt: i.lastEventAt?.toISOString() ?? null };
    }),
    dependencies: dependencyRows.map((d) => ({
      id: d.id,
      description: d.description,
      kind: d.kind,
      confidence: d.confidence as 'high' | 'medium' | 'low' | 'unknown',
      subjectIds: d.subjectIds,
      deviceIds: d.deviceIds,
      declaredAt: d.declaredAt.toISOString(),
    })),
    devices: deviceRows
      .filter((d) => d.status !== 'retired' && d.status !== 'revoked')
      .map((d) => ({
        id: d.id,
        name: d.name,
        freshness: deviceFreshness(d.lastSeenAt, at),
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        supportedActions: d.capabilities.filter((c) => c.supported).map((c) => c.action),
        simulated: d.simulated,
        posture: latestPosture.get(d.id) ? { revision: latestPosture.get(d.id)!.revision } : null,
        accounts: accountRows
          .filter((a) => a.deviceId === d.id)
          .map((a) => ({ sid: a.sid, username: a.username, isAdmin: a.isAdmin, enabled: a.enabled, protected: a.isAgentIdentity || a.isRecoveryIdentity })),
      })),
  };
}
