import { DEVICE_ACTIONS, type CommandEnvelope, type DeviceActionType, type Heartbeat, type PostureCheck, type PostureKey } from '@saathi/contracts';
import type { ChangeRecord, Receipt } from '../ledger';
import { probe, type Account, type DeviceAdapters, type ExecOutcome, type Probe, type StateValue, type CapabilityReportT } from './types';

// Simulated adapters (decision D-015): an in-memory device for tests and labelled demos.
// Every result is marked simulated and carries the 'simulated' boundary and probe so the
// console shows "Simulated device (test fixture)". Never used for live-device gates.

export type SimState = {
  accounts: Account[];
  firewall: Record<string, boolean>;
  lockout: { threshold: number; durationMinutes: number };
  rules: string[];
  realtime: boolean;
  denyRemovable: number | 'absent';
  mountedRemovable: number;
  locked: boolean;
  lastScanAt: string | null;
  rdpEnabled: boolean;
};

export function defaultSimState(): SimState {
  return {
    accounts: [
      { sid: 'S-1-5-21-1000-1000-1000-500', username: 'Administrator', isAdmin: true, enabled: false },
      { sid: 'S-1-5-21-1000-1000-1000-1001', username: 'owner-admin', isAdmin: true, enabled: true },
      { sid: 'S-1-5-21-1000-1000-1000-1002', username: 'frontdesk', isAdmin: true, enabled: true },
      { sid: 'S-1-5-21-1000-1000-1000-1003', username: 'staff', isAdmin: false, enabled: true },
    ],
    firewall: { Domain: true, Private: true, Public: false },
    lockout: { threshold: 0, durationMinutes: 30 },
    rules: [],
    realtime: true,
    denyRemovable: 'absent',
    mountedRemovable: 1,
    locked: false,
    lastScanAt: null,
    rdpEnabled: true,
  };
}

const sim = () => probe('simulated', 'test fixture', 'simulated adapter (no real device was changed)', true);

export class SimulatedAdapters implements DeviceAdapters {
  readonly mode = 'simulate' as const;
  readonly simulated = true;
  /** Count of real mutations, so tests can assert "no rerun". */
  executions = 0;

  constructor(
    public state: SimState = defaultSimState(),
    private self = 'S-1-5-21-1000-1000-1000-1001',
  ) {}

  async capabilities(): Promise<CapabilityReportT[]> {
    return DEVICE_ACTIONS.map((action) => ({ action, supported: true, reason: null }));
  }
  async prerequisites(): Promise<Heartbeat['prerequisites']> {
    return [{ key: 'simulated_device', met: true, detail: 'Simulated test fixture; no real Windows device is observed or changed.' }];
  }
  async accounts() {
    return structuredClone(this.state.accounts);
  }
  async agentSid() {
    return this.self;
  }
  async interactiveSession() {
    return { present: true, locked: this.state.locked, helperConnected: true };
  }
  async posture(): Promise<Partial<Record<PostureKey, PostureCheck>>> {
    const at = new Date().toISOString();
    const c = (result: PostureCheck['result'], value: string): PostureCheck => ({ result, value, source: 'simulated adapter', observedAt: at });
    const s = this.state;
    const admins = s.accounts.filter((a) => a.isAdmin && a.enabled).length;
    return {
      av: c(s.realtime ? 'pass' : 'fail', `real-time protection ${s.realtime ? 'on' : 'off'}`),
      firewall: c(Object.values(s.firewall).every(Boolean) ? 'pass' : 'fail', Object.entries(s.firewall).map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(', ')),
      updates: c('pass', 'latest update installed 12 days ago'),
      lockout: c(s.lockout.threshold >= 1 && s.lockout.threshold <= 20 ? 'pass' : 'fail', s.lockout.threshold ? `lockout after ${s.lockout.threshold}` : 'no lockout after wrong passwords'),
      admin_exposure: c(admins <= 2 ? 'pass' : 'fail', `${admins} enabled local administrator accounts`),
      remote_access: c(s.rdpEnabled ? 'fail' : 'pass', s.rdpEnabled ? 'Remote Desktop on' : 'Remote Desktop off'),
    };
  }

  private current(type: string, p: StateValue): StateValue | null {
    const s = this.state;
    switch (type) {
      case 'device.disable_local_account':
        return { sid: String(p.sid), enabled: s.accounts.find((a) => a.sid === p.sid)?.enabled ?? false };
      case 'device.enable_firewall':
        return { ...s.firewall };
      case 'device.set_lockout_policy':
        return { threshold: s.lockout.threshold, durationMinutes: s.lockout.durationMinutes };
      case 'device.block_source_ip':
        return { address: String(p.address), rulePresent: s.rules.includes(String(p.address)) };
      case 'device.enable_av':
        return { realtime: s.realtime };
      case 'device.restrict_removable_storage':
        return { denyRemovableDevices: s.denyRemovable };
      default:
        return null;
    }
  }

  async stillOwned(change: ChangeRecord) {
    return JSON.stringify(this.current(change.type, change.appliedState)) === JSON.stringify(change.appliedState);
  }

  async execute(c: CommandEnvelope, ctx: { change: ChangeRecord | null }): Promise<ExecOutcome> {
    this.executions++;
    const s = this.state;
    const p = c.params as StateValue;
    const prior = this.current(c.type, p);
    switch (c.type as DeviceActionType) {
      case 'device.lock_session':
        s.locked = true;
        return { priorState: null, appliedState: null, probes: [probe('session_locked', 'lock notification observed', 'simulated lock notification', true), sim()], boundaries: ['lock_not_termination', 'simulated'] };
      case 'device.disable_local_account': {
        const a = s.accounts.find((x) => x.sid === p.sid)!;
        a.enabled = false;
        return { priorState: prior, appliedState: { sid: a.sid, enabled: false }, probes: await this.probes(c.type, p), boundaries: ['existing_sessions', 'simulated'] };
      }
      case 'device.enable_firewall':
        for (const k of Object.keys(s.firewall)) if (p.profile === 'All' || p.profile === k) s.firewall[k] = true;
        return { priorState: prior, appliedState: { ...s.firewall }, probes: await this.probes(c.type, p), boundaries: ['managed_policy', 'simulated'] };
      case 'device.set_lockout_policy':
        s.lockout = { threshold: Number(p.threshold), durationMinutes: Number(p.durationMinutes) };
        return { priorState: prior, appliedState: { ...s.lockout }, probes: await this.probes(c.type, p), boundaries: ['simulated'] };
      case 'device.block_source_ip':
        if (!s.rules.includes(String(p.address))) s.rules.push(String(p.address));
        return { priorState: prior, appliedState: { address: String(p.address), rulePresent: true }, probes: await this.probes(c.type, p), boundaries: ['simulated'] };
      case 'device.enable_av':
        s.realtime = true;
        return { priorState: prior, appliedState: { realtime: true }, probes: await this.probes(c.type, p), boundaries: ['managed_policy', 'simulated'] };
      case 'device.request_av_scan':
        s.lastScanAt = new Date().toISOString();
        return { priorState: null, appliedState: null, probes: await this.probes(c.type, p), boundaries: ['scan_not_eradication', 'simulated'] };
      case 'device.restrict_removable_storage':
        s.denyRemovable = 1;
        return { priorState: prior, appliedState: { denyRemovableDevices: 1 }, probes: await this.probes(c.type, p), boundaries: ['already_mounted', 'simulated'] };
      case 'device.undo_change': {
        const ch = ctx.change!;
        this.restore(ch);
        const now = this.current(ch.type, ch.priorState);
        return { priorState: ch.appliedState, appliedState: ch.priorState, probes: [probe('prior_state_restored', JSON.stringify(ch.priorState), JSON.stringify(now), JSON.stringify(now) === JSON.stringify(ch.priorState)), sim()], boundaries: ['simulated'] };
      }
    }
  }

  private restore(ch: ChangeRecord) {
    const s = this.state;
    const prior = ch.priorState;
    if (ch.type === 'device.disable_local_account') {
      const a = s.accounts.find((x) => x.sid === prior.sid);
      if (a) a.enabled = !!prior.enabled;
    } else if (ch.type === 'device.enable_firewall') {
      for (const [k, v] of Object.entries(prior)) s.firewall[k] = !!v;
    } else if (ch.type === 'device.set_lockout_policy') s.lockout = { threshold: Number(prior.threshold), durationMinutes: Number(prior.durationMinutes) };
    else if (ch.type === 'device.block_source_ip') s.rules = s.rules.filter((r) => r !== prior.address);
    else if (ch.type === 'device.enable_av') s.realtime = !!prior.realtime;
    else if (ch.type === 'device.restrict_removable_storage') s.denyRemovable = prior.denyRemovableDevices === 'absent' ? 'absent' : Number(prior.denyRemovableDevices);
  }

  private async probes(type: string, p: StateValue): Promise<Probe[]> {
    const s = this.state;
    switch (type) {
      case 'device.disable_local_account': {
        const a = s.accounts.find((x) => x.sid === p.sid);
        return [probe('account_disabled', 'Enabled=False', `Enabled=${a?.enabled}`, a ? !a.enabled : false), sim()];
      }
      case 'device.enable_firewall':
        return [probe('firewall_profile_enabled', `${p.profile} enabled`, Object.entries(s.firewall).map(([k, v]) => `${k}:${v ? 'on' : 'off'}`).join(', '), Object.entries(s.firewall).every(([k, v]) => (p.profile === 'All' || p.profile === k ? v : true))), sim()];
      case 'device.set_lockout_policy':
        return [probe('lockout_threshold', String(p.threshold), String(s.lockout.threshold), s.lockout.threshold === Number(p.threshold)), sim()];
      case 'device.block_source_ip': {
        const ok = s.rules.includes(String(p.address));
        return [probe('rule_present', 'rule exists', ok ? 'present' : 'absent', ok), probe('rule_matches', `inbound block ${p.address}`, ok ? `Inbound Block ${p.address}` : 'absent', ok), sim()];
      }
      case 'device.enable_av':
        return [probe('av_realtime_enabled', 'real-time protection on', s.realtime ? 'on' : 'off', s.realtime), sim()];
      case 'device.request_av_scan':
        return [probe('scan_status', 'scan started after the request', s.lastScanAt ? `scan started ${s.lastScanAt}` : 'no scan', !!s.lastScanAt), sim()];
      case 'device.restrict_removable_storage':
        return [probe('storage_policy_effective', 'DenyRemovableDevices=1', `DenyRemovableDevices=${s.denyRemovable}`, s.denyRemovable === 1), probe('mounted_removable_volumes', '0 mounted removable volumes', `${s.mountedRemovable} mounted`, s.mountedRemovable === 0), sim()];
      default:
        return [sim()];
    }
  }

  async probe(r: Receipt, ctx: { change: ChangeRecord | null }): Promise<Probe[]> {
    if (r.type === 'device.lock_session') return [probe('session_locked', 'lock notification observed', this.state.locked ? 'locked' : 'not locked', this.state.locked), sim()];
    if (r.type === 'device.undo_change') {
      const ch = ctx.change;
      if (!ch) return [probe('prior_state_restored', 'restored', 'change record missing', null)];
      const now = this.current(ch.type, ch.priorState);
      return [probe('prior_state_restored', JSON.stringify(ch.priorState), JSON.stringify(now), JSON.stringify(now) === JSON.stringify(ch.priorState)), sim()];
    }
    return this.probes(r.type, r.params as StateValue);
  }
}
