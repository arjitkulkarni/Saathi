import { randomUUID } from 'node:crypto';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type pg from 'pg';
import { msg, SaathiError, type ActorDTO, type Locale, type MemberDTO, type OrgType, type Role, type Vocabulary } from '@saathi/contracts';
import { withTx, type Db } from '../client';
import {
  authUser,
  dependencies,
  evidenceChainHeads,
  integrations,
  invitations,
  memberships,
  organizations,
  orgPolicy,
  orgPolicyVersions,
  policyGuards,
  rawEvents,
  telegramLinks,
  userPreferences,
} from '../schema';
import { bumpGuards, enqueue, lockGuards, newToken, recordIntent, requireMembership, sha256, type Actor } from './core';

export const SETUP_STEPS = ['organization', 'people', 'sources', 'automation', 'notifications', 'review', 'done'] as const;

/** Memberships for a signed-in user (RLS: readable via app.user_id). */
export async function listMembershipsForUser(db: Db, userId: string) {
  return db
    .select({ orgId: memberships.orgId, role: memberships.role, status: memberships.status, orgName: organizations.name })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
    .orderBy(organizations.name);
}

export async function getPreferences(db: Db, userId: string) {
  const [p] = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId));
  return p ?? null;
}

export async function setPreferences(db: Db, userId: string, p: { locale?: Locale | null; activeOrgId?: string | null }) {
  await db
    .insert(userPreferences)
    .values({ userId, locale: p.locale ?? null, activeOrgId: p.activeOrgId ?? null })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...(p.locale !== undefined ? { locale: p.locale } : {}), ...(p.activeOrgId !== undefined ? { activeOrgId: p.activeOrgId } : {}), updatedAt: new Date() } });
}

/** Build the actor DTO from current membership (fresh read; no cached authority). */
export async function loadActor(db: Db, user: { id: string; name: string; email: string }, orgId: string, sessionCreatedAt: Date): Promise<{ actor: Actor; dto: ActorDTO } | null> {
  const all = await listMembershipsForUser(db, user.id);
  const m = all.find((x) => x.orgId === orgId);
  if (!m) return null;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const prefs = await getPreferences(db, user.id);
  const actor: Actor = { userId: user.id, orgId, role: m.role as Role, sessionCreatedAt, name: user.name };
  return {
    actor,
    dto: {
      userId: user.id,
      name: user.name,
      email: user.email,
      orgId,
      orgName: org.name,
      role: m.role as Role,
      locale: ((prefs?.locale as Locale) ?? (org.locale as Locale)) || 'en',
      vocabulary: org.vocabulary as Vocabulary,
      orgType: org.orgType as OrgType,
      timezone: org.timezone,
      isDemo: org.isDemo,
      setupComplete: org.setupComplete,
      memberships: all.map((x) => ({ orgId: x.orgId, orgName: x.orgName, role: x.role as Role })),
    },
  };
}

const VOCAB_FOR_TYPE: Record<string, Vocabulary> = { clinic: 'clinic', retail: 'shop', education: 'school', ngo: 'ngo', service: 'generic', office: 'generic', other: 'generic' };

/** Onboarding: org + owner membership + initial policy + guards, in one transaction. */
export async function createOrganization(pool: pg.Pool, user: { id: string }, input: { name: string; orgType: OrgType; locale: Locale; timezone: string; workStart: string; workEnd: string; workDays: number[] }) {
  const orgId = randomUUID();
  return withTx(pool, { orgId, userId: user.id }, async (db) => {
    await db.insert(organizations).values({
      id: orgId,
      name: input.name.slice(0, 120),
      orgType: input.orgType,
      vocabulary: VOCAB_FOR_TYPE[input.orgType] ?? 'generic',
      locale: input.locale,
      timezone: input.timezone,
      workStart: input.workStart,
      workEnd: input.workEnd,
      workDays: input.workDays,
      setupStep: 'people',
      recoveryUserId: user.id,
    });
    await db.insert(memberships).values({ orgId, userId: user.id, role: 'owner' });
    // Broad interventions default to off; temporary throttling requires explicit consent.
    await db.insert(orgPolicy).values({ orgId, version: 1, autoThrottleEnabled: false, updatedBy: user.id });
    await db.insert(orgPolicyVersions).values({ orgId, version: 1, snapshot: { autoThrottleEnabled: false }, changedBy: user.id });
    await db.insert(policyGuards).values({ orgId, guardKey: 'org' });
    await db.insert(evidenceChainHeads).values({ orgId });
    await db.insert(integrations).values([
      { orgId, kind: 'records_reference', name: 'Records workspace (reference app)', canObserve: true, canEnforce: true, status: 'connected', config: { synthetic: true } },
      { orgId, kind: 'device_agent', name: 'Saathi Windows agent', canObserve: true, canEnforce: true, status: 'connected' },
    ]);
    await recordIntent(db, orgId, 'organization.created', { orgType: input.orgType, by: user.id });
    await setPreferences(db, user.id, { activeOrgId: orgId });
    return { orgId };
  });
}

export async function updateOrganization(db: Db, actor: Actor, patch: Partial<{ name: string; orgType: OrgType; locale: Locale; timezone: string; workStart: string; workEnd: string; workDays: number[]; vocabulary: Vocabulary; recoveryContact: string; notificationPrefs: Record<string, unknown>; setupStep: string; setupComplete: boolean; retention: { telemetryDays: number; messageImageHours: number; reportDays: number } }>) {
  await requireMembership(db, actor, 'org.manage');
  const [org] = await db.select().from(organizations).where(eq(organizations.id, actor.orgId)).for('update');
  if (!org) throw new SaathiError('NOT_FOUND', 'Organization not found.');
  // Changing the organization type also switches its vocabulary pack unless one is given explicitly.
  const values = patch.orgType && !patch.vocabulary ? { ...patch, vocabulary: VOCAB_FOR_TYPE[patch.orgType] ?? 'generic' } : patch;
  await db.update(organizations).set({ ...values, profileVersion: org.profileVersion + 1 }).where(eq(organizations.id, actor.orgId));
  await recordIntent(db, actor.orgId, 'organization.updated', { fields: Object.keys(patch), profileVersion: org.profileVersion + 1, by: actor.userId });
  return { profileVersion: org.profileVersion + 1 };
}

export async function getPolicy(db: Db, actor: Actor) {
  await requireMembership(db, actor, 'incidents.read');
  const [p] = await db.select().from(orgPolicy).where(eq(orgPolicy.orgId, actor.orgId));
  return p;
}

/**
 * Versioned automation consent (build.md Ph11.1). Takes the org guard FOR UPDATE so policy
 * changes serialize with protected requests and approvals that read the policy version.
 */
export async function updatePolicy(db: Db, actor: Actor, input: { autoThrottleEnabled: boolean; throttleRatePerMinute: number; throttleDurationMinutes: number; burstThreshold: number; burstWindowSeconds: number; dailyLimit: number; expectedVersion: number }) {
  await requireMembership(db, actor, 'policy.manage');
  await lockGuards(db, actor.orgId, [], 'update');
  const [p] = await db.select().from(orgPolicy).where(eq(orgPolicy.orgId, actor.orgId)).for('update');
  if (p.version !== input.expectedVersion) throw new SaathiError('CONFLICT', 'The policy changed since you opened it. Review the current version.', { currentVersion: p.version });
  const version = p.version + 1;
  const { expectedVersion: _e, ...values } = input;
  void _e;
  await db
    .update(orgPolicy)
    .set({
      ...values,
      version,
      consentVersion: input.autoThrottleEnabled ? version : null,
      consentedBy: input.autoThrottleEnabled ? actor.userId : null,
      consentedAt: input.autoThrottleEnabled ? new Date() : null,
      updatedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(eq(orgPolicy.orgId, actor.orgId));
  await db.insert(orgPolicyVersions).values({ orgId: actor.orgId, version, snapshot: { ...values, scope: 'records_reference_only', namedActions: ['temporary_throttle'] }, changedBy: actor.userId });
  await bumpGuards(db, actor.orgId, ['org']);
  await recordIntent(db, actor.orgId, 'policy.changed', { version, ...values, by: actor.userId });
  return { version };
}

// ------------------------------------------------------------------ members

export async function createInvitation(db: Db, actor: Actor, email: string, role: Role) {
  await requireMembership(db, actor, 'members.manage');
  const token = newToken(24);
  const expiresAt = new Date(Date.now() + 72 * 3600 * 1000);
  await db.insert(invitations).values({ orgId: actor.orgId, email: email.toLowerCase().slice(0, 200), role, tokenHash: sha256(token), expiresAt, invitedBy: actor.userId });
  await recordIntent(db, actor.orgId, 'member.invited', { role, by: actor.userId });
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function acceptInvitation(pool: pg.Pool, user: { id: string; email: string }, token: string) {
  const found = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, invitation_id FROM saathi_invitation_lookup($1)', [sha256(token)])).rows[0]);
  if (!found) throw new SaathiError('NOT_FOUND', 'This invitation is not valid.');
  return withTx(pool, { orgId: found.org_id, userId: user.id }, async (db) => {
    const [inv] = await db.select().from(invitations).where(eq(invitations.id, found.invitation_id)).for('update');
    if (!inv || inv.acceptedAt) throw new SaathiError('CONFLICT', 'This invitation was already used.');
    if (inv.expiresAt.getTime() < Date.now()) throw new SaathiError('CONFLICT', 'This invitation has expired. Ask the owner for a new one.');
    if (inv.email !== user.email.toLowerCase()) throw new SaathiError('FORBIDDEN', 'This invitation was issued to a different email address.');
    await db.insert(memberships).values({ orgId: inv.orgId, userId: user.id, role: inv.role }).onConflictDoUpdate({ target: [memberships.orgId, memberships.userId], set: { role: inv.role, status: 'active', updatedAt: new Date() } });
    await db.update(invitations).set({ acceptedAt: new Date(), acceptedBy: user.id }).where(eq(invitations.id, inv.id));
    await recordIntent(db, inv.orgId, 'member.joined', { userId: user.id, role: inv.role });
    return { orgId: inv.orgId };
  });
}

export async function listMembers(db: Db, actor: Actor): Promise<MemberDTO[]> {
  await requireMembership(db, actor, 'members.manage');
  const rows = await db.select({ m: memberships, name: authUser.name, email: authUser.email }).from(memberships).innerJoin(authUser, eq(authUser.id, memberships.userId)).where(eq(memberships.orgId, actor.orgId)).orderBy(authUser.name);
  const links = await db.select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId }).from(telegramLinks).where(and(eq(telegramLinks.orgId, actor.orgId), isNull(telegramLinks.unlinkedAt)));
  return rows.map(({ m, name, email }) => ({ id: m.id, userId: m.userId, name, email, role: m.role as Role, status: m.status as 'active' | 'revoked', isSelf: m.userId === actor.userId, telegramLinked: links.some((l) => l.userId === m.userId && l.chatId) }));
}

/** Role/status change. FOR UPDATE on the membership blocks concurrent approvals by that member. */
export async function updateMember(db: Db, actor: Actor, membershipId: string, patch: { role?: Role; status?: 'active' | 'revoked' }) {
  await requireMembership(db, actor, 'members.manage');
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.id, membershipId))).for('update');
  if (!m) throw new SaathiError('NOT_FOUND', 'Member not found.');
  if (m.userId === actor.userId) throw new SaathiError('FORBIDDEN', 'You cannot change your own role or access.');
  if (m.role === 'owner' && (patch.role !== 'owner' || patch.status === 'revoked')) {
    const owners = (await db.select().from(memberships).where(and(eq(memberships.orgId, actor.orgId), eq(memberships.role, 'owner'), eq(memberships.status, 'active')))).length;
    if (owners <= 1) throw new SaathiError('CONFLICT', 'An organization must keep at least one active owner.');
  }
  await db.update(memberships).set({ ...patch, version: m.version + 1, updatedAt: new Date() }).where(eq(memberships.id, m.id));
  await recordIntent(db, actor.orgId, 'member.changed', { membershipId, ...patch, by: actor.userId });
}

// ------------------------------------------------------------------ dependencies & integrations

export async function addDependency(db: Db, actor: Actor, d: { kind: string; description: string; confidence: string; subjectIds?: string[]; deviceIds?: string[]; integrationIds?: string[] }) {
  await requireMembership(db, actor, 'org.manage');
  const keys = (d.subjectIds ?? []).map((s) => `subject:${s}`);
  await lockGuards(db, actor.orgId, keys, 'share');
  const [row] = await db.insert(dependencies).values({ orgId: actor.orgId, kind: d.kind, description: d.description.slice(0, 300), confidence: d.confidence, subjectIds: d.subjectIds ?? [], deviceIds: d.deviceIds ?? [], integrationIds: d.integrationIds ?? [], declaredBy: actor.userId }).returning({ id: dependencies.id });
  await bumpGuards(db, actor.orgId, keys);
  await recordIntent(db, actor.orgId, 'dependency.declared', { dependencyId: row.id, kind: d.kind, confidence: d.confidence, by: actor.userId });
  return row;
}

export async function listDependencies(db: Db, actor: Actor) {
  await requireMembership(db, actor, 'people.read');
  return db.select().from(dependencies).where(eq(dependencies.orgId, actor.orgId)).orderBy(desc(dependencies.declaredAt));
}

export async function addIntegration(db: Db, actor: Actor, input: { name: string; kind: 'read_only' | 'unconnected' }) {
  await requireMembership(db, actor, 'integrations.manage');
  const [row] = await db.insert(integrations).values({ orgId: actor.orgId, kind: input.kind, name: input.name.slice(0, 80), canObserve: input.kind === 'read_only', canEnforce: false, status: input.kind === 'read_only' ? 'read_only' : 'unconnected' }).returning({ id: integrations.id });
  await recordIntent(db, actor.orgId, 'integration.added', { integrationId: row.id, kind: input.kind, by: actor.userId });
  return row;
}

/** Owner-visible disconnect / connector key rotation / test (build.md Ph17.7). Credentials are write-only. */
export async function patchIntegration(db: Db, actor: Actor, id: string, patch: { name?: string; action?: 'revoke' | 'rotate_connector_key' | 'test' }) {
  await requireMembership(db, actor, 'integrations.manage');
  const [i] = await db.select().from(integrations).where(and(eq(integrations.orgId, actor.orgId), eq(integrations.id, id))).for('update');
  if (!i) throw new SaathiError('NOT_FOUND', 'Integration not found.');
  let connectorKey: string | null = null;
  let test: { ok: boolean; message: ReturnType<typeof msg> } | null = null;
  if (patch.name) await db.update(integrations).set({ name: patch.name.slice(0, 80) }).where(eq(integrations.id, id));
  if (patch.action === 'revoke') {
    await lockGuards(db, actor.orgId, [], 'update');
    await db.update(integrations).set({ status: 'revoked', revokedAt: new Date(), canEnforce: false, connectorKeyHash: null }).where(eq(integrations.id, id));
    await bumpGuards(db, actor.orgId, ['org']);
  } else if (patch.action === 'rotate_connector_key') {
    if (i.kind !== 'read_only') throw new SaathiError('UNSUPPORTED_ACTION', 'Only read-only connectors use a connector key.');
    connectorKey = newToken(32);
    await db.update(integrations).set({ connectorKeyHash: sha256(connectorKey) }).where(eq(integrations.id, id));
  } else if (patch.action === 'test') {
    const ok = i.kind === 'records_reference' ? i.status === 'connected' : i.kind === 'read_only' ? !!i.lastEventAt : false;
    test = { ok, message: msg(ok ? 'integration.test.ok' : i.kind === 'unconnected' ? 'integration.test.unconnected' : 'integration.test.no_events') };
    await db.update(integrations).set({ lastTestAt: new Date(), lastTestResult: test }).where(eq(integrations.id, id));
  }
  await recordIntent(db, actor.orgId, 'integration.changed', { integrationId: id, action: patch.action ?? 'rename', by: actor.userId });
  return { connectorKey, test };
}

/** Idempotent source events from an authenticated read-only connector. */
export async function ingestConnectorEvents(pool: pg.Pool, key: string, events: { id: string; type: string; observedAt: string; facts: Record<string, string | number | boolean | null> }[]) {
  const found = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, integration_id FROM saathi_connector_lookup($1)', [sha256(key)])).rows[0]);
  if (!found) throw new SaathiError('UNAUTHENTICATED', 'Connector key is not valid.');
  return withTx(pool, { orgId: found.org_id }, async (db) => {
    let accepted = 0;
    for (const e of events) {
      const r = await db.insert(rawEvents).values({ orgId: found.org_id, sourceType: 'integration', integrationId: found.integration_id, dedupeKey: `int:${found.integration_id}:${e.id}`, type: e.type, observedAt: new Date(e.observedAt), facts: e.facts }).onConflictDoNothing().returning({ id: rawEvents.id });
      accepted += r.length;
    }
    await db.update(integrations).set({ lastEventAt: new Date() }).where(eq(integrations.id, found.integration_id));
    if (accepted) await enqueue(db, { orgId: found.org_id, type: 'events.process', payload: {}, dedupeKey: `events.process:${found.org_id}:conn:${Date.now()}` });
    return { accepted, duplicates: events.length - accepted };
  });
}
