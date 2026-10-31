import { hostname, release } from 'node:os';
import { fileURLToPath } from 'node:url';
import { type CommandEnvelope, type CommandResult, type EnrollResponse, type Heartbeat, type PostureCheck, type PostureKey } from '@saathi/contracts';
import { ObserveOnlyAdapters } from './adapters/observe';
import { SimulatedAdapters } from './adapters/simulated';
import type { DeviceAdapters } from './adapters/types';
import { WindowsAdapters } from './adapters/windows';
import { Collector } from './collector';
import { Executor } from './executor';
import { Ledger } from './ledger';
import { Spool } from './spool';
import { StateStore, defaultStateDir } from './state';
import { deviceRequest, publicRequest, TransportError, type DeviceIdentity } from './transport';

export const AGENT_VERSION = '0.1.0';
const CAPABILITY_VERSION = 1;

export type Args = { server: string; code: string | null; stateDir: string | null; mode: 'full' | 'observe-only' | 'simulate'; recoverySids: string[]; durationSeconds: number | null; verbose: boolean };

export function parseArgs(argv: string[]): Args {
  const a: Args = { server: 'http://localhost:3000', code: null, stateDir: null, mode: 'full', recoverySids: [], durationSeconds: null, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--') continue; // pnpm passes a literal separator through
    else if (k === '--server') a.server = next();
    else if (k === '--code') a.code = next();
    else if (k === '--state-dir') a.stateDir = next();
    else if (k === '--simulate') a.mode = 'simulate';
    else if (k === '--observe-only') a.mode = 'observe-only';
    else if (k === '--recovery-account') a.recoverySids.push(next());
    else if (k === '--duration') a.durationSeconds = Number(next());
    else if (k === '--verbose') a.verbose = true;
    else throw new Error(`Unknown argument ${k}`);
  }
  if (!/^https?:\/\//.test(a.server)) throw new Error('--server must be an http(s) URL');
  if (a.server.startsWith('http://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(a.server)) throw new Error('Plain HTTP is only allowed for localhost; use HTTPS.');
  for (const s of a.recoverySids) if (!/^S-1-5-[0-9-]+$/.test(s)) throw new Error(`Invalid recovery account SID ${s}`);
  return a;
}

const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

type DeviceFile = DeviceIdentity & { commandKeys: EnrollResponse['commandKeys']; mode: Args['mode']; enrolledAt: string };

export async function enroll(store: StateStore, args: Args): Promise<DeviceFile> {
  const existing = store.read<DeviceFile | null>('device.json', null);
  if (existing) return existing;
  if (!args.code) throw new Error('This agent is not enrolled. Run it once with --code <ENROLLMENT-CODE> from the Saathi Devices page.');
  const r = await publicRequest<EnrollResponse>(args.server, '/api/v1/agent/enroll', {
    code: args.code,
    // A simulated device never reports the real machine's identity.
    hostname: args.mode === 'simulate' ? 'SIMULATED-DEVICE' : hostname().slice(0, 120),
    osVersion: args.mode === 'simulate' ? 'simulated test fixture' : `${process.platform} ${release()}`.slice(0, 200),
    agentVersion: AGENT_VERSION,
    simulated: args.mode === 'simulate',
  });
  const dev: DeviceFile = { deviceId: r.deviceId, orgId: r.orgId, deviceSecret: r.deviceSecret, keyVersion: r.keyVersion, server: args.server, commandKeys: r.commandKeys, mode: args.mode, enrolledAt: new Date().toISOString() };
  store.write('device.json', dev);
  log('enrolled', { deviceId: r.deviceId, mode: args.mode, pinnedKeys: r.commandKeys.map((k) => k.keyId) });
  return dev;
}

export function createAdapters(mode: Args['mode']): DeviceAdapters {
  if (mode === 'simulate') return new SimulatedAdapters();
  if (process.platform !== 'win32') throw new Error('Real collection and actions need Windows. Use --simulate elsewhere.');
  return mode === 'observe-only' ? new ObserveOnlyAdapters() : new WindowsAdapters();
}

export async function run(args: Args) {
  const store = new StateStore(args.stateDir ?? defaultStateDir(args.mode === 'simulate'));
  await store.restrictAcl();
  const dev = await enroll(store, args);
  if (dev.mode !== args.mode) throw new Error(`State directory was enrolled in ${dev.mode} mode; use a separate --state-dir for ${args.mode}.`);
  const adapters = createAdapters(args.mode);
  const ledger = new Ledger(store);
  const executor = new Executor({ deviceId: dev.deviceId, orgId: dev.orgId, keys: dev.commandKeys, recoverySids: args.recoverySids }, ledger, adapters);
  const spool = new Spool(store.path('spool.jsonl'), store.path('dropped.txt'));
  const collector = args.mode === 'simulate' ? null : new Collector(store);
  let posture: Partial<Record<PostureKey, PostureCheck>> | undefined;
  let postureAt = 0;
  let stopping = false;

  // Crash recovery: commands interrupted between apply and record are reconciled first.
  const reconciled = await executor.reconcileInterrupted();
  if (reconciled.length) log('reconciled interrupted commands', { count: reconciled.length, outcomes: reconciled.map((r) => r.outcome) });

  const report = async () => {
    for (const r of ledger.unreported()) {
      try {
        await deviceRequest(dev, 'POST', `/api/v1/agent/commands/${r.commandId}/result`, r.result as CommandResult);
        ledger.markReported(r.commandId);
      } catch (e) {
        if (e instanceof TransportError && e.status === 404) ledger.markReported(r.commandId);
        else throw e;
      }
    }
  };

  const heartbeat = async () => {
    if (!posture || Date.now() - postureAt > 5 * 60 * 1000) {
      posture = await adapters.posture();
      postureAt = Date.now();
    }
    const hb: Heartbeat = {
      agentVersion: AGENT_VERSION,
      capabilityVersion: CAPABILITY_VERSION,
      capabilities: await adapters.capabilities(),
      prerequisites: [...(await adapters.prerequisites()), { key: 'state_dir_acl', met: store.aclRestricted === true, detail: store.aclDetail }],
      posture,
      accounts: (await adapters.accounts()).slice(0, 200),
      interactiveSession: await adapters.interactiveSession(),
      spoolDepth: spool.depth(),
      droppedEvents: spool.dropped,
      simulated: adapters.simulated,
    };
    await deviceRequest(dev, 'POST', '/api/v1/agent/heartbeat', hb);
    if (args.verbose) log('heartbeat', { prerequisites: hb.prerequisites, posture: Object.fromEntries(Object.entries(posture ?? {}).map(([k, v]) => [k, v?.result])) });
  };

  const events = async () => {
    if (collector) {
      const { events: found, status, commit } = await collector.collect();
      const pushed = spool.push(found);
      commit();
      const sec = status.find((s) => s.channel === 'Security');
      if (adapters instanceof WindowsAdapters && sec) adapters.setSecurityLogStatus(sec.ok, sec.ok ? null : sec.error === 'access_denied' ? 'Security log requires administrator rights; failed-logon observations are unavailable.' : sec.error);
      if (args.verbose) log('collected', { status, pushed });
    }
    for (let i = 0; i < 10; i++) {
      const batch = spool.peek(200);
      const dropped = spool.dropped;
      if (batch.length === 0 && dropped === 0) break;
      const res = await deviceRequest<{ accepted: unknown[] }>(dev, 'POST', '/api/v1/agent/events', { batchId: `${Date.now()}-${i}`, events: batch, droppedSinceLast: dropped, spoolDepth: spool.depth() });
      spool.ack(res.accepted.length);
      spool.consumeDropped();
      if (batch.length < 200) break;
    }
  };

  const poll = async (): Promise<boolean> => {
    const r = await deviceRequest<{ commands: CommandEnvelope[] }>(dev, 'GET', '/api/v1/agent/commands');
    for (const c of r.commands) {
      const res = await executor.handle(c);
      if (res) log('command handled', { commandId: res.commandId, outcome: res.outcome, rejection: res.rejectionReason });
    }
    await report();
    return r.commands.length > 0;
  };

  // Loops: commands every 2 s while active, backing off when idle or offline; events every
  // 15 s; heartbeat (separate from event volume) every 30 s.
  const loop = (name: string, fn: () => Promise<boolean | void>, base: number, max: number) => {
    let delay = base;
    const tick = async () => {
      if (stopping) return;
      try {
        const busy = await fn();
        delay = busy === false ? Math.min(delay * 1.5, max) : base;
      } catch (e) {
        delay = Math.min(delay * 2, max);
        log(`${name} failed; will retry`, { error: (e as Error).message, retryInMs: Math.round(delay) });
      }
      setTimeout(tick, delay);
    };
    void tick();
  };
  log('agent running', { mode: args.mode, deviceId: dev.deviceId, stateDir: store.dir });
  loop('heartbeat', heartbeat, 30_000, 120_000);
  loop('events', events, 15_000, 120_000);
  loop('commands', poll, 2_000, 30_000);
  ledger.prune();

  await new Promise<void>((resolve) => {
    const stop = () => {
      stopping = true;
      resolve();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    if (args.durationSeconds) setTimeout(stop, args.durationSeconds * 1000);
  });
  log('agent stopped');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
  run(args)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error((e as Error).message);
      process.exit(1);
    });
}
