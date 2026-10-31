import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { SaathiError, type Role } from '@saathi/contracts';
import { can, type Permission } from '@saathi/domain';
import type { Db } from '../client';
import { evidenceChainHeads, evidenceIntents, jobs, memberships, policyGuards } from '../schema';

// ------------------------------------------------------------------ secrets

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (key: string, data: string) => createHmac('sha256', key).update(data).digest('hex');
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM with a key kept outside the database (build.md §4). */
export function encryptSecret(plaintext: string, keyB64url: string): string {
  const key = Buffer.from(keyB64url, 'base64url');
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}
export function decryptSecret(ciphertext: string, keyB64url: string): string {
  const [v, iv, tag, ct] = ciphertext.split('.');
  if (v !== 'v1') throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keyB64url, 'base64url'), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

// ------------------------------------------------------------------ actors

export type Actor = { userId: string; orgId: string; role: Role; sessionCreatedAt: Date; name: string };

/**
 * Fresh authority check inside the transaction (lock order step 1). The membership row is
 * read FOR SHARE so a concurrent role change waits for this transaction, and a revoked or
 * downgraded member fails even if their page was open earlier.
 */
export async function requireMembership(db: Db, actor: Actor, permission: Permission): Promise<{ role: Role; version: number }> {
  const rows = await db
    .select({ role: memberships.role, status: memberships.status, version: memberships.version })
    .from(memberships)
    .where(and(eq(memberships.orgId, actor.orgId), eq(memberships.userId, actor.userId)))
    .for('share');
  const m = rows[0];
  if (!m || m.status !== 'active') throw new SaathiError('FORBIDDEN', 'You no longer have access to this organization.');
  if (!can(m.role as Role, permission)) throw new SaathiError('FORBIDDEN', 'You no longer have permission for this action.');
  return { role: m.role as Role, version: m.version };
}

// ------------------------------------------------------------------ guard rows

/**
 * Guard-row protocol (build.md Ph04.4). Lock order:
 *   1 membership (FOR SHARE) → 2 org guard → 3 subject/device guards sorted → 4 preview →
 *   5 domain rows → 6 evidence chain head (via recordIntent, always last).
 * Every writer that can change a subject's effective access takes its subject guard.
 */
export async function lockGuards(db: Db, orgId: string, keys: string[], orgMode: 'share' | 'update' | 'none' = 'share') {
  const all = [...(orgMode === 'none' ? [] : ['org']), ...[...new Set(keys)].filter((k) => k !== 'org').sort()];
  if (all.length === 0) return new Map<string, number>();
  await db
    .insert(policyGuards)
    .values(all.map((guardKey) => ({ orgId, guardKey })))
    .onConflictDoNothing();
  const revisions = new Map<string, number>();
  if (orgMode !== 'none') {
    const r = await db
      .select({ revision: policyGuards.revision })
      .from(policyGuards)
      .where(and(eq(policyGuards.orgId, orgId), eq(policyGuards.guardKey, 'org')))
      .for(orgMode === 'update' ? 'update' : 'share');
    revisions.set('org', r[0]?.revision ?? 0);
  }
  for (const k of all.filter((x) => x !== 'org')) {
    const r = await db
      .select({ revision: policyGuards.revision })
      .from(policyGuards)
      .where(and(eq(policyGuards.orgId, orgId), eq(policyGuards.guardKey, k)))
      .for('update');
    revisions.set(k, r[0]?.revision ?? 0);
  }
  return revisions;
}

export async function bumpGuards(db: Db, orgId: string, keys: string[]) {
  if (keys.length === 0) return;
  await db
    .update(policyGuards)
    .set({ revision: sql`${policyGuards.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(policyGuards.orgId, orgId), inArray(policyGuards.guardKey, keys)));
}

// ------------------------------------------------------------------ evidence intents

/**
 * Durable evidence intent written in the same transaction as the state change
 * (build.md Ph03.2). The per-org sequence comes from the chain-head row, locked last, so
 * sequences commit in order without gaps (decision D-007). Failure aborts the mutation.
 */
export async function recordIntent(db: Db, orgId: string, type: string, payload: Record<string, unknown>, opts: { incidentId?: string | null; occurredAt?: Date } = {}) {
  await db.insert(evidenceChainHeads).values({ orgId }).onConflictDoNothing();
  const [head] = await db
    .update(evidenceChainHeads)
    .set({ nextIntentSeq: sql`${evidenceChainHeads.nextIntentSeq} + 1` })
    .where(eq(evidenceChainHeads.orgId, orgId))
    .returning({ seq: sql<number>`${evidenceChainHeads.nextIntentSeq} - 1` });
  const [intent] = await db
    .insert(evidenceIntents)
    .values({ orgId, seq: Number(head.seq), type, payload: stripUndefined(payload), incidentId: opts.incidentId ?? null, occurredAt: opts.occurredAt ?? new Date() })
    .returning({ id: evidenceIntents.id, seq: evidenceIntents.seq });
  await enqueue(db, { orgId, type: 'evidence.sign', payload: {}, dedupeKey: `evidence.sign:${orgId}:${intent.seq}` });
  return intent;
}

function stripUndefined(v: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'number' && !Number.isSafeInteger(x) ? String(x) : x)));
}

// ------------------------------------------------------------------ jobs (transactional outbox)

export async function enqueue(db: Db, j: { orgId: string | null; type: string; payload: Record<string, unknown>; dedupeKey: string; runAt?: Date; maxAttempts?: number }) {
  await db
    .insert(jobs)
    .values({ orgId: j.orgId, type: j.type, payload: j.payload, dedupeKey: j.dedupeKey, runAt: j.runAt ?? new Date(), maxAttempts: j.maxAttempts ?? 8 })
    .onConflictDoNothing({ target: jobs.dedupeKey });
}

export function nowIso() {
  return new Date().toISOString();
}

/**
 * Enqueue a global (org-less) job from inside a tenant transaction. RLS only admits global
 * jobs without tenant context, so the transaction-local context is cleared and restored.
 */
export async function enqueueGlobal(db: Db, j: { type: string; payload: Record<string, unknown>; dedupeKey: string; runAt?: Date }) {
  const prev = await db.execute<{ v: string | null }>(sql`SELECT current_setting('app.org_id', true) AS v`);
  await db.execute(sql`SELECT set_config('app.org_id', '', true)`);
  try {
    await enqueue(db, { orgId: null, ...j });
  } finally {
    await db.execute(sql`SELECT set_config('app.org_id', ${prev.rows[0]?.v ?? ''}, true)`);
  }
}
