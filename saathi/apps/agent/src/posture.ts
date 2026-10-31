import type { PostureCheck, PostureKey } from '@saathi/contracts';
import { runPs } from './powershell';
import type { Account } from './adapters/types';

// Posture collection (build.md Ph14.1). Each check is pass / fail / unknown with its source
// and observation time. A failed read is "unknown", never a pass.

const POSTURE_SCRIPT = `
$o = [ordered]@{}
try { $m = Get-MpComputerStatus; $o.mp = @{ rtp=[bool]$m.RealTimeProtectionEnabled; av=[bool]$m.AntivirusEnabled; svc=[bool]$m.AMServiceEnabled; tamper=[bool]$m.IsTamperProtected; quickEnd=$(if($m.QuickScanEndTime){$m.QuickScanEndTime.ToUniversalTime().ToString('o')}else{$null}); quickStart=$(if($m.QuickScanStartTime){$m.QuickScanStartTime.ToUniversalTime().ToString('o')}else{$null}) } } catch { $o.mpError = $_.Exception.Message }
try { $o.fw = @(Get-NetFirewallProfile | ForEach-Object { @{ name=[string]$_.Name; enabled=[bool]($_.Enabled -eq $true -or [string]$_.Enabled -eq 'True') } }) } catch { $o.fwError = $_.Exception.Message }
try { $na = (net accounts) -join "\`n"; $o.netAccounts = $na } catch { $o.netAccountsError = $_.Exception.Message }
try { $o.rdp = (Get-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name fDenyTSConnections).fDenyTSConnections } catch { $o.rdpError = $_.Exception.Message }
try { $h = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1; if ($h) { $o.hotfix = $h.InstalledOn.ToUniversalTime().ToString('o') } } catch { $o.hotfixError = $_.Exception.Message }
[pscustomobject]$o | ConvertTo-Json -Compress -Depth 5
`;

export const ACCOUNTS_SCRIPT = `
$users = @(Get-LocalUser | ForEach-Object { @{ sid=$_.SID.Value; username=$_.Name; enabled=[bool]$_.Enabled } })
$admins = $null
try { $admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544' | ForEach-Object { $_.SID.Value }) } catch {
  try { $g = [ADSI]('WinNT://./' + (New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')).Translate([Security.Principal.NTAccount]).Value.Split('\\')[-1] + ',group'); $admins = @($g.Invoke('Members') | ForEach-Object { (New-Object Security.Principal.SecurityIdentifier($_.GetType().InvokeMember('objectSid','GetProperty',$null,$_,$null),0)).Value }) } catch { $admins = $null }
}
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
$elevated = ([Security.Principal.WindowsPrincipal]$id).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[pscustomobject]@{ users=$users; admins=$admins; self=$id.User.Value; elevated=$elevated } | ConvertTo-Json -Compress -Depth 4
`;

type RawPosture = {
  mp?: { rtp: boolean; av: boolean; svc: boolean; tamper: boolean; quickEnd: string | null; quickStart: string | null };
  mpError?: string;
  fw?: { name: string; enabled: boolean }[] | { name: string; enabled: boolean };
  fwError?: string;
  netAccounts?: string;
  rdp?: number;
  rdpError?: string;
  hotfix?: string;
};

export type AccountsSnapshot = { accounts: Account[]; self: string | null; elevated: boolean; adminsKnown: boolean };

export async function readAccounts(): Promise<AccountsSnapshot> {
  const r = await runPs<{ users: { sid: string; username: string; enabled: boolean }[] | { sid: string; username: string; enabled: boolean }; admins: string[] | string | null; self: string; elevated: boolean }>(ACCOUNTS_SCRIPT);
  if (!r.ok || !r.value) return { accounts: [], self: null, elevated: false, adminsKnown: false };
  const users = Array.isArray(r.value.users) ? r.value.users : [r.value.users];
  const admins = r.value.admins === null ? null : Array.isArray(r.value.admins) ? r.value.admins : [r.value.admins];
  return {
    accounts: users.map((u) => ({ sid: u.sid, username: u.username, enabled: u.enabled, isAdmin: admins ? admins.includes(u.sid) : false })),
    self: r.value.self ?? null,
    elevated: !!r.value.elevated,
    adminsKnown: admins !== null,
  };
}

export function lockoutThreshold(netAccounts: string | undefined): number | null {
  if (!netAccounts) return null;
  const m = netAccounts.match(/Lockout threshold:\s*(\S+)/i);
  if (!m) return null;
  return /never/i.test(m[1]) ? 0 : Number(m[1]);
}
export function lockoutDuration(netAccounts: string | undefined): number | null {
  const m = netAccounts?.match(/Lockout duration \(minutes\):\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

export function evaluatePosture(raw: RawPosture, accounts: AccountsSnapshot, now = new Date()): Partial<Record<PostureKey, PostureCheck>> {
  const at = now.toISOString();
  const c = (result: PostureCheck['result'], value: string | null, source: string): PostureCheck => ({ result, value, source, observedAt: at });
  const out: Partial<Record<PostureKey, PostureCheck>> = {};
  out.av = raw.mp ? c(raw.mp.rtp ? 'pass' : 'fail', `real-time protection ${raw.mp.rtp ? 'on' : 'off'}${raw.mp.tamper ? ', tamper protection on' : ''}`, 'Get-MpComputerStatus') : c('unknown', raw.mpError?.slice(0, 120) ?? null, 'Get-MpComputerStatus');
  const fw = raw.fw ? (Array.isArray(raw.fw) ? raw.fw : [raw.fw]) : null;
  out.firewall = fw ? c(fw.every((p) => p.enabled) ? 'pass' : 'fail', fw.map((p) => `${p.name}:${p.enabled ? 'on' : 'off'}`).join(', '), 'Get-NetFirewallProfile') : c('unknown', raw.fwError?.slice(0, 120) ?? null, 'Get-NetFirewallProfile');
  if (raw.hotfix) {
    const days = Math.floor((now.getTime() - new Date(raw.hotfix).getTime()) / 86400_000);
    out.updates = c(days <= 45 ? 'pass' : 'fail', `latest update installed ${days} days ago`, 'Get-HotFix');
  } else out.updates = c('unknown', null, 'Get-HotFix');
  const th = lockoutThreshold(raw.netAccounts);
  out.lockout = th === null ? c('unknown', null, 'net accounts') : c(th >= 1 && th <= 20 ? 'pass' : 'fail', th === 0 ? 'no lockout after wrong passwords' : `lockout after ${th} wrong passwords`, 'net accounts');
  if (accounts.adminsKnown) {
    const enabledAdmins = accounts.accounts.filter((a) => a.isAdmin && a.enabled).length;
    out.admin_exposure = c(enabledAdmins <= 2 ? 'pass' : 'fail', `${enabledAdmins} enabled local administrator accounts`, 'local Administrators group');
  } else out.admin_exposure = c('unknown', null, 'local Administrators group');
  out.remote_access = raw.rdp === undefined ? c('unknown', raw.rdpError?.slice(0, 120) ?? null, 'Terminal Server fDenyTSConnections') : c(raw.rdp === 1 ? 'pass' : 'fail', raw.rdp === 1 ? 'Remote Desktop off' : 'Remote Desktop on', 'Terminal Server fDenyTSConnections');
  return out;
}

export async function collectPosture(accounts: AccountsSnapshot): Promise<{ posture: Partial<Record<PostureKey, PostureCheck>>; raw: RawPosture | null; error: string | null }> {
  const r = await runPs<RawPosture>(POSTURE_SCRIPT, {}, 90_000);
  if (!r.ok || !r.value) return { posture: evaluatePosture({}, accounts), raw: null, error: r.ok ? 'empty output' : r.error };
  return { posture: evaluatePosture(r.value, accounts), raw: r.value, error: null };
}

export type { RawPosture };
