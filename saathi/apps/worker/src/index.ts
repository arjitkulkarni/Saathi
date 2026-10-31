import { fileURLToPath } from 'node:url';
import { aiConfigFromEnv, parseEnv, WorkerEnv } from '@saathi/contracts/env';
import { aiConfigured, aiVisionConfigured, closePools, enqueue, getPool, storeFromEnv, withTx, type AnchorConfig } from '@saathi/db';
import type { FetchLike } from '@saathi/evidence';
import { keyPairFromSeed } from '@saathi/evidence';
import { buildHandlers, type WorkerDeps } from './handlers';
import { JobRuntime } from './runtime';

// Persistent worker process (build.md §2): detection, notifications, command and evidence
// signing, retries, reports and timestamp anchoring. Private signing keys live only here.

export function createWorker(source: Record<string, string | undefined> = process.env) {
  const env = parseEnv(WorkerEnv, source, 'Saathi worker');
  const pool = getPool(env.DATABASE_URL_WORKER ?? env.DATABASE_URL, 6);
  const log: WorkerDeps['log'] = (level, m, extra) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg: m, worker: env.WORKER_ID, ...extra });
    if (level === 'error') console.error(line);
    else if (level === 'warn' || env.NODE_ENV !== 'test') console.log(line);
  };
  const evd = keyPairFromSeed(env.EVIDENCE_SIGNING_PRIVATE_KEY);
  const cmd = keyPairFromSeed(env.COMMAND_SIGNING_PRIVATE_KEY);
  if (evd.publicKeyHex === cmd.publicKeyHex) throw new Error('Evidence and command signing keys must be different keys.');
  const anchor: AnchorConfig = {
    backend: env.OTS_BACKEND,
    calendars: env.OTS_CALENDAR_ALLOWLIST.split(',').map((x) => x.trim()).filter(Boolean),
    pythonBin: env.OTS_PYTHON_BIN,
    verifier: env.BITCOIN_VERIFIER,
    rpc: env.BITCOIN_RPC_URL ? { url: env.BITCOIN_RPC_URL, user: env.BITCOIN_RPC_USER, password: env.BITCOIN_RPC_PASSWORD } : undefined,
    esploraUrl: env.BITCOIN_ESPLORA_URL,
    fetch: (async (url, init) => {
      const r = await fetch(url, { method: init?.method, headers: init?.headers, body: init?.body as BodyInit | undefined, signal: init?.signal ?? AbortSignal.timeout(15_000) });
      return { status: r.status, arrayBuffer: () => r.arrayBuffer() };
    }) as FetchLike,
  };
  const deps: WorkerDeps = { pool, env, evidenceKey: { keyId: env.EVIDENCE_SIGNING_KEY_ID, secretKey: evd.secretKey }, commandKey: { keyId: env.COMMAND_SIGNING_KEY_ID, secretKey: cmd.secretKey }, store: storeFromEnv(source), anchor, log };
  const runtime = new JobRuntime({ pool, workerId: env.WORKER_ID, handlers: buildHandlers(deps), concurrency: 4, log });
  return { env, pool, deps, runtime, log };
}

/**
 * Scheduler: enqueues periodic jobs with time-bucketed dedupe keys, so several worker
 * processes can run it without duplicating work.
 */
export async function scheduleTick(deps: WorkerDeps, now = new Date()) {
  const minute = Math.floor(now.getTime() / 60_000);
  const orgIds = await withTx(deps.pool, {}, async (_db, c) => (await c.query('SELECT saathi_worker_org_ids() AS id')).rows.map((r) => r.id as string));
  await withTx(deps.pool, {}, async (db) => {
    await enqueue(db, { orgId: null, type: 'anchor.batch', payload: {}, dedupeKey: `anchor.batch:sched:${Math.floor(minute / 2)}` });
    await enqueue(db, { orgId: null, type: 'anchor.upgrade', payload: {}, dedupeKey: `anchor.upgrade:${Math.floor(minute / 10)}` });
  });
  for (const orgId of orgIds) {
    await withTx(deps.pool, { orgId }, async (db) => {
      await enqueue(db, { orgId, type: 'org.maintenance', payload: {}, dedupeKey: `org.maintenance:${orgId}:${minute}` });
      await enqueue(db, { orgId, type: 'retention', payload: {}, dedupeKey: `retention:${orgId}:${Math.floor(minute / 60)}` });
      await enqueue(db, { orgId, type: 'digest.weekly', payload: {}, dedupeKey: `digest.weekly:${orgId}:${Math.floor(minute / (60 * 24))}` });
    });
  }
}

async function main() {
  const { runtime, deps, log } = createWorker();
  const ai = aiConfigFromEnv(deps.env);
  log('info', 'worker starting', { anchorBackend: deps.anchor.backend, verifier: deps.anchor.verifier, storage: deps.store.label, telegram: !!deps.env.TELEGRAM_BOT_TOKEN, aiProvider: ai.provider, aiText: aiConfigured(ai), aiVision: aiVisionConfigured(ai) });
  runtime.start(1000);
  const tick = () => scheduleTick(deps).catch((e) => log('warn', 'scheduler tick failed', { error: (e as Error).message }));
  await tick();
  const timer = setInterval(tick, 30_000);
  const shutdown = async () => {
    clearInterval(timer);
    await runtime.stop();
    await closePools();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
