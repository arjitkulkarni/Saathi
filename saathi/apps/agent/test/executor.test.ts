import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UnsignedCommand } from '@saathi/contracts';
import { generateSeed, keyPairFromSeed, signHash } from '@saathi/evidence';
import { SimulatedAdapters } from '../src/adapters/simulated';
import { Executor } from '../src/executor';
import { Ledger } from '../src/ledger';
import { StateStore } from '../src/state';
import { commandSigningHash } from '../src/verify';

const ORG = randomUUID();
const DEVICE = randomUUID();
const key = keyPairFromSeed(generateSeed());
const other = keyPairFromSeed(generateSeed());
const KEYS = [{ keyId: 'cmd-test-1', publicKeyHex: key.publicKeyHex }];

function cmd(over: Partial<UnsignedCommand> = {}, signWith = key.secretKey): Record<string, unknown> {
  const now = Date.now();
  const u: UnsignedCommand = {
    schemaVersion: 1,
    id: randomUUID(),
    orgId: ORG,
    deviceId: DEVICE,
    actionId: randomUUID(),
    type: 'device.enable_firewall',
    params: { profile: 'All' },
    expectedStateHash: 'x'.repeat(64),
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60_000).toISOString(),
    nonce: randomUUID().replace(/-/g, ''),
    keyId: 'cmd-test-1',
    ...over,
  };
  return { ...u, signature: signHash(commandSigningHash(u), signWith) };
}

function setup(recoverySids: string[] = []) {
  const store = new StateStore(mkdtempSync(join(tmpdir(), 'saathi-agent-')));
  const ledger = new Ledger(store);
  const adapters = new SimulatedAdapters();
  const ex = new Executor({ deviceId: DEVICE, orgId: ORG, keys: KEYS, recoverySids }, ledger, adapters);
  return { store, ledger, adapters, ex };
}

describe('command verification rejects and records', () => {
  it('accepts a valid signed command and confirms from probes', async () => {
    const { ex, adapters } = setup();
    const r = await ex.handle(cmd());
    expect(r?.outcome).toBe('confirmed');
    expect(r?.simulated).toBe(true);
    expect(r?.boundaries).toContain('simulated');
    expect(r?.probes.some((p) => p.kind === 'firewall_profile_enabled' && p.result === 'pass')).toBe(true);
    expect(adapters.state.firewall.Public).toBe(true);
  });

  it.each([
    ['tampered params', () => ({ ...cmd(), params: { profile: 'Public' } }), 'bad_signature'],
    ['tampered expiry', () => ({ ...cmd(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }), 'bad_signature'],
    ['signed by an unpinned key', () => cmd({}, other.secretKey), 'bad_signature'],
    ['unknown key id', () => cmd({ keyId: 'cmd-unknown' }), 'unknown_key'],
    ['expired', () => cmd({ issuedAt: new Date(Date.now() - 120_000).toISOString(), expiresAt: new Date(Date.now() - 60_000).toISOString() }), 'expired'],
    ['wrong device', () => cmd({ deviceId: randomUUID() }), 'wrong_device'],
    ['wrong organization', () => cmd({ orgId: randomUUID() }), 'wrong_org'],
    ['parameters outside bounds', () => cmd({ type: 'device.set_lockout_policy', params: { threshold: 1, durationMinutes: 5 } }), 'invalid_params'],
    ['unsupported type', () => ({ ...cmd(), type: 'device.run_script' }), 'unsupported'],
  ])('%s', async (_name, make, reason) => {
    const { ex, adapters } = setup();
    const before = adapters.executions;
    const r = await ex.handle(make());
    expect(r?.outcome).toBe('rejected');
    expect(r?.rejectionReason).toBe(reason);
    expect(adapters.executions).toBe(before);
  });

  it('rejects a replayed nonce under a different command id', async () => {
    const { ex, adapters } = setup();
    const nonce = 'replayednonce0000000001';
    expect((await ex.handle(cmd({ nonce })))?.outcome).toBe('confirmed');
    const r = await ex.handle(cmd({ nonce }));
    expect(r?.rejectionReason).toBe('replayed');
    expect(adapters.executions).toBe(1);
  });
});

describe('durable execution', () => {
  it('persists the receipt before executing and never reruns a redelivered command', async () => {
    const { ex, adapters, store } = setup();
    const c = cmd({ type: 'device.set_lockout_policy', params: { threshold: 5, durationMinutes: 15 } });
    const orig = adapters.execute.bind(adapters);
    let receiptSeenDuringExecution = false;
    adapters.execute = async (cc, ctx) => {
      const ledgerFile = JSON.parse(readFileSync(store.path('ledger.json'), 'utf8'));
      receiptSeenDuringExecution = ledgerFile.receipts[cc.id]?.status === 'applying';
      return orig(cc, ctx);
    };
    const first = await ex.handle(c);
    const second = await ex.handle(c);
    expect(receiptSeenDuringExecution).toBe(true);
    expect(first?.outcome).toBe('confirmed');
    expect(second).toEqual(first);
    expect(adapters.executions).toBe(1);
  });

  it('returns the stored result for redelivery after expiry instead of rejecting or rerunning', async () => {
    const { ex, adapters } = setup();
    const c = cmd({ expiresAt: new Date(Date.now() + 1000).toISOString() });
    const first = await ex.handle(c);
    const later = await ex.handle(c, new Date(Date.now() + 5000));
    expect(later).toEqual(first);
    expect(adapters.executions).toBe(1);
  });

  it('reconciles a crash between apply and record: observed state → confirmed, otherwise unknown', async () => {
    const { ledger, adapters, store } = setup();
    // Simulate a crash: receipt marked applying, change made, result never recorded.
    const applied = cmd({ type: 'device.block_source_ip', params: { address: '203.0.113.7', direction: 'inbound' } });
    ledger.recordReceipt(applied as never);
    ledger.markApplying(String(applied.id));
    adapters.state.rules.push('203.0.113.7');
    const notApplied = cmd({ type: 'device.block_source_ip', params: { address: '198.51.100.9', direction: 'inbound' } });
    ledger.recordReceipt(notApplied as never);
    ledger.markApplying(String(notApplied.id));
    // Restart: new executor over the same state directory.
    const ex2 = new Executor({ deviceId: DEVICE, orgId: ORG, keys: KEYS, recoverySids: [] }, new Ledger(store), adapters);
    const results = await ex2.reconcileInterrupted();
    const byId = Object.fromEntries(results.map((r) => [r.commandId, r.outcome]));
    expect(byId[String(applied.id)]).toBe('confirmed');
    expect(byId[String(notApplied.id)]).toBe('unknown');
    expect(adapters.executions).toBe(0); // reconciliation never reruns
    // Redelivery after reconciliation returns the reconciled result.
    expect((await ex2.handle(notApplied))?.outcome).toBe('unknown');
  });
});

describe('protected identities and preconditions', () => {
  it('refuses to disable the recovery identity, the agent identity and the last enabled admin', async () => {
    const { ex, adapters } = setup(['S-1-5-21-1000-1000-1000-1002']);
    expect((await ex.handle(cmd({ type: 'device.disable_local_account', params: { sid: 'S-1-5-21-1000-1000-1000-1002' } })))?.rejectionReason).toBe('protected_identity');
    expect((await ex.handle(cmd({ type: 'device.disable_local_account', params: { sid: 'S-1-5-21-1000-1000-1000-1001' } })))?.rejectionReason).toBe('protected_identity');
    // Make 1002 the only enabled admin, then try to disable it without the recovery flag.
    const { ex: ex2, adapters: a2 } = setup();
    a2.state.accounts.find((a) => a.sid === 'S-1-5-21-1000-1000-1000-1001')!.enabled = false;
    expect((await ex2.handle(cmd({ type: 'device.disable_local_account', params: { sid: 'S-1-5-21-1000-1000-1000-1002' } })))?.rejectionReason).toBe('protected_identity');
    expect(adapters.executions + a2.executions).toBe(0);
  });

  it('disables an ordinary account and reports the existing-session boundary', async () => {
    const { ex } = setup();
    const r = await ex.handle(cmd({ type: 'device.disable_local_account', params: { sid: 'S-1-5-21-1000-1000-1000-1003' } }));
    expect(r?.outcome).toBe('confirmed');
    expect(r?.boundaries).toContain('existing_sessions');
  });

  it('reports partial when new storage is blocked but a drive is already mounted', async () => {
    const { ex } = setup();
    const r = await ex.handle(cmd({ type: 'device.restrict_removable_storage', params: { scope: 'new_removable_disks' } }));
    expect(r?.outcome).toBe('partial');
    expect(r?.boundaries).toContain('already_mounted');
  });

  it('undo restores only while the device still holds the Saathi-applied state', async () => {
    const { ex, adapters } = setup();
    const apply = cmd({ type: 'device.set_lockout_policy', params: { threshold: 5, durationMinutes: 15 } });
    await ex.handle(apply);
    // An administrator changes the policy afterwards: undo must refuse.
    adapters.state.lockout.threshold = 8;
    const refused = await ex.handle(cmd({ type: 'device.undo_change', params: { changeId: String(apply.actionId) } }));
    expect(refused?.rejectionReason).toBe('precondition_changed');
    adapters.state.lockout.threshold = 5;
    const ok = await ex.handle(cmd({ type: 'device.undo_change', params: { changeId: String(apply.actionId) } }));
    expect(ok?.outcome).toBe('confirmed');
    expect(adapters.state.lockout.threshold).toBe(0);
  });
});
