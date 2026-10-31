import { z } from 'zod';

// Canonical state vocabulary (build.md §3). Every layer imports these; never redefine
// state names in the UI, worker or agent.

export const ROLES = ['owner', 'approver', 'staff', 'auditor'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const INCIDENT_STATES = ['open', 'investigating', 'contained', 'recovering', 'recovered', 'dismissed'] as const;
export const IncidentState = z.enum(INCIDENT_STATES);
export type IncidentState = z.infer<typeof IncidentState>;

/** Allowed incident transitions. Closing never erases history. */
export const INCIDENT_TRANSITIONS: Record<IncidentState, readonly IncidentState[]> = {
  open: ['investigating', 'contained', 'dismissed'],
  investigating: ['contained', 'dismissed'],
  contained: ['recovering', 'investigating'],
  recovering: ['recovered', 'investigating'],
  recovered: ['investigating'],
  dismissed: [],
};

export const ACTION_STATES = ['requested', 'queued', 'executing', 'confirmed', 'partial', 'failed', 'unknown', 'expired', 'cancelled'] as const;
export const ActionState = z.enum(ACTION_STATES);
export type ActionState = z.infer<typeof ActionState>;

export const ACTION_TRANSITIONS: Record<ActionState, readonly ActionState[]> = {
  requested: ['queued', 'executing', 'confirmed', 'partial', 'failed', 'unknown', 'expired', 'cancelled'],
  queued: ['executing', 'expired', 'cancelled', 'failed'],
  executing: ['confirmed', 'partial', 'failed', 'unknown'],
  // unknown is resolved only by reconciliation, never by a blind rerun.
  unknown: ['confirmed', 'partial', 'failed'],
  confirmed: [],
  partial: [],
  failed: [],
  expired: [],
  cancelled: [],
};
export const TERMINAL_ACTION_STATES: readonly ActionState[] = ['confirmed', 'partial', 'failed', 'expired', 'cancelled'];

export function canTransitionAction(from: ActionState, to: ActionState): boolean {
  return ACTION_TRANSITIONS[from].includes(to);
}
export function canTransitionIncident(from: IncidentState, to: IncidentState): boolean {
  return INCIDENT_TRANSITIONS[from].includes(to);
}

export const EVIDENCE_STATES = ['pending_signature', 'signed', 'signing_failed'] as const;
export const EvidenceState = z.enum(EVIDENCE_STATES);
export type EvidenceState = z.infer<typeof EvidenceState>;

export const ANCHOR_STATES = ['not_requested', 'pending', 'submitted', 'confirmed', 'retrying', 'failed', 'invalid'] as const;
export const AnchorState = z.enum(ANCHOR_STATES);
export type AnchorState = z.infer<typeof AnchorState>;

export const CONTAINMENT_STATUSES = ['not_contained', 'partially_contained', 'contained', 'unknown'] as const;
export const ContainmentStatus = z.enum(CONTAINMENT_STATUSES);
export type ContainmentStatus = z.infer<typeof ContainmentStatus>;

export const URGENCIES = ['needs_attention', 'review_today', 'weekly'] as const;
export const Urgency = z.enum(URGENCIES);
export type Urgency = z.infer<typeof Urgency>;

export const DECISIONS = ['allow', 'deny', 'throttle'] as const;
export const Decision = z.enum(DECISIONS);
export type Decision = z.infer<typeof Decision>;

export const EVENT_TYPES = [
  'auth.failed',
  'auth.succeeded',
  'account.created',
  'account.admin_added',
  'storage.attached',
  'malware.detected',
  'malware.remediated',
  'protection.disabled',
  'records.download',
  'decoy.access',
  'message.reported',
] as const;
export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const DISPOSITIONS = ['correlated', 'aggregated', 'digest', 'informational', 'rejected'] as const;
export const Disposition = z.enum(DISPOSITIONS);
export type Disposition = z.infer<typeof Disposition>;

export const SCAM_VERDICTS = ['known_malicious', 'suspicious', 'no_known_indicators', 'insufficient_information'] as const;
export const ScamVerdict = z.enum(SCAM_VERDICTS);
export type ScamVerdict = z.infer<typeof ScamVerdict>;

export const CHECK_RESULTS = ['pass', 'fail', 'unknown'] as const;
export const CheckResult = z.enum(CHECK_RESULTS);
export type CheckResult = z.infer<typeof CheckResult>;

export const CAPABILITIES = ['records.view', 'records.download', 'device.interactive_use', 'device.removable_storage', 'device.local_login', 'device.network_inbound'] as const;
export const Capability = z.enum(CAPABILITIES);
export type Capability = z.infer<typeof Capability>;

export const RECORDS_ACTIONS = ['records.pause_session', 'records.disable_account', 'records.offboard_subject'] as const;
export const DEVICE_ACTIONS = [
  'device.lock_session',
  'device.disable_local_account',
  'device.restrict_removable_storage',
  'device.enable_firewall',
  'device.set_lockout_policy',
  'device.block_source_ip',
  'device.enable_av',
  'device.request_av_scan',
  'device.undo_change',
] as const;
export const ACTION_TYPES = [...RECORDS_ACTIONS, ...DEVICE_ACTIONS] as const;
export const ActionType = z.enum(ACTION_TYPES);
export type ActionType = z.infer<typeof ActionType>;
export type RecordsActionType = (typeof RECORDS_ACTIONS)[number];
export type DeviceActionType = (typeof DEVICE_ACTIONS)[number];
export function isDeviceAction(t: ActionType): t is DeviceActionType {
  return (DEVICE_ACTIONS as readonly string[]).includes(t);
}

export const ORG_TYPES = ['clinic', 'retail', 'education', 'ngo', 'service', 'office', 'other'] as const;
export const OrgType = z.enum(ORG_TYPES);
export type OrgType = z.infer<typeof OrgType>;

export const VOCABULARIES = ['generic', 'clinic', 'shop', 'school', 'ngo'] as const;
export const Vocabulary = z.enum(VOCABULARIES);
export type Vocabulary = z.infer<typeof Vocabulary>;

export const LOCALES = ['en', 'kn', 'hi'] as const;
export const Locale = z.enum(LOCALES);
export type Locale = z.infer<typeof Locale>;

export const INTEGRATION_KINDS = ['records_reference', 'device_agent', 'read_only', 'unconnected'] as const;
export const IntegrationKind = z.enum(INTEGRATION_KINDS);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

export const INTEGRATION_STATUSES = ['connected', 'read_only', 'stale', 'failed', 'unconnected', 'revoked'] as const;
export const IntegrationStatus = z.enum(INTEGRATION_STATUSES);
export type IntegrationStatus = z.infer<typeof IntegrationStatus>;

export const DEVICE_STATUSES = ['waiting', 'connected', 'retired', 'revoked'] as const;
export const DeviceStatus = z.enum(DEVICE_STATUSES);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const FRESHNESS = ['fresh', 'stale', 'offline', 'never'] as const;
export type Freshness = (typeof FRESHNESS)[number];

export const RULE_IDS = [
  'password_guessing',
  'possible_compromise',
  'removable_media',
  'bulk_records_access',
  'former_staff_access',
  'decoy_record',
  'unresolved_malware',
  'protection_disabled',
  'repeated_scam',
] as const;
export const RuleId = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleId>;

export const FAMILIES = ['records_access', 'device_security', 'malware', 'protection', 'scam_campaign'] as const;
export type Family = (typeof FAMILIES)[number];

export const RECOVERY_STEP_KINDS = ['attested', 'verified'] as const;
export type RecoveryStepKind = (typeof RECOVERY_STEP_KINDS)[number];
