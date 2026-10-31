import type { AgentEvent } from '@saathi/contracts';
import { runPs } from './powershell';
import type { StateStore } from './state';

// Windows event collection (build.md Ph05). One fixed script reads a fixed channel/ID set
// after a numeric bookmark (passed via SAATHI_* env vars). Bookmarks include a log epoch so a
// cleared/recreated log is not mistaken for already-seen history.

type Channel = { name: string; ids: number[] };
export const CHANNELS: Channel[] = [
  { name: 'Security', ids: [4625, 4624, 4720, 4732] },
  { name: 'Microsoft-Windows-Partition/Diagnostic', ids: [1006] },
  { name: 'Microsoft-Windows-Windows Defender/Operational', ids: [1116, 1117, 5001] },
];

const READ_SCRIPT = `
$name = $env:SAATHI_CHANNEL; $since = [long]$env:SAATHI_SINCE; $ids = @($env:SAATHI_IDS.Split(',') | ForEach-Object { [int]$_ })
$idx = ($ids | ForEach-Object { "EventID=$_" }) -join ' or '
$out = [ordered]@{ channel=$name; ok=$true; error=$null; newest=$null; events=@() }
try {
  $newest = Get-WinEvent -LogName $name -MaxEvents 1 -ErrorAction Stop
  $out.newest = $newest.RecordId
  $q = "*[System[($idx) and EventRecordID > $since]]"
  $evs = @(Get-WinEvent -LogName $name -FilterXPath $q -MaxEvents 500 -ErrorAction SilentlyContinue | Sort-Object RecordId)
  $out.events = @($evs | ForEach-Object {
    $x = [xml]$_.ToXml(); $d = @{}
    foreach ($n in @($x.Event.EventData.Data)) { if ($n -and $n.Name) { $d[$n.Name] = [string]$n.'#text' } }
    @{ id=$_.Id; recordId=$_.RecordId; time=$_.TimeCreated.ToUniversalTime().ToString('o'); data=$d }
  })
} catch [System.UnauthorizedAccessException] { $out.ok = $false; $out.error = 'access_denied' }
  catch { if ($_.Exception.Message -match 'No events were found') { $out.ok = $true } elseif ($_.Exception.Message -match 'unauthorized|access is denied|not have permission') { $out.ok = $false; $out.error = 'access_denied' } else { $out.ok = $false; $out.error = $_.Exception.Message } }
[pscustomobject]$out | ConvertTo-Json -Compress -Depth 6
`;

type RawEvent = { id: number; recordId: number; time: string; data: Record<string, string> };
type ReadResult = { channel: string; ok: boolean; error: string | null; newest: number | null; events: RawEvent[] | RawEvent | null };
type Bookmarks = Record<string, { epoch: string; last: number }>;

const s200 = (v: string | undefined) => (v ? v.slice(0, 200) : null);

/** Map a Windows event to the versioned Saathi vocabulary with minimized facts. */
export function normalize(channel: string, ev: RawEvent): Omit<AgentEvent, 'logEpoch' | 'channel' | 'nativeEventId'> | null {
  const d = ev.data;
  const observedAt = new Date(ev.time).toISOString();
  switch (ev.id) {
    case 4625:
      return { type: 'auth.failed', observedAt, facts: { username: s200(d.TargetUserName), sid: s200(d.TargetUserSid), sourceAddress: d.IpAddress && d.IpAddress !== '-' ? s200(d.IpAddress) : null, logonType: Number(d.LogonType) || null, reason: s200(d.SubStatus ?? d.Status) } };
    case 4624: {
      const lt = Number(d.LogonType);
      // Interactive, network, unlock, remote interactive, cached — not service/batch noise.
      if (![2, 3, 7, 10, 11].includes(lt) || /^S-1-5-(18|19|20)$/.test(d.TargetUserSid ?? '') || (d.TargetUserName ?? '').endsWith('$')) return null;
      return { type: 'auth.succeeded', observedAt, facts: { username: s200(d.TargetUserName), sid: s200(d.TargetUserSid), logonType: lt, sourceAddress: d.IpAddress && d.IpAddress !== '-' ? s200(d.IpAddress) : null } };
    }
    case 4720:
      return { type: 'account.created', observedAt, facts: { username: s200(d.TargetUserName), sid: s200(d.TargetSid) } };
    case 4732:
      if (d.TargetSid !== 'S-1-5-32-544') return null;
      return { type: 'account.admin_added', observedAt, facts: { sid: s200(d.MemberSid), username: s200(d.MemberName) } };
    case 1006: {
      const capacity = Number(d.Capacity ?? 0);
      if (!capacity) return null; // removal / empty slot
      return { type: 'storage.attached', observedAt, facts: { label: s200([d.Manufacturer, d.Model].filter(Boolean).join(' ').trim() || 'Removable storage'), busType: Number(d.BusType) || null, capacityBytes: capacity } };
    }
    case 1116:
      return { type: 'malware.detected', observedAt, facts: { threatId: s200(d['Threat ID']), threatName: s200(d['Threat Name']), severity: s200(d['Severity Name']) } };
    case 1117:
      return { type: 'malware.remediated', observedAt, facts: { threatId: s200(d['Threat ID']), threatName: s200(d['Threat Name']), action: s200(d['Action Name']) } };
    case 5001:
      return { type: 'protection.disabled', observedAt, facts: { component: 'av', source: 'Defender event 5001' } };
    default:
      return null;
  }
}

export type CollectStatus = { channel: string; ok: boolean; error: string | null; read: number };

export class Collector {
  constructor(private store: StateStore) {}

  /** Returns events plus a commit() that persists bookmarks; call it only after spooling. */
  async collect(): Promise<{ events: AgentEvent[]; status: CollectStatus[]; commit: () => void }> {
    const bookmarks = this.store.read<Bookmarks>('bookmarks.json', {});
    const events: AgentEvent[] = [];
    const status: CollectStatus[] = [];
    for (const ch of CHANNELS) {
      const bm = bookmarks[ch.name] ?? { epoch: `e-${Date.now()}`, last: -1 };
      const first = bm.last < 0;
      const r = await runPs<ReadResult>(READ_SCRIPT, { SAATHI_CHANNEL: ch.name, SAATHI_SINCE: String(Math.max(0, bm.last)), SAATHI_IDS: ch.ids.join(',') }, 120_000);
      if (!r.ok || !r.value) {
        status.push({ channel: ch.name, ok: false, error: r.ok ? 'no output' : r.error, read: 0 });
        continue;
      }
      const v = r.value;
      if (!v.ok) {
        status.push({ channel: ch.name, ok: false, error: v.error, read: 0 });
        continue;
      }
      // Newest record below our bookmark means the log was cleared/recreated: new epoch.
      if (v.newest !== null && bm.last > 0 && v.newest < bm.last) {
        bm.epoch = `e-${Date.now()}`;
        bm.last = 0;
      }
      const list = v.events ? (Array.isArray(v.events) ? v.events : [v.events]) : [];
      // On first run start from "now" instead of importing years of history.
      if (first) {
        bm.last = v.newest ?? 0;
        bookmarks[ch.name] = bm;
        status.push({ channel: ch.name, ok: true, error: null, read: 0 });
        continue;
      }
      for (const ev of list) {
        const n = normalize(ch.name, ev);
        if (n) events.push({ ...n, logEpoch: bm.epoch, channel: ch.name, nativeEventId: String(ev.recordId) });
        bm.last = Math.max(bm.last, ev.recordId);
      }
      bookmarks[ch.name] = bm;
      status.push({ channel: ch.name, ok: true, error: null, read: list.length });
    }
    return { events, status, commit: () => this.store.write('bookmarks.json', bookmarks) };
  }
}
