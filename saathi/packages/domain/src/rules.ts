import { msg, type Disposition, type EventType, type Family, type Msg, type RuleId, type Urgency } from '@saathi/contracts';

// Normalization, filtering and correlation (build.md Ph06). Thresholds are starting
// presets, versioned so changes are traceable; they are not validated detection rates.

export const RULE_VERSIONS: Record<RuleId, number> = {
  password_guessing: 1,
  possible_compromise: 1,
  removable_media: 1,
  bulk_records_access: 1,
  former_staff_access: 1,
  decoy_record: 1,
  unresolved_malware: 1,
  protection_disabled: 1,
  repeated_scam: 1,
};

export const PRESETS = {
  passwordGuessing: { failures: 5, windowSeconds: 300 },
  possibleCompromise: { windowSeconds: 900 },
  removableMedia: { nearFailuresSeconds: 1800 },
  unresolvedMalware: { graceSeconds: 120 },
  repeatedScam: { reporters: 3, windowHours: 24 },
  expectedEffectWindowSeconds: 600,
} as const;

export const RULE_FAMILY: Record<RuleId, Family> = {
  password_guessing: 'device_security',
  possible_compromise: 'device_security',
  removable_media: 'device_security',
  bulk_records_access: 'records_access',
  former_staff_access: 'records_access',
  decoy_record: 'records_access',
  unresolved_malware: 'malware',
  protection_disabled: 'protection',
  repeated_scam: 'scam_campaign',
};

export type Facts = Record<string, string | number | boolean | null>;

export type NormalizedEvent = {
  id: string;
  type: EventType;
  observedAt: string;
  sourceType: 'device' | 'gateway' | 'integration' | 'staff';
  deviceId: string | null;
  integrationId: string | null;
  facts: Facts;
  isReplay: boolean;
};

export type OrgCalendar = { timezone: string; workStart: string; workEnd: string; workDays: number[] };

export type ExpectedEffect = { actionId: string; deviceId: string; type: EventType; match: Facts; until: string };

export type CorrelationContext = {
  calendar: OrgCalendar;
  /** Earlier stored events from the same device/session within the correlation window. */
  recent: NormalizedEvent[];
  expectedEffects: ExpectedEffect[];
  deviceName?: string | null;
};

export type FindingDraft = {
  ruleId: RuleId;
  ruleVersion: number;
  family: Family;
  correlationKey: string;
  urgency: Urgency;
  harmfulCapability: string;
  target: { type: 'session' | 'subject' | 'device' | 'org'; id: string };
  title: Msg;
  facts: Msg[];
  uncertain: Msg[];
  boundaries: Msg[];
  /** Policy already denied the access (e.g. former staff) — restriction observed. */
  initialStatus: 'open' | 'restricted';
  subject: { staffId?: string | null; sessionId?: string | null; deviceId?: string | null };
};

export type RuleOutcome = {
  disposition: Disposition;
  reason: string;
  signal?: { type: string; family: Family; subjectKey: string; windowSeconds: number };
  finding?: FindingDraft;
  schedule?: { type: 'malware.check'; runAt: string; payload: Record<string, string> };
};

/** Whether `at` falls inside organization working hours (in its timezone). */
export function isWithinWorkingHours(at: string, cal: OrgCalendar): boolean {
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: cal.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.find((p) => p.type === 'weekday')!.value);
  const hm = `${parts.find((p) => p.type === 'hour')!.value}:${parts.find((p) => p.type === 'minute')!.value}`;
  return cal.workDays.includes(wd) && hm >= cal.workStart && hm < cal.workEnd;
}

function within(a: string, b: string, seconds: number) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) <= seconds * 1000;
}

function matchesExpected(e: NormalizedEvent, ctx: CorrelationContext): ExpectedEffect | null {
  for (const x of ctx.expectedEffects) {
    if (x.deviceId !== e.deviceId || x.type !== e.type) continue;
    if (new Date(e.observedAt).getTime() > new Date(x.until).getTime()) continue;
    if (Object.entries(x.match).every(([k, v]) => e.facts[k] === v)) return x;
  }
  return null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function evaluateEvent(e: NormalizedEvent, ctx: CorrelationContext): RuleOutcome {
  // Narrow suppression of expected effects of a specific Saathi command (Ph06.6).
  const expected = matchesExpected(e, ctx);
  if (expected) return { disposition: 'informational', reason: `expected_effect_of_action:${expected.actionId}` };

  const device = e.deviceId ? `device:${e.deviceId}` : '';
  const deviceName = ctx.deviceName ?? str(e.facts.deviceName);
  switch (e.type) {
    case 'records.download': {
      const sessionId = str(e.facts.sessionId);
      if (e.facts.reason === 'subject_offboarded') {
        return {
          disposition: 'correlated',
          reason: 'former_staff_request_denied',
          finding: {
            ruleId: 'former_staff_access',
            ruleVersion: RULE_VERSIONS.former_staff_access,
            family: 'records_access',
            correlationKey: `subject:${str(e.facts.staffId)}`,
            urgency: 'review_today',
            harmfulCapability: 'records.download',
            target: { type: 'subject', id: str(e.facts.staffId) },
            title: msg('incident.title.former_staff'),
            facts: [msg('fact.former_staff_attempt', { person: str(e.facts.staffLabel), session: str(e.facts.sessionLabel), at: e.observedAt })],
            uncertain: [msg('uncertain.former_staff_who')],
            boundaries: [msg('boundary.unconnected_accounts_need_offboarding')],
            initialStatus: 'restricted',
            subject: { staffId: str(e.facts.staffId), sessionId },
          },
        };
      }
      if (e.facts.burstTriggered === true) {
        const facts: Msg[] = [
          msg('fact.records_rate', { count: Number(e.facts.attemptsInWindow ?? 0), seconds: Number(e.facts.windowSeconds ?? 120), session: str(e.facts.sessionLabel) }),
        ];
        if (e.facts.familiar === false) facts.push(msg('fact.unfamiliar_session', { session: str(e.facts.sessionLabel) }));
        if (e.facts.throttleApplied === true) facts.push(msg('fact.throttle_applied', { until: str(e.facts.throttleUntil) }));
        else if (e.facts.autoThrottleEnabled === false) facts.push(msg('fact.no_auto_throttle_consent'));
        return {
          disposition: 'correlated',
          reason: 'burst_threshold_breached',
          signal: { type: 'records.download', family: 'records_access', subjectKey: `session:${sessionId}`, windowSeconds: Number(e.facts.windowSeconds ?? 120) },
          finding: {
            ruleId: 'bulk_records_access',
            ruleVersion: RULE_VERSIONS.bulk_records_access,
            family: 'records_access',
            correlationKey: `subject:${str(e.facts.staffId)}`,
            urgency: 'needs_attention',
            harmfulCapability: 'records.download',
            target: { type: 'session', id: sessionId },
            title: msg('incident.title.bulk_records'),
            facts,
            uncertain: [msg('uncertain.authorized_export'), msg('uncertain.who_used_session')],
            boundaries: [msg('boundary.already_downloaded'), msg('boundary.slow_extraction')],
            initialStatus: 'open',
            subject: { staffId: str(e.facts.staffId), sessionId },
          },
        };
      }
      return {
        disposition: 'aggregated',
        reason: e.facts.admitted === false ? `request_${str(e.facts.reason)}` : 'counted_in_session_rate',
        signal: { type: 'records.download', family: 'records_access', subjectKey: `session:${sessionId}`, windowSeconds: 120 },
      };
    }
    case 'decoy.access': {
      const sessionId = str(e.facts.sessionId);
      return {
        disposition: 'correlated',
        reason: 'decoy_record_accessed',
        finding: {
          ruleId: 'decoy_record',
          ruleVersion: RULE_VERSIONS.decoy_record,
          family: 'records_access',
          correlationKey: `subject:${str(e.facts.staffId)}`,
          urgency: 'review_today',
          harmfulCapability: 'records.view',
          target: { type: 'session', id: sessionId },
          title: msg('incident.title.decoy'),
          facts: [msg('fact.decoy_opened', { session: str(e.facts.sessionLabel) })],
          uncertain: [msg('uncertain.decoy_not_intent')],
          boundaries: [],
          initialStatus: 'open',
          subject: { staffId: str(e.facts.staffId), sessionId },
        },
      };
    }
    case 'auth.failed': {
      const windowStart = new Date(new Date(e.observedAt).getTime() - PRESETS.passwordGuessing.windowSeconds * 1000).toISOString();
      const failures = [...ctx.recent, e].filter((x) => x.type === 'auth.failed' && x.observedAt >= windowStart && x.observedAt <= e.observedAt);
      const unique = new Set(failures.map((x) => x.id)).size;
      const signal = { type: 'auth.failed', family: 'device_security' as Family, subjectKey: device, windowSeconds: PRESETS.passwordGuessing.windowSeconds };
      if (unique >= PRESETS.passwordGuessing.failures) {
        const sources = [...new Set(failures.map((x) => str(x.facts.sourceAddress)).filter(Boolean))];
        const accounts = [...new Set(failures.map((x) => str(x.facts.username)).filter(Boolean))];
        return {
          disposition: 'correlated',
          reason: 'failure_threshold_breached',
          signal,
          finding: {
            ruleId: 'password_guessing',
            ruleVersion: RULE_VERSIONS.password_guessing,
            family: 'device_security',
            correlationKey: device,
            urgency: 'needs_attention',
            harmfulCapability: 'device.local_login',
            target: { type: 'device', id: e.deviceId! },
            title: msg('incident.title.device_security'),
            facts: [
              msg('fact.repeated_wrong_passwords', { count: unique, minutes: PRESETS.passwordGuessing.windowSeconds / 60, device: deviceName, accounts: accounts.join(', ') }),
              ...(sources.length === 1 ? [msg('fact.single_source', { sourceAddress: sources[0] })] : []),
            ],
            uncertain: [msg('uncertain.forgotten_password')],
            boundaries: [msg('boundary.lock_not_bruteforce')],
            initialStatus: 'open',
            subject: { deviceId: e.deviceId },
          },
        };
      }
      return { disposition: 'aggregated', reason: 'failure_counted', signal };
    }
    case 'auth.succeeded':
    case 'account.created':
    case 'account.admin_added': {
      const windowStart = new Date(new Date(e.observedAt).getTime() - PRESETS.possibleCompromise.windowSeconds * 1000).toISOString();
      const priorFailures = ctx.recent.filter((x) => x.type === 'auth.failed' && x.observedAt >= windowStart && x.observedAt <= e.observedAt).length;
      if (priorFailures >= PRESETS.passwordGuessing.failures && (e.type !== 'auth.succeeded' || !e.facts.username || ctx.recent.some((x) => x.type === 'auth.failed' && x.facts.username === e.facts.username))) {
        return {
          disposition: 'correlated',
          reason: 'success_or_admin_after_failures',
          finding: {
            ruleId: 'possible_compromise',
            ruleVersion: RULE_VERSIONS.possible_compromise,
            family: 'device_security',
            correlationKey: device,
            urgency: 'needs_attention',
            harmfulCapability: 'device.local_login',
            target: { type: 'device', id: e.deviceId! },
            title: msg('incident.title.device_security'),
            facts: [msg(`fact.${e.type.replace('.', '_')}_after_failures`, { username: str(e.facts.username), sid: str(e.facts.sid), failures: priorFailures, device: deviceName })],
            uncertain: [msg('uncertain.legitimate_login_after_mistakes')],
            boundaries: [msg('boundary.no_automatic_account_disable')],
            initialStatus: 'open',
            subject: { deviceId: e.deviceId },
          },
        };
      }
      return { disposition: e.type === 'auth.succeeded' ? 'informational' : 'digest', reason: e.type === 'auth.succeeded' ? 'ordinary_login' : 'account_change_without_failures' };
    }
    case 'storage.attached': {
      const afterHours = !isWithinWorkingHours(e.observedAt, ctx.calendar);
      const nearFailures = ctx.recent.some((x) => x.type === 'auth.failed' && within(x.observedAt, e.observedAt, PRESETS.removableMedia.nearFailuresSeconds));
      if (afterHours || nearFailures) {
        return {
          disposition: 'correlated',
          reason: afterHours ? 'storage_after_hours' : 'storage_near_failed_logins',
          finding: {
            ruleId: 'removable_media',
            ruleVersion: RULE_VERSIONS.removable_media,
            family: 'device_security',
            correlationKey: device,
            urgency: 'needs_attention',
            harmfulCapability: 'device.removable_storage',
            target: { type: 'device', id: e.deviceId! },
            title: msg('incident.title.device_security'),
            facts: [msg(afterHours ? 'fact.storage_after_hours' : 'fact.storage_near_failures', { device: deviceName, label: str(e.facts.label), at: e.observedAt })],
            uncertain: [msg('uncertain.storage_owner')],
            boundaries: [msg('boundary.already_mounted')],
            initialStatus: 'open',
            subject: { deviceId: e.deviceId },
          },
        };
      }
      // Working-hours baseline lowers priority for storage only (Ph06.4).
      return { disposition: 'digest', reason: 'storage_during_working_hours' };
    }
    case 'malware.detected': {
      const runAt = new Date(new Date(e.observedAt).getTime() + PRESETS.unresolvedMalware.graceSeconds * 1000).toISOString();
      return {
        disposition: 'correlated',
        reason: 'awaiting_remediation_check',
        schedule: { type: 'malware.check', runAt, payload: { eventId: e.id, threatId: str(e.facts.threatId), deviceId: e.deviceId ?? '' } },
      };
    }
    case 'malware.remediated':
      return { disposition: 'digest', reason: 'remediated_detection' };
    case 'protection.disabled':
      return {
        disposition: 'correlated',
        reason: 'protection_reported_disabled',
        finding: {
          ruleId: 'protection_disabled',
          ruleVersion: RULE_VERSIONS.protection_disabled,
          family: 'protection',
          correlationKey: `${device}:${str(e.facts.component)}`,
          urgency: 'needs_attention',
          harmfulCapability: `device.${str(e.facts.component) || 'protection'}`,
          target: { type: 'device', id: e.deviceId! },
          title: msg('incident.title.protection'),
          facts: [msg('fact.protection_disabled', { component: str(e.facts.component), device: deviceName })],
          uncertain: [msg('uncertain.protection_reason')],
          boundaries: [msg('boundary.managed_policy')],
          initialStatus: 'open',
          subject: { deviceId: e.deviceId },
        },
      };
    case 'message.reported':
      return { disposition: 'aggregated', reason: 'counted_toward_campaign' };
    default:
      return { disposition: 'rejected', reason: 'unknown_event_type' };
  }
}

/** Unresolved malware: detection without matching remediation after the grace period. */
export function evaluateMalwareCheck(detection: NormalizedEvent, laterEvents: NormalizedEvent[], deviceName: string): FindingDraft | null {
  const remediated = laterEvents.some((x) => x.type === 'malware.remediated' && x.deviceId === detection.deviceId && (!detection.facts.threatId || x.facts.threatId === detection.facts.threatId));
  if (remediated) return null;
  return {
    ruleId: 'unresolved_malware',
    ruleVersion: RULE_VERSIONS.unresolved_malware,
    family: 'malware',
    correlationKey: `device:${detection.deviceId}`,
    urgency: 'needs_attention',
    harmfulCapability: 'device.malware',
    target: { type: 'device', id: detection.deviceId! },
    title: msg('incident.title.malware'),
    facts: [msg('fact.malware_unresolved', { threat: str(detection.facts.threatName), device: deviceName, minutes: PRESETS.unresolvedMalware.graceSeconds / 60 })],
    uncertain: [msg('uncertain.malware_active')],
    boundaries: [msg('boundary.scan_not_eradication')],
    initialStatus: 'open',
    subject: { deviceId: detection.deviceId },
  };
}

/** Normalize an agent/integration event type string to the versioned vocabulary. */
export const NORMALIZATION_VERSION = 1;
