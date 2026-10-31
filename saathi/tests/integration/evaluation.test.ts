import { appendFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools } from '../../packages/db/src/client';
import { runReplay } from '../../packages/db/src/services/demo';
import { createWorker } from '../../apps/worker/src/index';
import { fixtures, ownerClient, tx } from './helpers';

// build.md §7 A16 (normal business day → false alerts measured) and A17 (slow extraction
// below thresholds → limitation and miss recorded). Labelled replays go through the same
// worker correlation pipeline as live events; results are printed and recorded as measured.

let F: Awaited<ReturnType<typeof fixtures>>;
let W: ReturnType<typeof createWorker>;

beforeAll(async () => {
  F = await fixtures();
  W = createWorker({ ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_URL_WORKER: process.env.TEST_DATABASE_URL_WORKER, OTS_BACKEND: 'disabled', WORKER_ID: 'eval-worker', OBJECT_STORAGE_LOCAL_DIR: '.local/test-objects' });
});
afterAll(async () => closePools());

async function measure(runId: string) {
  const c = ownerClient();
  await c.connect();
  const r = await c.query(
    `SELECT d.disposition, count(*)::int n, count(DISTINCT d.incident_id)::int incidents
       FROM raw_events e LEFT JOIN event_dispositions d ON d.raw_event_id = e.id
      WHERE e.dedupe_key LIKE $1 GROUP BY d.disposition ORDER BY 1`,
    [`replay:${runId}:%`],
  );
  await c.end();
  return r.rows as { disposition: string | null; n: number; incidents: number }[];
}

describe('labelled replay evaluation', () => {
  it('A16: a normal business day is fully explained by dispositions; incidents counted as false alerts', async () => {
    const run = await tx(F.owner, (db) => runReplay(db, F.owner, 'normal_day'));
    await W.runtime.drain();
    const rows = await measure(run.runId);
    const falseAlerts = rows.reduce((s, r) => s + r.incidents, 0);
    appendFileSync('.local/eval-results.jsonl', JSON.stringify({ a16: { events: run.events, dispositions: rows, falseAlertIncidents: falseAlerts } }) + '\n');
    // Every event has a disposition (funnel explains every count).
    expect(rows.find((r) => r.disposition === null)).toBeUndefined();
    expect(rows.reduce((s, r) => s + r.n, 0)).toBe(run.events);
  });

  it('A17: slow extraction below thresholds is missed, and the miss is visible as dispositions', async () => {
    const run = await tx(F.owner, (db) => runReplay(db, F.owner, 'slow_extraction'));
    await W.runtime.drain();
    const rows = await measure(run.runId);
    const incidents = rows.reduce((s, r) => s + r.incidents, 0);
    appendFileSync('.local/eval-results.jsonl', JSON.stringify({ a17: { events: run.events, dispositions: rows, incidents } }) + '\n');
    expect(rows.find((r) => r.disposition === null)).toBeUndefined();
    expect(incidents).toBe(0); // documented limitation: no burst rule fires below thresholds
  });
});
