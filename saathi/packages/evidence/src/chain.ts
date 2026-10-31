import { canonicalBytes, normTime } from './canonical';
import { sha256Hex, signHash, verifyHashSignature } from './crypto';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const GENESIS_HASH = '0'.repeat(64);

/** Fields covered by the entry hash (build.md Ph15.2). */
export type EntryBody = {
  schemaVersion: number;
  seq: number;
  orgRef: string;
  type: string;
  occurredAt: string;
  recordedAt: string;
  payload: unknown;
  prevHash: string;
};

export type SignedEntry = EntryBody & { hash: string; signature: string; keyId: string };

export function entryHash(body: EntryBody): string {
  return sha256Hex(
    canonicalBytes({
      schemaVersion: body.schemaVersion,
      seq: body.seq,
      orgRef: body.orgRef,
      type: body.type,
      occurredAt: normTime(body.occurredAt),
      recordedAt: normTime(body.recordedAt),
      payload: body.payload,
      prevHash: body.prevHash,
    }),
  );
}

export function signEntry(body: EntryBody, secretKey: Uint8Array, keyId: string): SignedEntry {
  const normalized = { ...body, occurredAt: normTime(body.occurredAt), recordedAt: normTime(body.recordedAt) };
  const hash = entryHash(normalized);
  return { ...normalized, hash, signature: signHash(hash, secretKey), keyId };
}

export type CheckpointBody = {
  schemaVersion: number;
  kind: 'saathi-checkpoint';
  orgRef: string;
  seq: number;
  headHash: string;
  createdAt: string;
  keyId: string;
};
export type SignedCheckpoint = CheckpointBody & { hash: string; signature: string };

export function checkpointHash(body: CheckpointBody): string {
  return sha256Hex(
    canonicalBytes({
      schemaVersion: body.schemaVersion,
      kind: body.kind,
      orgRef: body.orgRef,
      seq: body.seq,
      headHash: body.headHash,
      createdAt: normTime(body.createdAt),
      keyId: body.keyId,
    }),
  );
}

export function signCheckpoint(body: Omit<CheckpointBody, 'schemaVersion' | 'kind'>, secretKey: Uint8Array): SignedCheckpoint {
  const full: CheckpointBody = { schemaVersion: EVIDENCE_SCHEMA_VERSION, kind: 'saathi-checkpoint', ...body, createdAt: normTime(body.createdAt) };
  const hash = checkpointHash(full);
  return { ...full, hash, signature: signHash(hash, secretKey) };
}

/** Exact canonical bytes of a signed checkpoint; input to the anchor commitment. */
export function signedCheckpointBytes(cp: SignedCheckpoint): Uint8Array {
  return canonicalBytes({
    schemaVersion: cp.schemaVersion,
    kind: cp.kind,
    orgRef: cp.orgRef,
    seq: cp.seq,
    headHash: cp.headHash,
    createdAt: normTime(cp.createdAt),
    keyId: cp.keyId,
    hash: cp.hash,
    signature: cp.signature,
  });
}

export function verifyCheckpointSignature(cp: SignedCheckpoint, publicKeyHex: string): { hashOk: boolean; signatureOk: boolean } {
  const recomputed = checkpointHash(cp);
  return { hashOk: recomputed === cp.hash, signatureOk: recomputed === cp.hash && verifyHashSignature(cp.hash, cp.signature, publicKeyHex) };
}
