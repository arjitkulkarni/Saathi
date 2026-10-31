import { entryHash, GENESIS_HASH, signedCheckpointBytes, verifyCheckpointSignature, type SignedCheckpoint, type SignedEntry } from './chain';
import { b64ToBytes, bytesToHex, hexToBytes, sha256, verifyHashSignature } from './crypto';
import { commitment, rootFileBytes, rootFromPath, type PathStep } from './merkle';
import { bitcoinAttestations, parseDetached, summarizeProof, verifyBitcoinAttestation, type BlockHeaderInfo } from './ots';

// Offline evidence bundle verifier (build.md Ph15.6, Ph16.7; flow.md §11.3).
// Each check reports independently so a green result cannot hide a missing check.

export const BUNDLE_FORMAT = 'saathi-evidence-bundle';
export const RETAINED_FORMAT = 'saathi-retained-checkpoint';

export type EvidenceBundle = {
  format: typeof BUNDLE_FORMAT;
  version: 1;
  orgRef: string;
  exportedAt: string;
  scopeNote: string;
  entries: SignedEntry[];
  checkpoint: SignedCheckpoint;
  anchor: null | {
    nonceHex: string;
    commitmentHex: string;
    merkleVersion: number;
    path: PathStep[];
    rootHex: string;
    rootFileB64: string;
    otsB64: string | null;
    serverStatus: string;
    serverVerification: null | { method: string; height: number; blockHash: string; merkleRootHex: string; verifiedAt: string };
    isSample?: boolean;
  };
};

export type RetainedCheckpoint = { format: typeof RETAINED_FORMAT; checkpoint: SignedCheckpoint };
export type TrustedKey = { keyId: string; publicKeyHex: string };

export type CheckStatus = 'pass' | 'fail' | 'not_checked' | 'pending';
export type CheckId = 'hashes' | 'links' | 'signatures' | 'bundle_checkpoint' | 'retained_checkpoint' | 'membership' | 'blockchain';
export type CheckResultRow = { id: CheckId; status: CheckStatus; message: string; details?: string[] };

export type VerifyInput = {
  bundle: unknown;
  retained?: unknown;
  trustedKeys: TrustedKey[];
  /** Block header from an independently validated chain source, if available. */
  chainContext?: BlockHeaderInfo | null;
};

function keyFor(keys: TrustedKey[], keyId: string) {
  return keys.find((k) => k.keyId === keyId)?.publicKeyHex ?? null;
}

export function verifyBundle(input: VerifyInput): { rows: CheckResultRow[]; integrityOk: boolean } {
  const rows: CheckResultRow[] = [];
  const b = input.bundle as EvidenceBundle;
  if (!b || b.format !== BUNDLE_FORMAT || b.version !== 1 || !Array.isArray(b.entries) || !b.checkpoint) {
    rows.push({ id: 'hashes', status: 'fail', message: 'This file is not a Saathi evidence bundle (version 1).' });
    return { rows, integrityOk: false };
  }
  const entries = b.entries;

  // 1. Hash recomputation
  const badHashes: string[] = [];
  for (const e of entries) {
    try {
      if (entryHash(e) !== e.hash) badHashes.push(`Entry ${e.seq}: content does not match its recorded fingerprint`);
    } catch (err) {
      badHashes.push(`Entry ${e.seq}: cannot be serialized canonically (${(err as Error).message})`);
    }
  }
  rows.push(
    badHashes.length
      ? { id: 'hashes', status: 'fail', message: `${badHashes.length} entr${badHashes.length === 1 ? 'y was' : 'ies were'} altered after signing.`, details: badHashes }
      : { id: 'hashes', status: 'pass', message: `All ${entries.length} entry fingerprints recompute correctly.` },
  );

  // 2. Sequence and links
  const linkProblems: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (i === 0) {
      if (e.seq === 1 && e.prevHash !== GENESIS_HASH) linkProblems.push('Entry 1 does not start from the genesis value');
    } else {
      const prev = entries[i - 1];
      if (e.seq !== prev.seq + 1) linkProblems.push(`Sequence jumps from ${prev.seq} to ${e.seq} (missing or reordered entries)`);
      if (e.prevHash !== prev.hash) linkProblems.push(`Entry ${e.seq} does not link to entry ${prev.seq}`);
    }
  }
  if (entries.length && entries[0].seq !== 1) linkProblems.push(`Bundle starts at entry ${entries[0].seq}; earlier history is not included`);
  rows.push(
    linkProblems.length
      ? { id: 'links', status: 'fail', message: 'The history is not a complete ordered chain.', details: linkProblems }
      : { id: 'links', status: 'pass', message: 'Entries are in order and each links to the previous one.' },
  );

  // 3. Signatures with independently trusted keys
  const sigProblems: string[] = [];
  for (const e of entries) {
    const pk = keyFor(input.trustedKeys, e.keyId);
    if (!pk) sigProblems.push(`Entry ${e.seq}: key "${e.keyId}" is not in the trusted key list`);
    else if (!verifyHashSignature(e.hash, e.signature, pk)) sigProblems.push(`Entry ${e.seq}: signature does not verify`);
  }
  rows.push(
    sigProblems.length
      ? { id: 'signatures', status: 'fail', message: 'Some signatures are missing, untrusted or invalid.', details: sigProblems }
      : { id: 'signatures', status: 'pass', message: 'Every entry is signed by a trusted Saathi evidence key.' },
  );

  // 4. Bundle checkpoint consistency
  const cp = b.checkpoint;
  const cpKey = keyFor(input.trustedKeys, cp.keyId);
  const last = entries[entries.length - 1];
  const cpProblems: string[] = [];
  if (!cpKey) cpProblems.push(`Checkpoint key "${cp.keyId}" is not trusted`);
  else {
    const v = verifyCheckpointSignature(cp, cpKey);
    if (!v.hashOk) cpProblems.push('Checkpoint content was altered');
    else if (!v.signatureOk) cpProblems.push('Checkpoint signature does not verify');
  }
  if (!last) cpProblems.push('Bundle contains no entries');
  else if (cp.seq !== last.seq || cp.headHash !== last.hash) cpProblems.push(`Checkpoint names entry ${cp.seq} but the bundle ends at entry ${last.seq}`);
  rows.push(
    cpProblems.length
      ? { id: 'bundle_checkpoint', status: 'fail', message: 'The bundle does not match its own signed checkpoint.', details: cpProblems }
      : { id: 'bundle_checkpoint', status: 'pass', message: `Signed checkpoint matches entry ${cp.seq}.` },
  );

  // 5. Separately retained checkpoint (catches truncation to an earlier valid chain)
  const r = input.retained as RetainedCheckpoint | undefined;
  if (!r) {
    rows.push({ id: 'retained_checkpoint', status: 'not_checked', message: 'No retained checkpoint supplied. Truncation or rewriting to another valid history cannot be ruled out.' });
  } else if (r.format !== RETAINED_FORMAT || !r.checkpoint) {
    rows.push({ id: 'retained_checkpoint', status: 'fail', message: 'The retained checkpoint file is not in the expected format.' });
  } else {
    const rc = r.checkpoint;
    const rk = keyFor(input.trustedKeys, rc.keyId);
    const problems: string[] = [];
    if (!rk || !verifyCheckpointSignature(rc, rk).signatureOk) problems.push('Retained checkpoint signature does not verify with a trusted key');
    if (rc.orgRef !== b.orgRef) problems.push('Retained checkpoint belongs to a different organization reference');
    const at = entries.find((e) => e.seq === rc.seq);
    if (last && rc.seq > last.seq) problems.push(`Bundle ends at entry ${last.seq}, but you retained a checkpoint at entry ${rc.seq}: later history is missing`);
    else if (!at) problems.push(`Entry ${rc.seq} named by the retained checkpoint is not in the bundle`);
    else if (at.hash !== rc.headHash) problems.push(`Entry ${rc.seq} differs from the version you retained: history was rewritten`);
    rows.push(
      problems.length
        ? { id: 'retained_checkpoint', status: 'fail', message: 'The bundle does not match the checkpoint you retained.', details: problems }
        : { id: 'retained_checkpoint', status: 'pass', message: rc.seq === last?.seq ? 'Bundle matches the checkpoint you retained.' : `Bundle extends the checkpoint you retained at entry ${rc.seq}.` },
    );
  }

  // 6. Commitment and Merkle membership
  const a = b.anchor;
  let otsTimestamp: ReturnType<typeof parseDetached>['timestamp'] | null = null;
  if (!a) {
    rows.push({ id: 'membership', status: 'not_checked', message: 'No timestamp material is included for this checkpoint.' });
  } else {
    const problems: string[] = [];
    try {
      const c = bytesToHex(commitment(hexToBytes(a.nonceHex), signedCheckpointBytes(cp)));
      if (c !== a.commitmentHex) problems.push('Commitment does not match the checkpoint and nonce');
      if (rootFromPath(a.commitmentHex, a.path) !== a.rootHex) problems.push('Merkle path does not lead to the batch root');
      const rootFile = b64ToBytes(a.rootFileB64);
      if (bytesToHex(rootFile) !== bytesToHex(rootFileBytes(a.rootHex))) problems.push('Batch root file bytes do not encode the batch root');
      if (a.otsB64) {
        const parsed = parseDetached(b64ToBytes(a.otsB64));
        if (bytesToHex(parsed.fileDigest) !== bytesToHex(sha256(rootFile))) problems.push('Timestamp proof is for a different file');
        else otsTimestamp = parsed.timestamp;
      }
    } catch (err) {
      problems.push(`Timestamp material is malformed: ${(err as Error).message}`);
    }
    rows.push(
      problems.length
        ? { id: 'membership', status: 'fail', message: 'This checkpoint is not proven to be part of the timestamped batch.', details: problems }
        : { id: 'membership', status: 'pass', message: 'Checkpoint commitment belongs to the timestamped batch root.' },
    );
  }

  // 7. Bitcoin timestamp — only with independently validated chain context
  if (!a || !a.otsB64) {
    rows.push({ id: 'blockchain', status: 'not_checked', message: 'No independent timestamp proof is included.' });
  } else if (!otsTimestamp) {
    rows.push({ id: 'blockchain', status: 'fail', message: 'The timestamp proof could not be used.' });
  } else {
    const btc = bitcoinAttestations(otsTimestamp);
    const summary = summarizeProof(otsTimestamp);
    if (btc.length === 0) {
      rows.push({ id: 'blockchain', status: 'pending', message: `Independent timestamp pending: submitted to ${summary.pendingCalendars.length} calendar(s), no Bitcoin attestation yet.` });
    } else if (!input.chainContext) {
      rows.push({
        id: 'blockchain',
        status: 'not_checked',
        message: `The blockchain timestamp has not been checked offline. The proof claims Bitcoin block ${btc.map((x) => x.height).join(', ')}; checking it needs a trusted Bitcoin node or validated block header.`,
      });
    } else {
      const v = verifyBitcoinAttestation(otsTimestamp, input.chainContext);
      rows.push({ id: 'blockchain', status: v.ok ? 'pass' : 'fail', message: v.ok ? `Bitcoin block ${input.chainContext.height} contains this commitment (checked against the header you supplied).` : v.reason });
    }
  }

  const integrityIds: CheckId[] = ['hashes', 'links', 'signatures', 'bundle_checkpoint'];
  const integrityOk = rows.filter((x) => integrityIds.includes(x.id)).every((x) => x.status === 'pass');
  return { rows, integrityOk };
}
