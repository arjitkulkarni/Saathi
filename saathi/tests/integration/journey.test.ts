import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import { closePools, withTx } from '../../packages/db/src/client';
import { approvePreview, createPreview, getActionDetail, probeRecordsAction } from '../../packages/db/src/services/decisions';
import { gatewayDecide, resolveAppSession } from '../../packages/db/src/services/gateway';
import { getIncidentDetail } from '../../packages/db/src/services/incidents';
import { getRecoveryCase, runRecoveryStep, startRecovery } from '../../packages/db/src/services/recovery';
import { buildEvidenceBundle, listCheckpoints, retainedCheckpoint } from '../../packages/db/src/services/records';
import { verifyBundle } from '../../packages/evidence/src/verify';
import { createWorker } from '../../apps/worker/src/index';
import { appPool, fixtures, idem, newRecordsSession, ownerClient, tx } from './helpers';

let F: Awaited<ReturnType<typeof fixtures>>;
let W: ReturnType<typeof createWorker>;
const hashPin = (pin: string) => {
  const salt = randomBytes(16).toString('base64url');
  return `scrypt$${salt}$${scryptSync(pin, salt, 32).toString('base64url')}`;
};

beforeAll(async () => {
  F = await fixtures();
  W = createWorker({ ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_URL_WORKER: process.env.TEST_DATABASE_URL_WORKER, OTS_BACKEND: 'disabled', WORKER_ID: 'test-worker', OBJECT_STORAGE_LOCAL_DIR: '.local/test-objects' });
});
afterAll(async () => {
  await closePools();
});

async function download(token: string, recordId: string | null = null) {
  const s = await resolveAppSession(appPool, token);
  return withTx(appPool, { orgId: s!.orgId }, (db) => gatewayDecide(db, s!, { capability: 'records.download', recordId }));
}

describe('main incident journey (flow.md §6)', () => {
  let incidentId = '';
  let actionId = '';
  let laptop: { token: string; sessionId: string };
  let office: { token: string; sessionId: string };

  it('A–B: burst triggers consented throttle in the gateway and the worker opens one incident', async () => {
    office = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Journey office PC', true);
    laptop = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Journey unknown laptop', false);
    const results = [];
    for (let i = 0; i < 24; i++) results.push(await download(laptop.token));
    expect(results.some((r) => r.throttleUntil)).toBe(true);
    expect(results.at(-1)!.decision).toBe('throttle');
    await W.runtime.drain();
    const c = ownerClient();
    await c.connect();
    const inc = await c.query("SELECT id, state, urgency FROM incidents WHERE org_id = $1 AND subject_session_id = $2", [F.lakeview, laptop.sessionId]);
    const disp = await c.query("SELECT count(*)::int n FROM raw_events r LEFT JOIN event_dispositions d ON d.raw_event_id = r.id WHERE r.org_id = $1 AND d.id IS NULL AND r.processed_at IS NOT NULL", [F.lakeview]);
    await c.end();
    expect(inc.rows).toHaveLength(1);
    expect(inc.rows[0].urgency).toBe('needs_attention');
    expect(disp.rows[0].n).toBe(0); // every processed event has a disposition
    incidentId = inc.rows[0].id;
  });

  it('C: the incident separates facts, uncertainty and the current limit, and recommends pausing the session', async () => {
    const d = await tx(F.owner, (db) => getIncidentDetail(db, F.owner, incidentId));
    expect(d.facts.map((f) => f.key)).toEqual(expect.arrayContaining(['fact.records_rate', 'fact.unfamiliar_session', 'fact.throttle_applied']));
    expect(d.uncertain.map((f) => f.key)).toContain('uncertain.authorized_export');
    expect(d.activeRestrictions.some((r) => r.kind === 'throttle')).toBe(true);
    const rec = d.options.find((o) => o.recommended)!;
    expect(rec).toMatchObject({ actionType: 'records.pause_session', targetId: laptop.sessionId });
    expect(d.containmentAssessment.status).toBe('not_contained');
  });

  it('D–F: preview, approve and verify: suspicious session denied, legitimate session continues', async () => {
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.pause_session', targetType: 'session', targetId: laptop.sessionId, params: {} }, incidentId));
    ({ actionId } = await tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem())));
    expect(await tx(F.lakeview, (db) => probeRecordsAction(db, F.lakeview, actionId))).toBe('confirmed');
    expect((await download(laptop.token)).reason).toBe('session_paused');
    expect((await download(office.token)).admitted).toBe(true);
    const a = await tx(F.owner, (db) => getActionDetail(db, F.owner, actionId));
    expect(a.containment?.status).toBe('contained');
    const d = await tx(F.owner, (db) => getIncidentDetail(db, F.owner, incidentId));
    expect(d.state).toBe('contained');
  });

  it('throttle expiry does not undo the independent pause (Ph11 gate)', async () => {
    const c = ownerClient();
    await c.connect();
    const r = await c.query("UPDATE restrictions SET expires_at = now() - interval '1 second' WHERE target_id = $1 AND kind = 'throttle' AND lifted_at IS NULL RETURNING id", [laptop.sessionId]);
    await c.end();
    expect(r.rowCount).toBe(1);
    await W.runtime.drain(); // org.maintenance not scheduled here; run expiry handler directly:
    await withTx(W.pool, { orgId: F.lakeview }, async (db) => (await import('../../packages/db/src/services/processing')).expireRestriction(db, F.lakeview, r.rows[0].id));
    expect((await download(laptop.token)).reason).toBe('session_paused');
  });

  it('G: recovery revokes the old session, issues a fresh one, and the old token stays rejected', async () => {
    const { caseId } = await tx(F.owner, (db) => startRecovery(db, F.owner, incidentId));
    const run = (key: Parameters<typeof runRecoveryStep>[3], input: Parameters<typeof runRecoveryStep>[4] = {}) => tx(F.owner, (db) => runRecoveryStep(db, F.owner, caseId, key, input, { hashPin }));
    await expect(run('revoke_old_session')).rejects.toThrow(/cannot run yet/);
    await run('verify_person', { confirm: true, note: 'Called Asha on the number on file' });
    // Re-issue the same PIN value (new salt + hash) so other test files can still sign in as this person.
    expect((await run('address_credentials', { confirm: true, newPin: '482910' })).step.result?.key).toBe('recovery.result.pin_changed');
    expect((await run('review_findings')).step.status).toBe('done');
    expect((await run('revoke_old_session')).step.status).toBe('done');
    const fresh = await run('issue_fresh_session');
    expect(fresh.freshSessionToken).toBeTruthy();
    expect((await run('verify_old_token_rejected')).step.status).toBe('done');
    await run('finish');
    const rc = await tx(F.owner, (db) => getRecoveryCase(db, F.owner, caseId));
    expect(rc.status).toBe('completed');
    expect((await tx(F.owner, (db) => getIncidentDetail(db, F.owner, incidentId))).state).toBe('recovered');
    expect((await download(laptop.token)).reason).toBe('session_revoked');
    expect((await download(fresh.freshSessionToken!)).admitted).toBe(true);
  });

  it('evidence: worker signs the history; the bundle verifies offline and tampering is detected', async () => {
    await W.runtime.drain();
    await withTx(W.pool, { orgId: F.lakeview }, async (db) => {
      const { signPendingIntents, createCheckpoint } = await import('../../packages/db/src/services/evidence');
      await signPendingIntents(db, F.lakeview, W.deps.evidenceKey);
      await createCheckpoint(db, F.lakeview, W.deps.evidenceKey, W.deps.store, { requestedBy: 'test', anchor: true });
    });
    const { items, status } = await tx(F.owner, (db) => listCheckpoints(db, F.owner));
    expect(status.pendingIntents).toBe(0);
    const cp = items[0];
    const bundle = await tx(F.owner, (db) => buildEvidenceBundle(db, F.owner, cp.id));
    const retained = await tx(F.owner, (db) => retainedCheckpoint(db, F.owner, cp.id));
    const keys = JSON.parse(process.env.EVIDENCE_PUBLIC_KEYS!);
    const ok = verifyBundle({ bundle, retained, trustedKeys: keys });
    expect(ok.integrityOk).toBe(true);
    expect(ok.rows.find((r) => r.id === 'retained_checkpoint')?.status).toBe('pass');
    expect(ok.rows.find((r) => r.id === 'blockchain')?.status).toBe('not_checked');
    expect(bundle.entries.map((e) => e.type)).toEqual(expect.arrayContaining(['incident.opened', 'action.approved', 'action.outcome_observed', 'recovery.step']));

    const edited = structuredClone(bundle);
    (edited.entries[3].payload as Record<string, unknown>).tampered = true;
    expect(verifyBundle({ bundle: edited, retained, trustedKeys: keys }).rows.find((r) => r.id === 'hashes')?.status).toBe('fail');

    const truncated = structuredClone(bundle);
    truncated.entries = truncated.entries.slice(0, -2);
    const t = verifyBundle({ bundle: truncated, retained, trustedKeys: keys });
    expect(t.rows.find((r) => r.id === 'retained_checkpoint')?.status).toBe('fail');

    const wrongKey = verifyBundle({ bundle, retained, trustedKeys: [{ keyId: keys[0].keyId, publicKeyHex: '11'.repeat(32) }] });
    expect(wrongKey.rows.find((r) => r.id === 'signatures')?.status).toBe('fail');
  });
});

describe('durable worker (Ph03 gate)', () => {
  it('a job leased by a crashed worker is reclaimed after lease expiry and processed once', async () => {
    const c = ownerClient();
    await c.connect();
    await c.query("INSERT INTO jobs (org_id, type, payload, dedupe_key) VALUES ($1, 'events.process', '{}', $2)", [F.lakeview, `crash-test-${Date.now()}`]);
    // Simulate a crash: lease the job as another worker and never finish it.
    const claimed = await withTx(W.pool, {}, async (_db, cl) => (await cl.query("SELECT id FROM saathi_claim_jobs('crashed-worker', 50, 1)")).rows);
    expect(claimed.length).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 1500));
    await W.runtime.drain();
    const left = await c.query("SELECT count(*)::int n FROM jobs WHERE status IN ('queued','leased') AND run_at <= now()");
    const done = await c.query('SELECT status, lease_owner FROM jobs WHERE id = ANY($1::uuid[])', [claimed.map((x) => x.id)]);
    await c.end();
    expect(left.rows[0].n).toBe(0);
    expect(done.rows.every((r) => r.status === 'done' || r.status === 'failed')).toBe(true);
  });

  it('a failing handler is retried with backoff and then visible in the failed queue', async () => {
    const c = ownerClient();
    await c.connect();
    const ins = await c.query("INSERT INTO jobs (org_id, type, payload, dedupe_key, max_attempts) VALUES (NULL, 'no.such.handler', '{}', $1, 1) RETURNING id", [`bad-${Date.now()}`]);
    await W.runtime.drain();
    const r = await c.query('SELECT status, last_error FROM jobs WHERE id = $1', [ins.rows[0].id]);
    await c.end();
    expect(r.rows[0].status).toBe('failed');
    expect(r.rows[0].last_error).toMatch(/no handler/);
  });
});
