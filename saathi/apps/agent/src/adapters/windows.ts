import { randomBytes } from 'node:crypto';
import { connect } from 'node:net';
import { DEVICE_ACTIONS, type CommandEnvelope, type DeviceActionType, type Heartbeat } from '@saathi/contracts';
import type { ChangeRecord, Receipt } from '../ledger';
import { collectPosture, lockoutDuration, lockoutThreshold, readAccounts, type AccountsSnapshot } from '../posture';
import { runExe, runPs } from '../powershell';
import { probe, type DeviceAdapters, type ExecOutcome, type Probe, type StateValue, type CapabilityReportT } from './types';

// Real Windows adapters (full mode). Use only on an authorized, disposable test machine:
// these change security policy. Each script is a fixed constant; parameters arrive through
// SAATHI_* environment variables after DEVICE_ACTION_PARAMS validation.

export const LOCK_PIPE = '\\\\.\\pipe\\saathi-lock';

const S = {
  disableAccount: `Disable-LocalUser -SID $env:SAATHI_SID; @{ ok=$true } | ConvertTo-Json -Compress`,
  enableAccount: `Enable-LocalUser -SID $env:SAATHI_SID; @{ ok=$true } | ConvertTo-Json -Compress`,
  accountEnabled: `@{ enabled=[bool](Get-LocalUser -SID $env:SAATHI_SID).Enabled } | ConvertTo-Json -Compress`,
  firewallState: `@(Get-NetFirewallProfile | ForEach-Object { @{ name=[string]$_.Name; enabled=[bool]($_.Enabled -eq $true -or [string]$_.Enabled -eq 'True') } }) | ConvertTo-Json -Compress`,
  firewallSet: `$p = $env:SAATHI_PROFILE; $on = ($env:SAATHI_ENABLED -eq '1'); if ($p -eq 'All') { Set-NetFirewallProfile -Profile Domain,Private,Public -Enabled $on } else { Set-NetFirewallProfile -Profile $p -Enabled $on }; @{ ok=$true } | ConvertTo-Json -Compress`,
  ruleAdd: `$n = 'Saathi block ' + $env:SAATHI_IP; if (-not (Get-NetFirewallRule -DisplayName $n -ErrorAction SilentlyContinue)) { New-NetFirewallRule -DisplayName $n -Direction Inbound -RemoteAddress $env:SAATHI_IP -Action Block -Profile Any | Out-Null }; @{ ok=$true } | ConvertTo-Json -Compress`,
  ruleRemove: `Remove-NetFirewallRule -DisplayName ('Saathi block ' + $env:SAATHI_IP) -ErrorAction SilentlyContinue; @{ ok=$true } | ConvertTo-Json -Compress`,
  ruleState: `$r = Get-NetFirewallRule -DisplayName ('Saathi block ' + $env:SAATHI_IP) -ErrorAction SilentlyContinue; if (-not $r) { @{ present=$false } | ConvertTo-Json -Compress } else { $a = ($r | Get-NetFirewallAddressFilter).RemoteAddress; @{ present=$true; enabled=[string]$r.Enabled; action=[string]$r.Action; direction=[string]$r.Direction; remote=@($a) } | ConvertTo-Json -Compress }`,
  avState: `$m = Get-MpComputerStatus; @{ rtp=[bool]$m.RealTimeProtectionEnabled; tamper=[bool]$m.IsTamperProtected; quickStart=$(if($m.QuickScanStartTime){$m.QuickScanStartTime.ToUniversalTime().ToString('o')}else{$null}); quickEnd=$(if($m.QuickScanEndTime){$m.QuickScanEndTime.ToUniversalTime().ToString('o')}else{$null}); fullStart=$(if($m.FullScanStartTime){$m.FullScanStartTime.ToUniversalTime().ToString('o')}else{$null}) } | ConvertTo-Json -Compress`,
  avEnable: `Set-MpPreference -DisableRealtimeMonitoring $false; @{ ok=$true } | ConvertTo-Json -Compress`,
  avDisableRestore: `Set-MpPreference -DisableRealtimeMonitoring $true; @{ ok=$true } | ConvertTo-Json -Compress`,
  avScan: `$t = if ($env:SAATHI_SCAN -eq 'full') { 2 } else { 1 }; $exe = Join-Path $env:ProgramFiles 'Windows Defender\\MpCmdRun.exe'; Start-Process -FilePath $exe -ArgumentList @('-Scan','-ScanType',[string]$t) -WindowStyle Hidden | Out-Null; @{ ok=$true } | ConvertTo-Json -Compress`,
  // Documented device-installation restriction policy: prevents installation of new
  // removable devices. Devices already installed/mounted are not affected.
  storageState: `$k = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceInstall\\Restrictions'; $v = $null; if (Test-Path $k) { $v = (Get-ItemProperty -Path $k -Name DenyRemovableDevices -ErrorAction SilentlyContinue).DenyRemovableDevices }; $mounted = @(Get-Volume | Where-Object { $_.DriveType -eq 'Removable' -and $_.DriveLetter }).Count; @{ deny=$v; mounted=$mounted } | ConvertTo-Json -Compress`,
  storageSet: `$k = 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceInstall\\Restrictions'; if ($env:SAATHI_VALUE -eq 'absent') { if (Test-Path $k) { Remove-ItemProperty -Path $k -Name DenyRemovableDevices -ErrorAction SilentlyContinue } } else { if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }; New-ItemProperty -Path $k -Name DenyRemovableDevices -PropertyType DWord -Value ([int]$env:SAATHI_VALUE) -Force | Out-Null }; @{ ok=$true } | ConvertTo-Json -Compress`,
};

async function ps<T>(script: string, env: Record<string, string> = {}): Promise<T> {
  const r = await runPs<T>(script, env);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

/** Ask the session-aware helper to lock the interactive desktop and report observation. */
export function requestLock(timeoutMs = 15_000): Promise<{ observed: boolean; reply: string }> {
  const nonce = randomBytes(12).toString('hex');
  return new Promise((resolve) => {
    const sock = connect(LOCK_PIPE);
    let buf = '';
    const done = (observed: boolean, reply: string) => {
      sock.destroy();
      resolve({ observed, reply });
    };
    const timer = setTimeout(() => done(false, 'timeout waiting for lock notification'), timeoutMs);
    sock.on('connect', () => sock.write(`LOCK ${nonce}\n`));
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      if (buf.includes('\n')) {
        clearTimeout(timer);
        const line = buf.split('\n')[0].trim();
        done(line.startsWith(`LOCKED ${nonce} `), line);
      }
    });
    sock.on('error', (e) => {
      clearTimeout(timer);
      done(false, `helper unavailable: ${e.message}`);
    });
  });
}

export function helperConnected(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect(LOCK_PIPE);
    const t = setTimeout(() => {
      sock.destroy();
      resolve(false);
    }, timeoutMs);
    sock.on('connect', () => {
      clearTimeout(t);
      sock.end();
      resolve(true);
    });
    sock.on('error', () => {
      clearTimeout(t);
      resolve(false);
    });
  });
}

const allOn = (fw: { name: string; enabled: boolean }[]) => fw.every((p) => p.enabled);
const asArr = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export class WindowsAdapters implements DeviceAdapters {
  readonly mode: 'full' | 'observe-only' = 'full';
  readonly simulated = false;
  protected snapshot: AccountsSnapshot | null = null;
  protected securityLogReadable: boolean | null = null;
  protected securityLogDetail: string | null = null;
  protected defenderAvailable: boolean | null = null;

  setSecurityLogStatus(readable: boolean, detail: string | null) {
    this.securityLogReadable = readable;
    this.securityLogDetail = detail;
  }

  protected async snap(refresh = false) {
    if (!this.snapshot || refresh) this.snapshot = await readAccounts();
    return this.snapshot;
  }
  async accounts() {
    return (await this.snap(true)).accounts;
  }
  async agentSid() {
    return (await this.snap()).self;
  }

  async capabilities(): Promise<CapabilityReportT[]> {
    const s = await this.snap();
    const helper = await helperConnected();
    return DEVICE_ACTIONS.map((action) => {
      if (action === 'device.lock_session') return { action, supported: helper, reason: helper ? null : 'Lock helper is not running in the interactive session' };
      if (!s.elevated) return { action, supported: false, reason: 'Agent is not running with administrator rights' };
      if ((action === 'device.enable_av' || action === 'device.request_av_scan') && this.defenderAvailable === false) return { action, supported: false, reason: 'Microsoft Defender is not available on this device' };
      return { action, supported: true, reason: null };
    });
  }

  async prerequisites(): Promise<Heartbeat['prerequisites']> {
    const s = await this.snap();
    return [
      { key: 'elevated', met: s.elevated, detail: s.elevated ? null : 'Run the agent as an administrator or a service to read the Security log and apply actions.' },
      { key: 'security_log_access', met: this.securityLogReadable === true, detail: this.securityLogReadable === null ? 'Not yet checked' : this.securityLogDetail },
      { key: 'defender_available', met: this.defenderAvailable !== false, detail: this.defenderAvailable === false ? 'Get-MpComputerStatus unavailable' : null },
      { key: 'admin_group_readable', met: s.adminsKnown, detail: s.adminsKnown ? null : 'Could not read the local Administrators group' },
    ];
  }

  async posture() {
    const p = await collectPosture(await this.snap(true));
    this.defenderAvailable = p.raw ? !!p.raw.mp : null;
    return p.posture;
  }

  async interactiveSession() {
    const helper = await helperConnected();
    return { present: helper, locked: null, helperConnected: helper };
  }

  async stillOwned(change: ChangeRecord): Promise<boolean> {
    const cur = await this.currentState(change.type as DeviceActionType, change.appliedState);
    return JSON.stringify(cur) === JSON.stringify(change.appliedState);
  }

  /** Read the state that a given action controls, shaped like its applied state. */
  protected async currentState(type: DeviceActionType, params: StateValue): Promise<StateValue | null> {
    switch (type) {
      case 'device.disable_local_account':
        return { sid: String(params.sid), enabled: (await ps<{ enabled: boolean }>(S.accountEnabled, { SAATHI_SID: String(params.sid) })).enabled };
      case 'device.enable_firewall': {
        const fw = asArr(await ps<{ name: string; enabled: boolean }[]>(S.firewallState));
        return Object.fromEntries(fw.map((p) => [p.name, p.enabled]));
      }
      case 'device.set_lockout_policy': {
        const out = (await runExe('net', ['accounts'])).stdout;
        return { threshold: lockoutThreshold(out), durationMinutes: lockoutDuration(out) };
      }
      case 'device.block_source_ip': {
        const r = await ps<{ present: boolean }>(S.ruleState, { SAATHI_IP: String(params.address) });
        return { address: String(params.address), rulePresent: r.present };
      }
      case 'device.enable_av':
        return { realtime: (await ps<{ rtp: boolean }>(S.avState)).rtp };
      case 'device.restrict_removable_storage': {
        const r = await ps<{ deny: number | null }>(S.storageState);
        return { denyRemovableDevices: r.deny ?? 'absent' };
      }
      default:
        return null;
    }
  }

  async execute(c: CommandEnvelope, ctx: { change: ChangeRecord | null }): Promise<ExecOutcome> {
    const p = c.params as StateValue;
    switch (c.type) {
      case 'device.lock_session': {
        const r = await requestLock();
        return { priorState: null, appliedState: null, probes: [probe('session_locked', 'lock notification observed', r.reply, r.observed)], boundaries: ['lock_not_termination'] };
      }
      case 'device.disable_local_account': {
        const prior = await this.currentState(c.type, p);
        await ps(S.disableAccount, { SAATHI_SID: String(p.sid) });
        return { priorState: prior, appliedState: { sid: String(p.sid), enabled: false }, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: ['existing_sessions'] };
      }
      case 'device.enable_firewall': {
        const prior = await this.currentState(c.type, p);
        await ps(S.firewallSet, { SAATHI_PROFILE: String(p.profile), SAATHI_ENABLED: '1' });
        const after = await this.currentState(c.type, p);
        return { priorState: prior, appliedState: after, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: ['managed_policy'] };
      }
      case 'device.set_lockout_policy': {
        const prior = await this.currentState(c.type, p);
        const th = Number(p.threshold);
        const dur = Number(p.durationMinutes);
        const r = await runExe('net', ['accounts', `/lockoutthreshold:${th}`, `/lockoutduration:${dur}`, `/lockoutwindow:${dur}`]);
        if (!r.ok) throw new Error(r.stderr);
        return { priorState: prior, appliedState: { threshold: th, durationMinutes: dur }, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: [] };
      }
      case 'device.block_source_ip': {
        await ps(S.ruleAdd, { SAATHI_IP: String(p.address) });
        return { priorState: { address: String(p.address), rulePresent: false }, appliedState: { address: String(p.address), rulePresent: true }, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: [] };
      }
      case 'device.enable_av': {
        const prior = await this.currentState(c.type, p);
        await ps(S.avEnable);
        return { priorState: prior, appliedState: { realtime: true }, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: ['managed_policy'] };
      }
      case 'device.request_av_scan': {
        await ps(S.avScan, { SAATHI_SCAN: String(p.scanType) });
        await new Promise((r) => setTimeout(r, 8000));
        return { priorState: null, appliedState: null, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: ['scan_not_eradication'] };
      }
      case 'device.restrict_removable_storage': {
        const prior = await this.currentState(c.type, p);
        await ps(S.storageSet, { SAATHI_VALUE: '1' });
        return { priorState: prior, appliedState: { denyRemovableDevices: 1 }, probes: await this.probeFor(c.type, p, c.issuedAt), boundaries: ['already_mounted'] };
      }
      case 'device.undo_change': {
        const ch = ctx.change!;
        await this.restore(ch);
        const now = await this.currentState(ch.type as DeviceActionType, ch.priorState);
        const restored = JSON.stringify(now) === JSON.stringify(ch.priorState);
        return { priorState: ch.appliedState, appliedState: ch.priorState, probes: [probe('prior_state_restored', JSON.stringify(ch.priorState), JSON.stringify(now), restored)], boundaries: [] };
      }
    }
  }

  protected async restore(ch: ChangeRecord) {
    const prior = ch.priorState;
    switch (ch.type) {
      case 'device.disable_local_account':
        if (prior.enabled) await ps(S.enableAccount, { SAATHI_SID: String(prior.sid) });
        return;
      case 'device.enable_firewall':
        for (const [name, on] of Object.entries(prior)) if (on === false) await ps(S.firewallSet, { SAATHI_PROFILE: name, SAATHI_ENABLED: '0' });
        return;
      case 'device.set_lockout_policy': {
        const r = await runExe('net', ['accounts', `/lockoutthreshold:${Number(prior.threshold ?? 0)}`, ...(prior.durationMinutes ? [`/lockoutduration:${Number(prior.durationMinutes)}`] : [])]);
        if (!r.ok) throw new Error(r.stderr);
        return;
      }
      case 'device.block_source_ip':
        await ps(S.ruleRemove, { SAATHI_IP: String(prior.address) });
        return;
      case 'device.enable_av':
        if (prior.realtime === false) await ps(S.avDisableRestore);
        return;
      case 'device.restrict_removable_storage':
        await ps(S.storageSet, { SAATHI_VALUE: prior.denyRemovableDevices === 'absent' ? 'absent' : String(Number(prior.denyRemovableDevices)) });
        return;
      default:
        throw new Error(`undo not supported for ${ch.type}`);
    }
  }

  /** Postcondition probes: effective state, not exit codes. */
  protected async probeFor(type: DeviceActionType, p: StateValue, issuedAt: string): Promise<Probe[]> {
    switch (type) {
      case 'device.disable_local_account': {
        const s = await ps<{ enabled: boolean }>(S.accountEnabled, { SAATHI_SID: String(p.sid) });
        return [probe('account_disabled', 'Enabled=False', `Enabled=${s.enabled}`, !s.enabled), probe('new_login_denied', 'sign-in refused', 'not tested automatically (would require a test credential)', null)];
      }
      case 'device.enable_firewall': {
        const fw = asArr(await ps<{ name: string; enabled: boolean }[]>(S.firewallState));
        const target = p.profile === 'All' ? fw : fw.filter((x) => x.name === p.profile);
        return [probe('firewall_profile_enabled', `${p.profile} enabled`, fw.map((x) => `${x.name}:${x.enabled ? 'on' : 'off'}`).join(', '), target.length > 0 && allOn(target))];
      }
      case 'device.set_lockout_policy': {
        const out = (await runExe('net', ['accounts'])).stdout;
        const th = lockoutThreshold(out);
        return [probe('lockout_threshold', String(p.threshold), String(th), th === Number(p.threshold))];
      }
      case 'device.block_source_ip': {
        const r = await ps<{ present: boolean; enabled?: string; action?: string; direction?: string; remote?: string[] | string }>(S.ruleState, { SAATHI_IP: String(p.address) });
        const remote = asArr(r.remote);
        return [
          probe('rule_present', 'rule exists', r.present ? 'present' : 'absent', r.present),
          probe('rule_matches', `inbound block ${p.address}, enabled`, r.present ? `${r.direction} ${r.action} ${remote.join(',')} enabled=${r.enabled}` : 'absent', r.present && r.enabled === 'True' && r.action === 'Block' && r.direction === 'Inbound' && remote.includes(String(p.address))),
        ];
      }
      case 'device.enable_av': {
        const s = await ps<{ rtp: boolean; tamper: boolean }>(S.avState);
        return [probe('av_realtime_enabled', 'real-time protection on', s.rtp ? 'on' : `off${s.tamper ? ' (tamper protection on)' : ''}`, s.rtp)];
      }
      case 'device.request_av_scan': {
        const s = await ps<{ quickStart: string | null; fullStart: string | null }>(S.avState);
        const started = p.scanType === 'full' ? s.fullStart : s.quickStart;
        const ok = !!started && new Date(started).getTime() >= new Date(issuedAt).getTime() - 5000;
        return [probe('scan_status', 'scan started after the request', started ? `last ${p.scanType} scan started ${started}` : 'no scan start recorded', ok)];
      }
      case 'device.restrict_removable_storage': {
        const s = await ps<{ deny: number | null; mounted: number }>(S.storageState);
        return [probe('storage_policy_effective', 'DenyRemovableDevices=1', `DenyRemovableDevices=${s.deny ?? 'absent'}`, s.deny === 1), probe('mounted_removable_volumes', '0 mounted removable volumes', `${s.mounted} mounted`, s.mounted === 0)];
      }
      default:
        return [];
    }
  }

  async probe(r: Receipt, ctx: { change: ChangeRecord | null }): Promise<Probe[]> {
    if (r.type === 'device.lock_session') return [probe('session_locked', 'lock notification observed', 'not observable after restart', null)];
    if (r.type === 'device.undo_change') {
      const ch = ctx.change;
      if (!ch) return [probe('prior_state_restored', 'restored', 'change record missing', null)];
      const now = await this.currentState(ch.type as DeviceActionType, ch.priorState);
      return [probe('prior_state_restored', JSON.stringify(ch.priorState), JSON.stringify(now), JSON.stringify(now) === JSON.stringify(ch.priorState))];
    }
    return this.probeFor(r.type, r.params as StateValue, r.receivedAt);
  }
}
