import { createHash, createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import type pg from 'pg';
import {
  DEVICE_CLOCK_SKEW_SECONDS,
  deviceSigningString,
  msg,
  SaathiError,
  type AgentEvent,
  type CommandEnvelope,
  type CommandResult,
  type DeviceCardDTO,
  type DeviceDetailDTO,
  type EnrollRequest,
  type EventBatch,
  type Heartbeat,
  type PostureCheck,
} from '@saathi/contracts';
import { computeHealth } from '@saathi/domain';
import { withTx, type Db } from '../client';
import {
  actions,
  agentCommands,
  deviceAccounts,
  deviceChanges,
  deviceKeys,
  deviceNonces,
  devicePosture,
  devices,
  enrollmentCodes,
  eventDispositions,
  incidentHistory,
  incidents,
  rawEvents,
  organizations,
} from '../schema';
import { decryptSecret, encryptSecret, enqueue, newToken, recordIntent, requireMembership, safeEqualHex, sha256, type Actor } from './core';
import { incidentCards, reassessIncident } from './incidents';
import { deviceFreshness, DEVICE_STALE_SECONDS } from './snapshot';

export const ENROLLMENT_CODE_TTL_MINUTES = 15;

// ------------------------------------------------------------------ enrollment

export async function createEnrollmentCode(db: Db, actor: Actor, deviceName: string) {
  await requireMembership(db, actor, 'devices.enroll');
  // Human-typable one-use code; only its hash is stored and it is shown once.
  const code = randomBytes(9).toString('base64url').toUpperCase().replace(/[^A-Z0-9]/g, 'X').slice(0, 12);
  const formatted = `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`;
  const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MINUTES * 60 * 1000);
  await db.insert(enrollmentCodes).values({ orgId: actor.orgId, codeHash: sha256(formatted), deviceName: deviceName.slice(0, 80), expiresAt, createdBy: actor.userId });
  await recordIntent(db, actor.orgId, 'device.enrollment_code_created', { deviceName: deviceName.slice(0, 80), expiresAt: expiresAt.toISOString(), by: actor.userId });
  return { code: formatted, expiresAt: expiresAt.toISOString() };
}

/** Atomically consume a one-use code and bind a new device identity to its organization. */
export async function enrollDevice(pool: pg.Pool, req: EnrollRequest, cfg: { encryptionKey: string; commandKeys: { keyId: string; publicKeyHex: string }[] }) {
  const codeHash = sha256(req.code.trim().toUpperCase());
  const lookup = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, code_id FROM saathi_enrollment_lookup($1)', [codeHash])).rows[0]);
  if (!lookup) throw new SaathiError('UNAUTHENTICATED', 'Enrollment code is not valid.');
  return withTx(pool, { orgId: lookup.org_id }, async (db) => {
    const [code] = await db.select().from(enrollmentCodes).where(eq(enrollmentCodes.id, lookup.code_id)).for('update');
    if (!code || code.consumedAt) throw new SaathiError('UNAUTHENTICATED', 'Enrollment code was already used.');
    if (code.expiresAt.getTime() < Date.now()) throw new SaathiError('UNAUTHENTICATED', 'Enrollment code has expired.');
    const secret = newToken(32);
    const [device] = await db
      .insert(devices)
      .values({ orgId: code.orgId, name: code.deviceName, status: 'connected', hostname: req.hostname, osVersion: req.osVersion, agentVersion: req.agentVersion, simulated: req.simulated, lastSeenAt: new Date() })
      .returning({ id: devices.id });
    await db.insert(deviceKeys).values({ orgId: code.orgId, deviceId: device.id, keyVersion: 1, secretCiphertext: encryptSecret(secret, cfg.encryptionKey) });
    await db.update(enrollmentCodes).set({ consumedAt: new Date(), deviceId: device.id }).where(eq(enrollmentCodes.id, code.id));
    await recordIntent(db, code.orgId, 'device.enrolled', { deviceId: device.id, hostname: req.hostname, simulated: req.simulated });
    return { deviceId: device.id, orgId: code.orgId, deviceSecret: secret, keyVersion: 1, commandKeys: cfg.commandKeys, pollIntervalSeconds: 2 };
  });
}

// ------------------------------------------------------------------ web attack-simulation preview
//
// A browser-only preview of what Saathi shows when it detects something, reachable from the
// enrollment code without any Saathi account (decision: the recipient "logs in" with the
// one-use code itself, not a password). It only ever injects clearly synthetic events — the
// same thing `pnpm dev:agent --simulate --code <code>` already does from a terminal — through
// the device's always-`simulated: true` flag; it can never create a real device, run a real
// action, or affect anything but the one preview device bound to this code.

export const PREVIEW_SCENARIOS = ['malware_detected', 'protection_disabled', 'password_guessing'] as const;
export type PreviewScenario = (typeof PREVIEW_SCENARIOS)[number];

function previewScenarioEvents(scenario: PreviewScenario, now: Date) {
  const epoch = `preview-${now.getTime()}`;
  const rid = () => randomBytes(6).toString('hex');
  switch (scenario) {
    case 'malware_detected':
      // Backdated past the real unresolved-malware grace period (packages/domain PRESETS,
      // currently 120s) so the next scheduled check — not a wait — surfaces the incident.
      return [
        {
          logEpoch: epoch,
          channel: 'Microsoft-Windows-Windows Defender/Operational',
          nativeEventId: rid(),
          type: 'malware.detected' as const,
          observedAt: new Date(now.getTime() - 135_000).toISOString(),
          facts: { threatId: 'PREVIEW-0001', threatName: 'Preview.Trojan.Illustrative (not a real detection)', severity: 'Severe' },
        },
      ];
    case 'protection_disabled':
      return [{ logEpoch: epoch, channel: 'Microsoft-Windows-Windows Defender/Operational', nativeEventId: rid(), type: 'protection.disabled' as const, observedAt: now.toISOString(), facts: { component: 'av' } }];
    case 'password_guessing': {
      // Five failed attempts then one success for the same username, matching the
      // possible_compromise correlation rule (packages/domain PRESETS.passwordGuessing).
      const events: AgentEvent[] = Array.from({ length: 5 }, (_, i) => ({
        logEpoch: epoch,
        channel: 'Security',
        nativeEventId: rid(),
        type: 'auth.failed' as const,
        observedAt: new Date(now.getTime() - (5 - i) * 4_000).toISOString(),
        facts: { username: 'preview.user', sourceAddress: '203.0.113.7' },
      }));
      events.push({ logEpoch: epoch, channel: 'Security', nativeEventId: rid(), type: 'auth.succeeded' as const, observedAt: now.toISOString(), facts: { username: 'preview.user', logonType: 3 } });
      return events;
    }
  }
}

/**
 * Resolve the one preview device bound to this enrollment code, creating it (simulated: true)
 * on first use. The code is still consumed exactly once for real enrollment — if someone has
 * already enrolled a real agent with it, this refuses rather than silently reusing that device.
 */
async function resolvePreviewDevice(pool: pg.Pool, rawCode: string) {
  const codeHash = sha256(rawCode.trim().toUpperCase());
  const lookup = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, code_id FROM saathi_enrollment_lookup($1)', [codeHash])).rows[0]);
  if (!lookup) throw new SaathiError('UNAUTHENTICATED', 'This preview link is not valid.');
  return withTx(pool, { orgId: lookup.org_id }, async (db) => {
    const [code] = await db.select().from(enrollmentCodes).where(eq(enrollmentCodes.id, lookup.code_id)).for('update');
    if (!code) throw new SaathiError('UNAUTHENTICATED', 'This preview link is not valid.');
    if (code.consumedAt) {
      if (!code.deviceId) throw new SaathiError('UNAUTHENTICATED', 'This preview link was already used.');
      const [existing] = await db.select({ id: devices.id, orgId: devices.orgId, simulated: devices.simulated }).from(devices).where(eq(devices.id, code.deviceId));
      if (!existing?.simulated) throw new SaathiError('UNAUTHENTICATED', 'This code was already used to enroll a real device, not a preview.');
      return { deviceId: existing.id, orgId: existing.orgId };
    }
    if (code.expiresAt.getTime() < Date.now()) throw new SaathiError('UNAUTHENTICATED', 'This preview link has expired.');
    const [device] = await db
      .insert(devices)
      .values({ orgId: code.orgId, name: code.deviceName, status: 'connected', hostname: 'Web preview (no real device)', osVersion: 'preview', agentVersion: 'preview', simulated: true, lastSeenAt: new Date() })
      .returning({ id: devices.id });
    await db.update(enrollmentCodes).set({ consumedAt: new Date(), deviceId: device.id }).where(eq(enrollmentCodes.id, code.id));
    await recordIntent(db, code.orgId, 'device.enrolled', { deviceId: device.id, hostname: 'web preview', simulated: true });
    return { deviceId: device.id, orgId: code.orgId };
  });
}

/** Inject one labelled-synthetic scenario for the preview device bound to this code. */
export async function runAttackPreview(pool: pg.Pool, rawCode: string, scenario: PreviewScenario) {
  const dev = await resolvePreviewDevice(pool, rawCode);
  const now = new Date();
  const events = previewScenarioEvents(scenario, now);
  await ingestEvents(pool, { deviceId: dev.deviceId, orgId: dev.orgId, simulated: true }, { batchId: `preview-${now.getTime()}`, events, droppedSinceLast: 0, spoolDepth: 0 });
  return { deviceId: dev.deviceId };
}

// ------------------------------------------------------------------ device request auth

export type DeviceAuth = { deviceId: string; orgId: string; simulated: boolean };

/**
 * Verify an HMAC-signed device request (build.md Ph05.3): time window, key version,
 * signature over method/path/timestamp/nonce/body hash, nonce uniqueness, device status.
 */
export async function verifyDeviceRequest(
  pool: pg.Pool,
  h: { deviceId: string | null; keyVersion: string | null; timestamp: string | null; nonce: string | null; signature: string | null },
  method: string,
  path: string,
  body: Uint8Array,
  encryptionKey: string,
): Promise<DeviceAuth> {
  if (!h.deviceId || !h.timestamp || !h.nonce || !h.signature || !h.keyVersion) throw new SaathiError('UNAUTHENTICATED', 'Missing device authentication.');
  if (!/^[0-9a-f-]{36}$/.test(h.deviceId) || !/^[A-Za-z0-9_-]{16,64}$/.test(h.nonce) || !/^[0-9a-f]{64}$/.test(h.signature)) throw new SaathiError('UNAUTHENTICATED', 'Malformed device authentication.');
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > DEVICE_CLOCK_SKEW_SECONDS) throw new SaathiError('UNAUTHENTICATED', 'Device clock outside the allowed window.');
  const row = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, status, simulated, key_version, secret_ciphertext FROM saathi_device_auth($1)', [h.deviceId])).rows[0]);
  if (!row) throw new SaathiError('UNAUTHENTICATED', 'Unknown device.');
  if (String(row.key_version) !== h.keyVersion) throw new SaathiError('UNAUTHENTICATED', 'Device key version is not current.');
  if (row.status !== 'connected') throw new SaathiError('FORBIDDEN', 'This device is retired or revoked.');
  const secret = decryptSecret(row.secret_ciphertext, encryptionKey);
  const expected = createHmac('sha256', secret).update(deviceSigningString(method, path, h.timestamp, h.nonce, sha256Bytes(body))).digest('hex');
  if (!safeEqualHex(expected, h.signature)) throw new SaathiError('UNAUTHENTICATED', 'Device signature does not verify.');
  await withTx(pool, { orgId: row.org_id }, async (db) => {
    const inserted = await db.insert(deviceNonces).values({ deviceId: h.deviceId!, nonce: h.nonce!, orgId: row.org_id }).onConflictDoNothing().returning({ n: deviceNonces.nonce });
    if (inserted.length === 0) throw new SaathiError('UNAUTHENTICATED', 'Replayed device request.');
  });
  return { deviceId: h.deviceId, orgId: row.org_id, simulated: row.simulated };
}

function sha256Bytes(b: Uint8Array) {
  return createHash('sha256').update(b).digest('hex');
}

// ------------------------------------------------------------------ ingestion

export async function ingestEvents(pool: pg.Pool, dev: DeviceAuth, batch: EventBatch) {
  return withTx(pool, { orgId: dev.orgId }, async (db) => {
    const accepted: { channel: string; logEpoch: string; nativeEventId: string }[] = [];
    let duplicates = 0;
    const now = new Date();
    for (const e of batch.events) {
      const dedupeKey = `dev:${dev.deviceId}:${e.logEpoch}:${e.channel}:${e.nativeEventId}`;
      const ins = await db
        .insert(rawEvents)
        .values({ orgId: dev.orgId, sourceType: 'device', deviceId: dev.deviceId, logEpoch: e.logEpoch, channel: e.channel, nativeEventId: e.nativeEventId, dedupeKey, type: e.type, observedAt: new Date(e.observedAt), receivedAt: now, facts: e.facts })
        .onConflictDoNothing()
        .returning({ id: rawEvents.id });
      if (ins.length === 0) duplicates++;
      // Acknowledge duplicates too: repeated transport delivery is safe.
      accepted.push({ channel: e.channel, logEpoch: e.logEpoch, nativeEventId: e.nativeEventId });
    }
    await db.update(devices).set({ lastSeenAt: now, lastEventAt: batch.events.length ? now : undefined, spoolDepth: batch.spoolDepth, droppedEvents: sql`${devices.droppedEvents} + ${batch.droppedSinceLast}` }).where(eq(devices.id, dev.deviceId));
    if (batch.events.length - duplicates > 0) await enqueue(db, { orgId: dev.orgId, type: 'events.process', payload: {}, dedupeKey: `events.process:${dev.orgId}:${batch.batchId}:${dev.deviceId}` });
    if (batch.droppedSinceLast > 0) await recordIntent(db, dev.orgId, 'device.events_dropped', { deviceId: dev.deviceId, dropped: batch.droppedSinceLast });
    return { accepted, duplicates, rejected: [] as { index: number; reason: string }[] };
  });
}

const POSTURE_COMPONENT: Record<string, string> = { av: 'av', firewall: 'firewall' };

export async function recordHeartbeat(pool: pg.Pool, dev: DeviceAuth, hb: Heartbeat) {
  return withTx(pool, { orgId: dev.orgId }, async (db) => {
    const now = new Date();
    await db
      .update(devices)
      .set({
        lastSeenAt: now,
        agentVersion: hb.agentVersion,
        capabilities: hb.capabilities,
        prerequisites: hb.prerequisites,
        capabilityVersion: hb.capabilityVersion,
        interactiveSession: hb.interactiveSession ?? null,
        spoolDepth: hb.spoolDepth,
        droppedEvents: hb.droppedEvents,
      })
      .where(eq(devices.id, dev.deviceId));
    if (hb.accounts) {
      for (const a of hb.accounts) {
        await db
          .insert(deviceAccounts)
          .values({ orgId: dev.orgId, deviceId: dev.deviceId, sid: a.sid, username: a.username, isAdmin: a.isAdmin, enabled: a.enabled, observedAt: now })
          .onConflictDoUpdate({ target: [deviceAccounts.deviceId, deviceAccounts.sid], set: { username: a.username, isAdmin: a.isAdmin, enabled: a.enabled, observedAt: now } });
      }
    }
    if (hb.posture && Object.keys(hb.posture).length) {
      const [prev] = await db.select().from(devicePosture).where(eq(devicePosture.deviceId, dev.deviceId)).orderBy(desc(devicePosture.revision)).limit(1);
      const checks = hb.posture as Record<string, PostureCheck>;
      // Per-key comparison: jsonb does not preserve key order, so string comparison is unreliable.
      const keys = new Set([...Object.keys(prev?.checks ?? {}), ...Object.keys(checks)]);
      const changed = !prev || [...keys].some((k) => prev.checks[k]?.result !== checks[k]?.result || (prev.checks[k]?.value ?? null) !== (checks[k]?.value ?? null));
      if (changed) {
        const revision = (prev?.revision ?? 0) + 1;
        await db.insert(devicePosture).values({ orgId: dev.orgId, deviceId: dev.deviceId, revision, checks, observedAt: now });
        // A newly failing protection component becomes an observation (protection.disabled).
        for (const [key, component] of Object.entries(POSTURE_COMPONENT)) {
          const was = prev?.checks?.[key]?.result;
          const nowR = checks[key]?.result;
          if (nowR === 'fail' && was !== 'fail') {
            const ins = await db
              .insert(rawEvents)
              .values({ orgId: dev.orgId, sourceType: 'device', deviceId: dev.deviceId, dedupeKey: `posture:${dev.deviceId}:${revision}:${key}`, type: 'protection.disabled', observedAt: now, facts: { component, value: checks[key].value, source: checks[key].source } })
              .onConflictDoNothing()
              .returning({ id: rawEvents.id });
            if (ins.length) await enqueue(db, { orgId: dev.orgId, type: 'events.process', payload: {}, dedupeKey: `events.process:${dev.orgId}:${ins[0].id}` });
          }
        }
      }
    }
    return { serverTime: now.toISOString() };
  });
}

// ------------------------------------------------------------------ commands

/** Non-expired signed commands for this device only (build.md Ph09). */
export async function pollCommands(pool: pg.Pool, dev: DeviceAuth): Promise<CommandEnvelope[]> {
  return withTx(pool, { orgId: dev.orgId }, async (db) => {
    const now = new Date();
    const rows = await db
      .select()
      .from(agentCommands)
      .where(and(eq(agentCommands.deviceId, dev.deviceId), inArray(agentCommands.status, ['signed', 'delivered']), gt(agentCommands.expiresAt, now)))
      .for('update');
    for (const c of rows) {
      await db.update(agentCommands).set({ status: 'delivered', deliveredAt: c.deliveredAt ?? now, deliveryCount: sql`${agentCommands.deliveryCount} + 1` }).where(eq(agentCommands.id, c.id));
      if (c.status === 'signed') {
        await db.update(actions).set({ state: 'executing', updatedAt: now }).where(and(eq(actions.id, c.actionId), eq(actions.state, 'queued')));
        await recordIntent(db, dev.orgId, 'command.delivered', { commandId: c.id, actionId: c.actionId, deviceId: dev.deviceId });
      }
    }
    return rows.map((r) => r.envelope as CommandEnvelope);
  });
}

const COVERS: Record<string, string | null> = {
  'device.block_source_ip': 'device.local_login',
  'device.set_lockout_policy': 'device.local_login',
  'device.disable_local_account': 'device.local_login',
  'device.restrict_removable_storage': 'device.removable_storage',
  'device.enable_firewall': 'device.firewall',
  'device.enable_av': 'device.av',
  'device.request_av_scan': null,
  'device.lock_session': null,
  'device.undo_change': null,
};

/**
 * Idempotent command result (build.md Ph09). A repeated identical result is accepted once;
 * a contradictory late result is rejected and recorded for review.
 */
export async function recordCommandResult(pool: pg.Pool, dev: DeviceAuth, commandId: string, result: CommandResult) {
  return withTx(pool, { orgId: dev.orgId }, async (db) => {
    const [c] = await db.select().from(agentCommands).where(and(eq(agentCommands.id, commandId), eq(agentCommands.deviceId, dev.deviceId))).for('update');
    if (!c) throw new SaathiError('NOT_FOUND', 'Command not found for this device.');
    if (c.result) {
      const same = (c.result as CommandResult).outcome === result.outcome;
      if (!same) await recordIntent(db, dev.orgId, 'command.contradictory_result', { commandId, first: (c.result as CommandResult).outcome, late: result.outcome });
      return { accepted: same, duplicate: true };
    }
    const now = new Date();
    const [a] = await db.select().from(actions).where(eq(actions.id, c.actionId)).for('update');
    await db.update(agentCommands).set({ result, resultReceivedAt: now, status: result.outcome === 'rejected' ? 'rejected' : 'completed' }).where(eq(agentCommands.id, c.id));
    const state = result.outcome === 'rejected' ? 'failed' : result.outcome;
    // Probes decide the outcome; the agent's own classification must agree with them.
    const probesPass = result.probes.length > 0 && result.probes.every((p) => p.result === 'pass');
    const finalState = state === 'confirmed' && !probesPass ? 'unknown' : state;
    const covered = COVERS[a.actionType];
    const mountedBoundary = a.actionType === 'device.restrict_removable_storage' && result.probes.some((p) => p.kind === 'mounted_removable_volumes' && p.result !== 'pass');
    const coversTargets = finalState === 'confirmed' && covered && !mountedBoundary ? [{ type: 'device' as const, id: dev.deviceId, capability: covered }] : [];
    await db
      .update(actions)
      .set({
        state: finalState,
        updatedAt: now,
        completedAt: finalState === 'unknown' ? null : now,
        result: { coversTargets, outcomeKey: result.rejectionReason ? `action.outcome.rejected.${result.rejectionReason}` : undefined, boundaries: result.boundaries, simulated: result.simulated },
        boundaries: [...((a.boundaries as unknown[]) ?? []), ...result.boundaries.map((b) => msg(`boundary.agent.${b}`))],
      })
      .where(eq(actions.id, a.id));
    for (const p of result.probes) {
      await db.execute(sql`INSERT INTO action_probes (org_id, action_id, kind, label, expected, observed, result, checked_at, source)
        VALUES (${dev.orgId}, ${a.id}, ${p.kind}, ${JSON.stringify(msg(`probe.device.${p.kind}`))}::jsonb, ${p.expected}, ${p.observed}, ${p.result}, ${new Date(p.checkedAt)}, ${result.simulated ? 'simulated_agent_adapter' : 'device_agent_probe'})`);
    }
    if (finalState === 'confirmed' && result.priorState && a.actionType !== 'device.undo_change' && a.actionType !== 'device.request_av_scan' && a.actionType !== 'device.lock_session') {
      await db.insert(deviceChanges).values({ orgId: dev.orgId, deviceId: dev.deviceId, actionId: a.id, actionType: a.actionType, priorState: result.priorState, appliedState: a.params });
    }
    if (finalState === 'confirmed' && a.actionType === 'device.undo_change') {
      await db.update(deviceChanges).set({ status: 'undone', undoneByActionId: a.id }).where(and(eq(deviceChanges.orgId, dev.orgId), eq(deviceChanges.actionId, String((a.params as { changeId?: string }).changeId))));
    }
    if (a.incidentId) {
      await db.insert(incidentHistory).values({ orgId: dev.orgId, incidentId: a.incidentId, kind: 'action_outcome', text: msg('history.action_outcome', { action: a.actionType, state: finalState }), actionId: a.id, at: now });
      await reassessIncident(db, dev.orgId, a.incidentId, { at: now });
    }
    await recordIntent(db, dev.orgId, 'action.outcome_observed', { actionId: a.id, commandId, state: finalState, agentOutcome: result.outcome, rejectionReason: result.rejectionReason, probes: result.probes.length, simulated: result.simulated }, { incidentId: a.incidentId });
    return { accepted: true, duplicate: false };
  });
}

// ------------------------------------------------------------------ read models

export async function listDevices(db: Db, actor: Actor): Promise<DeviceCardDTO[]> {
  await requireMembership(db, actor, 'devices.read');
  const rows = await db.select().from(devices).where(eq(devices.orgId, actor.orgId)).orderBy(devices.name);
  const postures = await latestPostures(db, actor.orgId);
  const now = new Date();
  return rows.map((d) => {
    const f = deviceFreshness(d.lastSeenAt, now);
    const p = postures.get(d.id);
    const health = d.status === 'connected' ? computeHealth([{ deviceId: d.id, name: d.name, status: d.status, stale: f !== 'fresh', simulated: d.simulated, supportedActions: d.capabilities.filter((c) => c.supported).map((c) => c.action), checks: (p?.checks ?? null) as never }], now.toISOString()).earned : null;
    return {
      id: d.id,
      name: d.name,
      hostname: d.hostname,
      status: d.status,
      freshness: d.status === 'waiting' ? 'never' : f,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      simulated: d.simulated,
      supportedActionCount: d.capabilities.filter((c) => c.supported).length,
      incompleteChecks: d.prerequisites.filter((x) => !x.met).length,
      healthEarned: health,
    };
  });
}

async function latestPostures(db: Db, orgId: string) {
  const rows = await db.execute<{ device_id: string; checks: Record<string, { result: string; value: string | null; source: string; observedAt: string }>; observed_at: Date }>(
    sql`SELECT DISTINCT ON (device_id) device_id, checks, observed_at FROM device_posture WHERE org_id = ${orgId} ORDER BY device_id, revision DESC`,
  );
  return new Map(rows.rows.map((r) => [r.device_id, { checks: r.checks, observedAt: r.observed_at }]));
}

export async function getDeviceDetail(db: Db, actor: Actor, deviceId: string): Promise<DeviceDetailDTO> {
  await requireMembership(db, actor, 'devices.read');
  const [d] = await db.select().from(devices).where(and(eq(devices.orgId, actor.orgId), eq(devices.id, deviceId)));
  if (!d) throw new SaathiError('NOT_FOUND', 'Device not found.');
  const [card] = (await listDevices(db, actor)).filter((x) => x.id === d.id);
  const now = new Date();
  const stale = deviceFreshness(d.lastSeenAt, now) !== 'fresh';
  const p = (await latestPostures(db, actor.orgId)).get(d.id);
  const accounts = await db.select().from(deviceAccounts).where(eq(deviceAccounts.deviceId, d.id));
  const enabledAdmins = accounts.filter((a) => a.isAdmin && a.enabled).length;
  const obs = await db
    .select({ type: rawEvents.type, observedAt: rawEvents.observedAt, receivedAt: rawEvents.receivedAt, disposition: eventDispositions.disposition })
    .from(rawEvents)
    .leftJoin(eventDispositions, eq(eventDispositions.rawEventId, rawEvents.id))
    .where(and(eq(rawEvents.orgId, actor.orgId), eq(rawEvents.deviceId, d.id)))
    .orderBy(desc(rawEvents.observedAt))
    .limit(25);
  const acts = await db.select().from(actions).where(and(eq(actions.orgId, actor.orgId), eq(actions.deviceId, d.id))).orderBy(desc(actions.createdAt)).limit(20);
  const incRows = await db.select().from(incidents).where(and(eq(incidents.orgId, actor.orgId), eq(incidents.subjectDeviceId, d.id))).orderBy(desc(incidents.updatedAt)).limit(10);
  const keys = ['av', 'firewall', 'updates', 'lockout', 'admin_exposure', 'remote_access'];
  return {
    ...card,
    osVersion: d.osVersion,
    agentVersion: d.agentVersion,
    capabilities: d.capabilities,
    prerequisites: d.prerequisites,
    posture: keys.map((k) => {
      const c = p?.checks?.[k];
      return { key: k, result: (c && !stale ? c.result : 'unknown') as 'pass' | 'fail' | 'unknown', value: c?.value ?? null, source: c?.source ?? 'not reported', observedAt: c?.observedAt ?? null, stale };
    }),
    accounts: accounts.map((a) => ({ sid: a.sid, username: a.username, isAdmin: a.isAdmin, enabled: a.enabled, protected: a.isAgentIdentity || a.isRecoveryIdentity || (a.isAdmin && a.enabled && enabledAdmins <= 1), staffLabel: null })),
    recentObservations: obs.map((o) => ({ type: o.type, observedAt: o.observedAt.toISOString(), receivedAt: o.receivedAt.toISOString(), disposition: o.disposition })),
    actions: acts.map((a) => ({ id: a.id, actionType: a.actionType as DeviceDetailDTO['actions'][number]['actionType'], title: msg(`action.title.${a.actionType.replace('.', '_')}`), state: a.state as DeviceDetailDTO['actions'][number]['state'], createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() })),
    incidents: await incidentCards(db, actor.orgId, incRows),
    spoolDepth: d.spoolDepth,
    droppedEvents: d.droppedEvents,
    interactiveSession: (d.interactiveSession as DeviceDetailDTO['interactiveSession']) ?? null,
    changes: (await db.select().from(deviceChanges).where(and(eq(deviceChanges.orgId, actor.orgId), eq(deviceChanges.deviceId, d.id))).orderBy(desc(deviceChanges.createdAt)).limit(20)).map((c) => ({ id: c.id, actionType: c.actionType as DeviceDetailDTO['changes'][number]['actionType'], status: c.status, createdAt: c.createdAt.toISOString(), actionId: c.actionId })),
  };
}

export async function retireDevice(db: Db, actor: Actor, deviceId: string) {
  await requireMembership(db, actor, 'devices.retire');
  const [d] = await db.select().from(devices).where(and(eq(devices.orgId, actor.orgId), eq(devices.id, deviceId))).for('update');
  if (!d) throw new SaathiError('NOT_FOUND', 'Device not found.');
  await db.update(devices).set({ status: 'retired', retiredAt: new Date() }).where(eq(devices.id, d.id));
  await db.update(deviceKeys).set({ status: 'retired', retiredAt: new Date() }).where(eq(deviceKeys.deviceId, d.id));
  // Stop new command delivery. A previously delivered valid command may still run before expiry.
  await db.update(agentCommands).set({ status: 'expired' }).where(and(eq(agentCommands.deviceId, d.id), eq(agentCommands.status, 'signed')));
  await recordIntent(db, actor.orgId, 'device.retired', { deviceId: d.id, by: actor.userId });
}

/** Rotate a device's HMAC secret; the agent receives the new secret over its authenticated channel. */
export async function rotateDeviceSecret(db: Db, orgId: string, deviceId: string, encryptionKey: string) {
  const [k] = await db.select().from(deviceKeys).where(and(eq(deviceKeys.deviceId, deviceId), eq(deviceKeys.status, 'active'))).for('update');
  if (!k) throw new SaathiError('NOT_FOUND', 'No active device key.');
  const secret = newToken(32);
  await db.update(deviceKeys).set({ status: 'retired', retiredAt: new Date() }).where(eq(deviceKeys.id, k.id));
  await db.insert(deviceKeys).values({ orgId, deviceId, keyVersion: k.keyVersion + 1, secretCiphertext: encryptSecret(secret, encryptionKey) });
  await recordIntent(db, orgId, 'device.secret_rotated', { deviceId, keyVersion: k.keyVersion + 1 });
  return { deviceSecret: secret, keyVersion: k.keyVersion + 1 };
}

/** Stale-agent assessment (worker scheduler). */
export async function staleDevices(db: Db, orgId: string) {
  return db
    .select({ id: devices.id, name: devices.name, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .where(and(eq(devices.orgId, orgId), eq(devices.status, 'connected'), lt(devices.lastSeenAt, new Date(Date.now() - DEVICE_STALE_SECONDS * 1000))));
}

export const _unused = { isNull, organizations };
