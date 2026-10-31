import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { DEVICE_HEADERS, deviceSigningString, SaathiError } from '../../packages/contracts/src';
import { closePools, withTx } from '../../packages/db/src/client';
import { approvePreview, createPreview, getActionDetail } from '../../packages/db/src/services/decisions';
import { createEnrollmentCode, enrollDevice, ingestEvents, pollCommands, recordCommandResult, recordHeartbeat, verifyDeviceRequest } from '../../packages/db/src/services/devices';
import { buildBatch, submitBatch } from '../../packages/db/src/services/anchor';
import { createCheckpoint, signPendingIntents } from '../../packages/db/src/services/evidence';
import { createScamCheck, reportScamCheck } from '../../packages/db/src/services/scam';
import { createTelegramLinkCode, handleTelegramUpdate, telegramStatus } from '../../packages/db/src/services/telegram';
import { createWorker } from '../../apps/worker/src/index';
import { appPool, fixtures, idem, ownerClient, tx } from './helpers';

let F: Awaited<ReturnType<typeof fixtures>>;
let W: ReturnType<typeof createWorker>;
const ENC = process.env.DEVICE_SECRET_ENCRYPTION_KEY!;
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

beforeAll(async () => {
  F = await fixtures();
  W = createWorker({ ...process.env, NODE_ENV: 'test', DATABASE_URL: process.env.TEST_DATABASE_URL, DATABASE_URL_WORKER: process.env.TEST_DATABASE_URL_WORKER, OTS_BACKEND: 'disabled', WORKER_ID: 'proto-worker', OBJECT_STORAGE_LOCAL_DIR: '.local/test-objects' });
});
afterAll(async () => closePools());

function signed(deviceId: string, secret: string, method: string, path: string, body: unknown, opts: { nonce?: string; ts?: number; keyVersion?: string } = {}) {
  const bytes = new TextEncoder().encode(body === undefined ? '' : JSON.stringify(body));
  const timestamp = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const nonce = opts.nonce ?? randomBytes(16).toString('base64url');
  const signature = createHmac('sha256', secret).update(deviceSigningString(method, path, timestamp, nonce, sha(bytes))).digest('hex');
  return { headers: { deviceId, keyVersion: opts.keyVersion ?? '1', timestamp, nonce, signature }, bytes };
}

async function enrolSimulated() {
  const { code } = await tx(F.owner, (db) => createEnrollmentCode(db, F.owner, 'Protocol test PC'));
  const r = await enrollDevice(appPool, { code, hostname: 'SIM-PROTO', osVersion: 'test', agentVersion: '0.1.0', simulated: true }, { encryptionKey: ENC, commandKeys: [] });
  return { ...r, code };
}

describe('device enrollment and request authentication (Ph05 gate)', () => {
  it('a code enrols once; reuse is rejected', async () => {
    const d = await enrolSimulated();
    await expect(enrollDevice(appPool, { code: d.code, hostname: 'X', osVersion: 'x', agentVersion: '0', simulated: true }, { encryptionKey: ENC, commandKeys: [] })).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'UNAUTHENTICATED');
  });

  it('accepts a correctly signed request and rejects spoofed, replayed, stale and wrong-key requests', async () => {
    const d = await enrolSimulated();
    const path = '/api/v1/agent/heartbeat';
    const ok = signed(d.deviceId, d.deviceSecret, 'POST', path, { a: 1 });
    await expect(verifyDeviceRequest(appPool, ok.headers, 'POST', path, ok.bytes, ENC)).resolves.toMatchObject({ deviceId: d.deviceId, orgId: F.lakeview });
    // replay of the same nonce
    await expect(verifyDeviceRequest(appPool, ok.headers, 'POST', path, ok.bytes, ENC)).rejects.toThrow(/Replayed/);
    // body tampered after signing
    const t = signed(d.deviceId, d.deviceSecret, 'POST', path, { a: 1 });
    await expect(verifyDeviceRequest(appPool, t.headers, 'POST', path, new TextEncoder().encode('{"a":2}'), ENC)).rejects.toThrow(/signature/);
    // wrong secret (spoofed device)
    const s = signed(d.deviceId, 'not-the-secret', 'POST', path, {});
    await expect(verifyDeviceRequest(appPool, s.headers, 'POST', path, s.bytes, ENC)).rejects.toThrow(/signature/);
    // outside the clock window
    const old = signed(d.deviceId, d.deviceSecret, 'POST', path, {}, { ts: Math.floor(Date.now() / 1000) - 3600 });
    await expect(verifyDeviceRequest(appPool, old.headers, 'POST', path, old.bytes, ENC)).rejects.toThrow(/clock/);
    // stale key version
    const kv = signed(d.deviceId, d.deviceSecret, 'POST', path, {}, { keyVersion: '0' });
    await expect(verifyDeviceRequest(appPool, kv.headers, 'POST', path, kv.bytes, ENC)).rejects.toThrow(/key version/);
    void DEVICE_HEADERS;
  });

  it('duplicate event batches are acknowledged once and stored once', async () => {
    const d = await enrolSimulated();
    const auth = { deviceId: d.deviceId, orgId: d.orgId, simulated: true };
    const batch = { batchId: 'b1', droppedSinceLast: 0, spoolDepth: 0, events: [{ logEpoch: 'e1', channel: 'Security', nativeEventId: '4625-1', type: 'auth.failed' as const, observedAt: new Date().toISOString(), facts: { username: 'x' } }] };
    const a = await ingestEvents(appPool, auth, batch);
    const b = await ingestEvents(appPool, auth, batch);
    expect(a.duplicates).toBe(0);
    expect(b.duplicates).toBe(1);
    const c = ownerClient();
    await c.connect();
    const n = await c.query("SELECT count(*)::int n FROM raw_events WHERE device_id = $1 AND native_event_id = '4625-1'", [d.deviceId]);
    await c.end();
    expect(n.rows[0].n).toBe(1);
  });
});

describe('signed device commands (Ph09 gate, server side)', () => {
  it('signs, delivers only to the target device, accepts the result once and rejects a contradictory late result', async () => {
    const d = await enrolSimulated();
    const auth = { deviceId: d.deviceId, orgId: d.orgId, simulated: true };
    await recordHeartbeat(appPool, auth, { agentVersion: '0.1.0', capabilityVersion: 1, capabilities: [{ action: 'device.request_av_scan', supported: true, reason: null }], prerequisites: [], spoolDepth: 0, droppedEvents: 0, simulated: true });
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'device.request_av_scan', targetType: 'device', targetId: d.deviceId, params: { scanType: 'quick' } }, null));
    const { actionId } = await tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem()));
    expect((await tx(F.owner, (db) => getActionDetail(db, F.owner, actionId))).state).toBe('queued');
    await W.runtime.drain();
    const other = await enrolSimulated();
    expect(await pollCommands(appPool, { deviceId: other.deviceId, orgId: other.orgId, simulated: true })).toHaveLength(0);
    const cmds = await pollCommands(appPool, auth);
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ deviceId: d.deviceId, actionId, type: 'device.request_av_scan', keyId: process.env.COMMAND_SIGNING_KEY_ID });
    expect(cmds[0].signature).toMatch(/^[0-9a-f]{128}$/);
    expect((await tx(F.owner, (db) => getActionDetail(db, F.owner, actionId))).state).toBe('executing');
    const result = { commandId: cmds[0].id, outcome: 'confirmed' as const, rejectionReason: null, executedAt: new Date().toISOString(), probes: [{ kind: 'scan_status', expected: 'accepted', observed: 'accepted (simulated)', result: 'pass' as const, checkedAt: new Date().toISOString() }], boundaries: ['scan_not_eradication', 'simulated'], priorState: null, simulated: true };
    expect(await recordCommandResult(appPool, auth, cmds[0].id, result)).toEqual({ accepted: true, duplicate: false });
    expect(await recordCommandResult(appPool, auth, cmds[0].id, result)).toEqual({ accepted: true, duplicate: true });
    expect(await recordCommandResult(appPool, auth, cmds[0].id, { ...result, outcome: 'failed' })).toEqual({ accepted: false, duplicate: true });
    const detail = await tx(F.owner, (db) => getActionDetail(db, F.owner, actionId));
    expect(detail.state).toBe('confirmed');
    expect(detail.device?.simulated).toBe(true);
  });

  it('an agent claiming success without passing probes is recorded as unknown, not confirmed', async () => {
    const d = await enrolSimulated();
    const auth = { deviceId: d.deviceId, orgId: d.orgId, simulated: true };
    await recordHeartbeat(appPool, auth, { agentVersion: '0.1.0', capabilityVersion: 1, capabilities: [{ action: 'device.enable_firewall', supported: true, reason: null }], prerequisites: [], spoolDepth: 0, droppedEvents: 0, simulated: true });
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'device.enable_firewall', targetType: 'device', targetId: d.deviceId, params: { profile: 'All' } }, null));
    const { actionId } = await tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem()));
    await W.runtime.drain();
    const [cmd] = await pollCommands(appPool, auth);
    await recordCommandResult(appPool, auth, cmd.id, { commandId: cmd.id, outcome: 'confirmed', rejectionReason: null, executedAt: new Date().toISOString(), probes: [], boundaries: [], priorState: null, simulated: true });
    expect((await tx(F.owner, (db) => getActionDetail(db, F.owner, actionId))).state).toBe('unknown');
  });

  it('a stale device cannot receive an approval (DEVICE_OFFLINE), and no action is created', async () => {
    const d = await enrolSimulated();
    const auth = { deviceId: d.deviceId, orgId: d.orgId, simulated: true };
    await recordHeartbeat(appPool, auth, { agentVersion: '0.1.0', capabilityVersion: 1, capabilities: [{ action: 'device.request_av_scan', supported: true, reason: null }], prerequisites: [], spoolDepth: 0, droppedEvents: 0, simulated: true });
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'device.request_av_scan', targetType: 'device', targetId: d.deviceId, params: { scanType: 'quick' } }, null));
    const c = ownerClient();
    await c.connect();
    await c.query("UPDATE devices SET last_seen_at = now() - interval '1 hour' WHERE id = $1", [d.deviceId]);
    await expect(tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem()))).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'DEVICE_OFFLINE');
    const n = await c.query('SELECT count(*)::int n FROM actions WHERE preview_id = $1', [previewId]);
    await c.end();
    expect(n.rows[0].n).toBe(0);
  });
});

describe('evidence append-only and timestamp honesty (Ph15/16 gates)', () => {
  it('signed entries and checkpoints cannot be edited or deleted through ordinary statements', async () => {
    await withTx(W.pool, { orgId: F.lakeview }, (db) => signPendingIntents(db, F.lakeview, W.deps.evidenceKey));
    const blocked = async (sql: string) =>
      expect(withTx(W.pool, { orgId: F.lakeview }, async (_db, cl) => cl.query(sql, [F.lakeview]))).rejects.toThrow(/append-only|immutable|permission denied/);
    await blocked("UPDATE evidence_entries SET payload = '{}'::jsonb WHERE org_id = $1");
    await blocked('DELETE FROM evidence_entries WHERE org_id = $1');
    await blocked("UPDATE evidence_intents SET payload = '{}'::jsonb WHERE org_id = $1");
  });

  it('a calendar outage leaves the proof retrying (never confirmed) and does not block evidence', async () => {
    await withTx(W.pool, { orgId: F.lakeview }, (db) => signPendingIntents(db, F.lakeview, W.deps.evidenceKey));
    const cp = await withTx(W.pool, { orgId: F.lakeview }, (db) => createCheckpoint(db, F.lakeview, W.deps.evidenceKey, null, { requestedBy: 'test', anchor: true }));
    const batch = await buildBatch(W.pool, [F.lakeview]);
    expect(batch).not.toBeNull();
    await submitBatch(W.pool, batch!.batchId, { ...W.deps.anchor, backend: 'native', calendars: ['http://127.0.0.1:1'], fetch: async () => { throw new Error('calendar unreachable'); } });
    const c = ownerClient();
    await c.connect();
    const r = await c.query('SELECT status, last_error FROM anchor_proofs WHERE batch_id = $1', [batch!.batchId]);
    await c.end();
    expect(r.rows[0].status).toBe('retrying');
    expect(r.rows[0].last_error).toMatch(/unreachable/);
    expect(cp?.checkpoint.signature).toMatch(/^[0-9a-f]+$/);
  });
});

describe('Telegram linking and staff reporting (Ph12 gate)', () => {
  it('links once with a code, deduplicates updates, ignores group chats and display names', async () => {
    const { code } = await tx(F.staffActor, (db) => createTelegramLinkCode(db, F.staffActor, 'saathi_test_bot'));
    const upd = (id: number, text: string, type = 'private') => ({ update_id: id, message: { message_id: id, chat: { id: 777001, type }, text } });
    const base = 900000 + Math.floor(Math.random() * 1000);
    expect((await handleTelegramUpdate(appPool, upd(base, `/start ${code}`)))?.reply).toMatch(/^Linked/);
    expect(await handleTelegramUpdate(appPool, upd(base, `/start ${code}`))).toBeNull(); // duplicate update
    expect((await handleTelegramUpdate(appPool, upd(base + 1, `/start ${code}`)))?.reply).toMatch(/expired or was already used|not valid/);
    expect(await handleTelegramUpdate(appPool, upd(base + 2, 'hello', 'group'))).toBeNull();
    const rep = await handleTelegramUpdate(appPool, upd(base + 3, 'Is this real? pay invoice at http://invoice-update-portal.example'));
    expect(rep?.report).toMatchObject({ orgId: F.lakeview, userId: F.staffActor.userId });
    const unlinked = await handleTelegramUpdate(appPool, { update_id: base + 4, message: { message_id: 1, chat: { id: 777999, type: 'private' }, text: 'hi' } });
    expect(unlinked?.reply).toMatch(/not linked/);
  });

  it('refuses to link a chat already actively linked to a different account, without crashing', async () => {
    const upd = (id: number, chatId: number, text: string) => ({ update_id: id, message: { message_id: id, chat: { id: chatId, type: 'private' }, text } });
    const chatId = 778001 + Math.floor(Math.random() * 1000);
    const base = 910000 + Math.floor(Math.random() * 1000);
    const first = await tx(F.staffActor, (db) => createTelegramLinkCode(db, F.staffActor, 'saathi_test_bot'));
    expect((await handleTelegramUpdate(appPool, upd(base, chatId, `/start ${first.code}`)))?.reply).toMatch(/^Linked/);
    const second = await tx(F.northOwner, (db) => createTelegramLinkCode(db, F.northOwner, 'saathi_test_bot'));
    const r = await handleTelegramUpdate(appPool, upd(base + 1, chatId, `/start ${second.code}`));
    expect(r?.reply).toMatch(/already linked to a different Saathi account/);
  });

  it('reports linked status correctly even with an unused pending code sitting alongside the active link', async () => {
    const upd = (id: number, chatId: number, text: string) => ({ update_id: id, message: { message_id: id, chat: { id: chatId, type: 'private' }, text } });
    const chatId = 780001 + Math.floor(Math.random() * 1000);
    const base = 930000 + Math.floor(Math.random() * 1000);
    const linked = await tx(F.owner, (db) => createTelegramLinkCode(db, F.owner, 'saathi_test_bot'));
    expect((await handleTelegramUpdate(appPool, upd(base, chatId, `/start ${linked.code}`)))?.reply).toMatch(/^Linked/);
    // Generate another code without using it — this used to leave a second, unconsumed
    // unlinkedAt-null row that a single-row status lookup could pick instead of the active one.
    await tx(F.owner, (db) => createTelegramLinkCode(db, F.owner, 'saathi_test_bot'));
    const status = await tx(F.owner, (db) => telegramStatus(db, F.owner));
    expect(status.linked).toBe(true);
  });

  it('treats a second code from the SAME already-linked account as a no-op, not a conflict', async () => {
    const upd = (id: number, chatId: number, text: string) => ({ update_id: id, message: { message_id: id, chat: { id: chatId, type: 'private' }, text } });
    const chatId = 779001 + Math.floor(Math.random() * 1000);
    const base = 920000 + Math.floor(Math.random() * 1000);
    const first = await tx(F.approver, (db) => createTelegramLinkCode(db, F.approver, 'saathi_test_bot'));
    expect((await handleTelegramUpdate(appPool, upd(base, chatId, `/start ${first.code}`)))?.reply).toMatch(/^Linked/);
    // Clicking "Create link code" again (e.g. a stale page) makes a brand-new row for the
    // same org+user — this must not be mistaken for a different account.
    const again = await tx(F.approver, (db) => createTelegramLinkCode(db, F.approver, 'saathi_test_bot'));
    const r = await handleTelegramUpdate(appPool, upd(base + 1, chatId, `/start ${again.code}`));
    expect(r?.reply).toMatch(/already linked to your Saathi account/);
  });
});

describe('scam campaign grouping (Ph06 preset)', () => {
  it('three distinct reporters of a matching message within 24h form one campaign and incident', async () => {
    const text = `Dear team, updated bank details for vendor payment: pay into the new account today at https://vendor-pay-${randomBytes(3).toString('hex')}.top/form`;
    const cfg = { fingerprintSecret: process.env.SCAM_FINGERPRINT_SECRET!, aiConfigured: false, textRetentionHours: 24 };
    const users = [F.staffActor, F.approver, F.owner];
    let campaignId: string | null = null;
    for (const u of users) {
      const c = await tx(u, (db) => createScamCheck(db, u, { text, inputKind: 'text', externalProcessingConsent: false }, cfg));
      expect(c.verdict).toBe('suspicious');
      campaignId = (await tx(u, (db) => reportScamCheck(db, u, c.id))).campaignId;
    }
    expect(campaignId).toBeTruthy();
    const c = ownerClient();
    await c.connect();
    const r = await c.query('SELECT reporter_count, incident_id FROM campaign_reports WHERE id = $1', [campaignId]);
    await c.end();
    expect(r.rows[0].reporter_count).toBe(3);
    expect(r.rows[0].incident_id).toBeTruthy();
  });
});
