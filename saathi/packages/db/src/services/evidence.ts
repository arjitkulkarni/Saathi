import { and, asc, eq, gt, sql } from 'drizzle-orm';
import {
  bytesToHex,
  commitment,
  EVIDENCE_SCHEMA_VERSION,
  newNonce,
  signCheckpoint,
  signedCheckpointBytes,
  signEntry,
  type SignedCheckpoint,
} from '@saathi/evidence';
import type { Db } from '../client';
import { anchorMembers, checkpoints, evidenceChainHeads, evidenceEntries, evidenceIntents } from '../schema';
import { enqueue, enqueueGlobal } from './core';
import type { ObjectStore } from './storage';

export type SigningKey = { keyId: string; secretKey: Uint8Array };

export const orgRef = (orgId: string) => `org:${orgId}`;

/**
 * Sign pending intents in strict per-organization sequence (build.md Ph15.1). The chain
 * head row is locked for the whole run; a gap or an unserializable intent blocks later
 * signing and records an operational error instead of skipping it.
 */
export async function signPendingIntents(db: Db, orgId: string, key: SigningKey, now = new Date()) {
  const [head] = await db.select().from(evidenceChainHeads).where(eq(evidenceChainHeads.orgId, orgId)).for('update');
  if (!head) return { signed: 0, blocked: null as string | null };
  const pending = await db
    .select()
    .from(evidenceIntents)
    .where(and(eq(evidenceIntents.orgId, orgId), gt(evidenceIntents.seq, head.lastSignedSeq)))
    .orderBy(asc(evidenceIntents.seq))
    .limit(500);
  let lastSeq = Number(head.lastSignedSeq);
  let lastHash = head.lastHash;
  let signed = 0;
  let blocked: string | null = null;
  for (const intent of pending) {
    if (Number(intent.seq) !== lastSeq + 1) {
      blocked = `missing evidence intent ${lastSeq + 1} before ${intent.seq}`;
      break;
    }
    try {
      const entry = signEntry(
        {
          schemaVersion: EVIDENCE_SCHEMA_VERSION,
          seq: Number(intent.seq),
          orgRef: orgRef(orgId),
          type: intent.type,
          occurredAt: intent.occurredAt.toISOString(),
          recordedAt: now.toISOString(),
          payload: intent.payload,
          prevHash: lastHash,
        },
        key.secretKey,
        key.keyId,
      );
      await db.insert(evidenceEntries).values({
        orgId,
        seq: entry.seq,
        intentId: intent.id,
        schemaVersion: entry.schemaVersion,
        type: entry.type,
        occurredAt: entry.occurredAt,
        recordedAt: entry.recordedAt,
        payload: entry.payload,
        prevHash: entry.prevHash,
        hash: entry.hash,
        signature: entry.signature,
        keyId: entry.keyId,
      });
      await db.update(evidenceIntents).set({ status: 'signed' }).where(eq(evidenceIntents.id, intent.id));
      lastSeq = entry.seq;
      lastHash = entry.hash;
      signed++;
    } catch (e) {
      blocked = `intent ${intent.seq} could not be signed: ${(e as Error).message}`;
      await db.update(evidenceIntents).set({ status: 'signing_failed', error: blocked }).where(eq(evidenceIntents.id, intent.id));
      break;
    }
  }
  await db
    .update(evidenceChainHeads)
    .set({ lastSignedSeq: lastSeq, lastHash, blockedSeq: blocked ? lastSeq + 1 : null, blockedReason: blocked })
    .where(eq(evidenceChainHeads.orgId, orgId));
  return { signed, blocked, lastSeq, lastHash, lastCheckpointSeq: Number(head.lastCheckpointSeq), lastCheckpointAt: head.lastCheckpointAt };
}

/**
 * Create a signed checkpoint of the current chain head, retain a copy outside the database
 * (object storage / owner download), and request an independent timestamp for it.
 */
export async function createCheckpoint(db: Db, orgId: string, key: SigningKey, store: ObjectStore | null, opts: { requestedBy: string; anchor: boolean; now?: Date; isSample?: boolean }) {
  const now = opts.now ?? new Date();
  const [head] = await db.select().from(evidenceChainHeads).where(eq(evidenceChainHeads.orgId, orgId)).for('update');
  if (!head || Number(head.lastSignedSeq) === 0 || Number(head.lastSignedSeq) === Number(head.lastCheckpointSeq)) return null;
  const cp: SignedCheckpoint = signCheckpoint({ orgRef: orgRef(orgId), seq: Number(head.lastSignedSeq), headHash: head.lastHash, createdAt: now.toISOString(), keyId: key.keyId }, key.secretKey);
  let retainedRef: string | null = null;
  if (store) {
    retainedRef = `checkpoints/${orgId}/${cp.seq}.json`;
    await store.put(retainedRef, new TextEncoder().encode(JSON.stringify({ format: 'saathi-retained-checkpoint', checkpoint: cp }, null, 2)), 'application/json');
  }
  const [row] = await db
    .insert(checkpoints)
    .values({ orgId, seq: cp.seq, headHash: cp.headHash, createdAt: cp.createdAt, keyId: cp.keyId, hash: cp.hash, signature: cp.signature, retainedRef, isSample: opts.isSample ?? false })
    .returning({ id: checkpoints.id });
  await db.update(evidenceChainHeads).set({ lastCheckpointSeq: cp.seq, lastCheckpointAt: now }).where(eq(evidenceChainHeads.orgId, orgId));
  if (opts.anchor) await requestAnchor(db, orgId, row.id, cp, opts.requestedBy, now);
  return { id: row.id, checkpoint: cp };
}

/** Idempotent: one randomized commitment per checkpoint (build.md Ph16.1). */
export async function requestAnchor(db: Db, orgId: string, checkpointId: string, cp: SignedCheckpoint, requestedBy: string, now = new Date()) {
  const nonce = newNonce();
  const c = commitment(nonce, signedCheckpointBytes(cp));
  await db
    .insert(anchorMembers)
    .values({ orgId, checkpointId, nonceHex: bytesToHex(nonce), commitmentHex: bytesToHex(c), requestedBy })
    .onConflictDoNothing({ target: anchorMembers.checkpointId });
  await enqueueGlobal(db, { type: 'anchor.batch', payload: {}, dedupeKey: `anchor.batch:${Math.floor(now.getTime() / 120_000)}`, runAt: new Date(now.getTime() + 5_000) });
}

export function checkpointFromRow(r: typeof checkpoints.$inferSelect): SignedCheckpoint {
  return { schemaVersion: EVIDENCE_SCHEMA_VERSION, kind: 'saathi-checkpoint', orgRef: orgRef(r.orgId), seq: Number(r.seq), headHash: r.headHash, createdAt: r.createdAt, keyId: r.keyId, hash: r.hash, signature: r.signature };
}

export const _sql = sql;
