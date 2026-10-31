import { msg, type Msg } from '@saathi/contracts';

// Plain-language gloss for each evidence entry type, for people who are not going to read
// a JSON payload. Only safe, already-displayed-elsewhere fields are surfaced as params;
// nothing here echoes the raw payload, a hash, or a signature.

type P = Record<string, unknown>;
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback);

export function summarizeEntry(type: string, payload: unknown): Msg {
  const p = (typeof payload === 'object' && payload !== null ? payload : {}) as P;
  switch (type) {
    case 'organization.created':
      return msg('evidence.entry.organization_created');
    case 'organization.updated':
      return msg('evidence.entry.organization_updated');
    case 'policy.changed':
      return msg('evidence.entry.policy_changed');
    case 'member.invited':
      return msg('evidence.entry.member_invited');
    case 'member.joined':
      return msg('evidence.entry.member_joined');
    case 'member.changed':
      return msg('evidence.entry.member_changed');
    case 'dependency.declared':
      return msg('evidence.entry.dependency_declared');
    case 'integration.added':
      return msg('evidence.entry.integration_added');
    case 'integration.changed':
      return msg('evidence.entry.integration_changed');
    case 'device.enrollment_code_created':
      return msg('evidence.entry.device_enrollment_code_created', { device: str(p.deviceName, 'a device') });
    case 'device.enrolled':
      return msg('evidence.entry.device_enrolled', { device: str(p.hostname, 'a device') });
    case 'device.events_dropped':
      return msg('evidence.entry.device_events_dropped', { count: num(p.dropped) });
    case 'device.retired':
      return msg('evidence.entry.device_retired');
    case 'device.secret_rotated':
      return msg('evidence.entry.device_secret_rotated');
    case 'command.queued':
      return msg('evidence.entry.command_queued');
    case 'command.delivered':
      return msg('evidence.entry.command_delivered');
    case 'command.expired':
      return msg('evidence.entry.command_expired');
    case 'command.result_missing':
      return msg('evidence.entry.command_result_missing');
    case 'command.contradictory_result':
      return msg('evidence.entry.command_contradictory_result');
    case 'preview.created':
      return msg('evidence.entry.preview_created');
    case 'approval.rejected':
      return msg('evidence.entry.approval_rejected');
    case 'action.approved':
      return msg('evidence.entry.action_approved');
    case 'action.outcome_observed':
      return msg('evidence.entry.action_outcome_observed');
    case 'incident.opened':
      return msg('evidence.entry.incident_opened');
    case 'incident.finding_added':
      return msg('evidence.entry.incident_finding_added');
    case 'incident.state_changed':
      return msg('evidence.entry.incident_state_changed');
    case 'incident.dismissed':
      return msg('evidence.entry.incident_dismissed');
    case 'incident.decision_recorded':
      return msg('evidence.entry.incident_decision_recorded');
    case 'auto_guard.throttle_applied':
      return msg('evidence.entry.auto_guard_throttle_applied');
    case 'auto_guard.throttle_expired':
      return msg('evidence.entry.auto_guard_throttle_expired');
    case 'access.denied':
      return msg('evidence.entry.access_denied');
    case 'records.session_created':
      return msg('evidence.entry.records_session_created');
    case 'evidence.exported':
      return msg('evidence.entry.evidence_exported');
    case 'report.requested':
      return msg('evidence.entry.report_requested');
    case 'report.generated':
      return msg('evidence.entry.report_generated');
    case 'recovery.started':
      return msg('evidence.entry.recovery_started');
    case 'recovery.step':
      return msg('evidence.entry.recovery_step');
    case 'scam_check.assessed':
      return msg('evidence.entry.scam_check_assessed');
    case 'scam_check.reported':
      return msg('evidence.entry.scam_check_reported');
    case 'campaign.warning_sent':
      return msg('evidence.entry.campaign_warning_sent', { count: Array.isArray(p.recipients) ? p.recipients.length : num(p.recipients) });
    case 'telegram.linked':
      return msg('evidence.entry.telegram_linked');
    case 'telegram.unlinked':
      return msg('evidence.entry.telegram_unlinked');
    case 'demo.replay_started':
      return msg('evidence.entry.demo_replay_started');
    case 'demo.repair_verified':
      return msg('evidence.entry.demo_repair_verified');
    default:
      return msg('evidence.entry.generic');
  }
}
