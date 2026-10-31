import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type pg from 'pg';
import type { AnchorState, AnchorStatusDTO } from '@saathi/contracts';
import {
  bitcoinAttestations,
  buildTree,
  bytesToHex,
  hexToBytes,
  MERKLE_VERSION,
  parseDetached,
  rootFileBytes,
  serializeDetached,
  sha256,
  stampDigest,
  summarizeProof,
  upgradeTimestamp,
  verifyBitcoinAttestation,
  type BlockHeaderInfo,
  type FetchLike,
} from '@saathi/evidence';
import { withTx, type Db } from '../client';
import { anchorBatches, anchorMembers, anchorProofs } from '../schema';
import { enqueue } from './core';

// Independent timestamping through OpenTimestamps (build.md Ph16). Runs only in the worker,
// asynchronously; incident handling never waits on it.

export type AnchorConfig = {
  backend: 'native' | 'python' | 'disabled';
  calendars: string[];
  pythonBin: string;
  verifier: 'none' | 'rpc' | 'esplora';
  rpc?: { url: string; user?: string; password?: string };
  esploraUrl?: string;
  fetch: FetchLike;
};

export const VERIFIER_LABEL = {
  rpc: 'Independent validating Bitcoin node (configured RPC)',
  esplora: 'Prototype external block-explorer API (trust dependency, not independent)',
  none: 'No Bitcoin verifier configured',
} as const;

/** Build one batch from every pending commitment across tenants, atomically. */
export async function buildBatch(pool: pg.Pool, orgIds: string[]) {
  return withTx(pool, {}, async (db, client) => {
    const pending: { id: string; orgId: string; commitmentHex: string }[] = [];
    for (const orgId of orgIds) {
      await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
      const rows = await db.select({ id: anchorMembers.id, orgId: anchorMembers.orgId, commitmentHex: anchorMembers.commitmentHex }).from(anchorMembers).where(isNull(anchorMembers.batchId)).for('update', { skipLocked: true });
      pending.push(...rows);
    }
    if (pending.length === 0) return null;
    const tree = buildTree(pending.map((p) => hexToBytes(p.commitmentHex)));
    await client.query("SELECT set_config('app.org_id', '', true)");
    const [batch] = await db.insert(anchorBatches).values({ merkleVersion: MERKLE_VERSION, rootHex: tree.rootHex, rootFile: Buffer.from(rootFileBytes(tree.rootHex)), status: 'pending' }).returning({ id: anchorBatches.id });
    await db.insert(anchorProofs).values({ batchId: batch.id, backend: 'pending', status: 'pending', nextAttemptAt: new Date() });
    for (const p of pending) {
      const leaf = tree.leaves.find((l) => l.commitmentHex === p.commitmentHex)!;
      await client.query("SELECT set_config('app.org_id', $1, true)", [p.orgId]);
      await db.update(anchorMembers).set({ batchId: batch.id, leafIndex: leaf.index, path: leaf.path }).where(eq(anchorMembers.id, p.id));
    }
    await client.query("SELECT set_config('app.org_id', '', true)");
    await enqueue(db, { orgId: null, type: 'anchor.submit', payload: { batchId: batch.id }, dedupeKey: `anchor.submit:${batch.id}` });
    return { batchId: batch.id, members: pending.length, rootHex: tree.rootHex };
  });
}

async function stampWithPython(rootFile: Uint8Array, cfg: AnchorConfig): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'saathi-ots-'));
  const file = join(dir, 'root.txt');
  try {
    await writeFile(file, rootFile);
    const script = join(process.cwd(), '..', '..', 'tools', 'anchor', 'ots_wrapper.py');
    // Argument array; no shell, no user-controlled strings.
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cfg.pythonBin, [script, 'stamp', file, ...cfg.calendars.flatMap((c) => ['--calendar', c])], { shell: false, timeout: 60_000 });
      let err = '';
      child.stderr.on('data', (d) => (err += d));
      child.on('error', reject);
      child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ots client exited ${code}: ${err.slice(0, 300)}`))));
    });
    return new Uint8Array(await readFile(`${file}.ots`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function backoff(attempts: number) {
  const base = Math.min(60 * 2 ** attempts, 6 * 3600);
  return new Date(Date.now() + (base + Math.random() * base * 0.2) * 1000);
}

/** Submit a batch root to calendars. Network I/O happens outside any transaction. */
export async function submitBatch(pool: pg.Pool, batchId: string, cfg: AnchorConfig) {
  const batch = await withTx(pool, {}, async (db) => (await db.select().from(anchorBatches).where(eq(anchorBatches.id, batchId)))[0]);
  if (!batch) return;
  const [proof] = await withTx(pool, {}, (db) => db.select().from(anchorProofs).where(eq(anchorProofs.batchId, batchId)));
  if (proof && ['submitted', 'confirmed'].includes(proof.status)) return;
  if (cfg.backend === 'disabled') {
    await withTx(pool, {}, (db) => db.update(anchorProofs).set({ status: 'failed', lastError: 'Timestamping disabled by configuration (OTS_BACKEND=disabled)', updatedAt: new Date() }).where(eq(anchorProofs.batchId, batchId)));
    return;
  }
  const rootFile = new Uint8Array(batch.rootFile);
  let ots: Uint8Array | null = null;
  let error: string | null = null;
  let calendars: string[] = [];
  try {
    if (cfg.backend === 'python') {
      ots = await stampWithPython(rootFile, cfg);
      calendars = cfg.calendars;
    } else {
      const { timestamp, outcomes } = await stampDigest(sha256(rootFile), cfg.calendars, cfg.fetch);
      calendars = outcomes.filter((o) => o.ok).map((o) => o.calendar);
      if (calendars.length === 0) error = outcomes.map((o) => `${o.calendar}: ${o.error}`).join('; ');
      else ots = serializeDetached(timestamp);
    }
  } catch (e) {
    error = (e as Error).message;
  }
  await withTx(pool, {}, async (db) => {
    const attempts = (proof?.attempts ?? 0) + 1;
    if (ots) {
      await db
        .update(anchorProofs)
        .set({ backend: cfg.backend, otsBytes: Buffer.from(ots), status: 'submitted', calendars, attempts, lastAttemptAt: new Date(), submittedAt: new Date(), nextAttemptAt: new Date(Date.now() + 30 * 60 * 1000), lastError: null, updatedAt: new Date() })
        .where(eq(anchorProofs.batchId, batchId));
      await db.update(anchorBatches).set({ status: 'submitted' }).where(eq(anchorBatches.id, batchId));
    } else {
      const dead = attempts >= 8;
      await db
        .update(anchorProofs)
        .set({ backend: cfg.backend, status: dead ? 'failed' : 'retrying', attempts, lastAttemptAt: new Date(), nextAttemptAt: backoff(attempts), lastError: error, updatedAt: new Date() })
        .where(eq(anchorProofs.batchId, batchId));
      if (!dead) await enqueue(db, { orgId: null, type: 'anchor.submit', payload: { batchId }, dedupeKey: `anchor.submit:${batchId}:${attempts}`, runAt: backoff(attempts) });
    }
  });
}

export async function fetchBlockHeader(height: number, cfg: AnchorConfig): Promise<BlockHeaderInfo> {
  if (cfg.verifier === 'rpc' && cfg.rpc) {
    const call = async (method: string, params: unknown[]) => {
      const res = await cfg.fetch(cfg.rpc!.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.rpc!.user ? { Authorization: `Basic ${Buffer.from(`${cfg.rpc!.user}:${cfg.rpc!.password ?? ''}`).toString('base64')}` } : {}) },
        body: new TextEncoder().encode(JSON.stringify({ jsonrpc: '1.0', id: 'saathi', method, params })),
      });
      const body = JSON.parse(new TextDecoder().decode(await res.arrayBuffer()));
      if (body.error) throw new Error(body.error.message);
      return body.result;
    };
    const hash = await call('getblockhash', [height]);
    const header = await call('getblockheader', [hash]);
    return { height, blockHash: hash, merkleRootHex: header.merkleroot, time: header.time };
  }
  if (cfg.verifier === 'esplora' && cfg.esploraUrl) {
    const base = cfg.esploraUrl.replace(/\/+$/, '');
    const hash = new TextDecoder().decode(await (await cfg.fetch(`${base}/block-height/${height}`)).arrayBuffer()).trim();
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('unexpected block hash response');
    const block = JSON.parse(new TextDecoder().decode(await (await cfg.fetch(`${base}/block/${hash}`)).arrayBuffer()));
    return { height, blockHash: hash, merkleRootHex: block.merkle_root, time: block.timestamp };
  }
  throw new Error('No Bitcoin verifier configured');
}

/** Upgrade pending proofs and verify Bitcoin attestations with the configured method. */
export async function upgradeDueProofs(pool: pg.Pool, cfg: AnchorConfig, limit = 10) {
  const due = await withTx(pool, {}, (db) =>
    db
      .select()
      .from(anchorProofs)
      .where(and(or(eq(anchorProofs.status, 'submitted'), eq(anchorProofs.status, 'confirmed')), lte(anchorProofs.nextAttemptAt, new Date())))
      .limit(limit),
  );
  const results: { batchId: string; status: string; note: string }[] = [];
  for (const p of due) {
    if (!p.otsBytes) continue;
    let note = '';
    let status: string = p.status;
    let ots: Uint8Array = new Uint8Array(p.otsBytes);
    const update: Partial<typeof anchorProofs.$inferInsert> = {};
    try {
      const parsed = parseDetached(ots);
      if (p.status === 'submitted') {
        const up = await upgradeTimestamp(parsed.timestamp, cfg.calendars, cfg.fetch);
        if (up.changed) {
          ots = serializeDetached(parsed.timestamp);
          update.otsBytes = Buffer.from(ots);
        }
        note = up.results.map((r) => `${r.calendar}:${r.status}`).join(', ');
      }
      const atts = bitcoinAttestations(parsed.timestamp);
      if (atts.length > 0) {
        const height = Math.min(...atts.map((a) => a.height));
        update.bitcoinHeight = height;
        if (cfg.verifier === 'none') {
          note = 'Bitcoin attestation present; no verifier configured, so it is not reported as confirmed';
        } else {
          const header = await fetchBlockHeader(height, cfg);
          const v = verifyBitcoinAttestation(parsed.timestamp, header);
          if (v.ok) {
            status = 'confirmed';
            Object.assign(update, { blockHash: header.blockHash, merkleRootHex: header.merkleRootHex, verificationMethod: VERIFIER_LABEL[cfg.verifier], verifiedAt: new Date() });
          } else {
            // A previously confirmed proof that no longer matches (e.g. reorg) is downgraded.
            status = 'invalid';
            note = v.reason;
          }
        }
      }
    } catch (e) {
      note = `upgrade error: ${(e as Error).message}`;
    }
    const recheckIn = status === 'confirmed' ? 24 * 3600 * 1000 : 30 * 60 * 1000;
    await withTx(pool, {}, (db) =>
      db
        .update(anchorProofs)
        .set({ ...update, status, lastError: note || null, attempts: sql`${anchorProofs.attempts} + 1`, lastAttemptAt: new Date(), nextAttemptAt: new Date(Date.now() + recheckIn), updatedAt: new Date() })
        .where(eq(anchorProofs.id, p.id)),
    );
    results.push({ batchId: p.batchId, status, note });
  }
  return results;
}

/** Per-checkpoint anchor status as a user-meaningful state (flow.md §11.2). */
export async function anchorStatusForCheckpoint(db: Db, checkpointId: string, isSample: boolean): Promise<AnchorStatusDTO & { memberId: string | null }> {
  const [m] = await db.select().from(anchorMembers).where(eq(anchorMembers.checkpointId, checkpointId));
  const empty = { method: null, checkedAt: null, bitcoinHeight: null, blockHash: null, calendars: [], attempts: 0, lastError: null, isSample };
  if (!m) return { state: 'not_requested', ...empty, memberId: null };
  if (!m.batchId) return { state: 'pending', ...empty, memberId: m.id };
  const [p] = await db.select().from(anchorProofs).where(eq(anchorProofs.batchId, m.batchId));
  if (!p) return { state: 'pending', ...empty, memberId: m.id };
  const state: AnchorState = p.status === 'pending' ? 'pending' : (p.status as AnchorState);
  return {
    state,
    method: p.verificationMethod,
    checkedAt: (p.verifiedAt ?? p.lastAttemptAt)?.toISOString() ?? null,
    bitcoinHeight: p.bitcoinHeight,
    blockHash: p.blockHash,
    calendars: p.calendars,
    attempts: p.attempts,
    lastError: p.lastError,
    isSample,
    memberId: m.id,
  };
}

export function describeProof(ots: Uint8Array | null) {
  if (!ots) return null;
  try {
    return summarizeProof(parseDetached(ots).timestamp);
  } catch {
    return null;
  }
}

export { bytesToHex };
