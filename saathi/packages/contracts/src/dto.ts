import type { ActionOption, ContainmentAssessment, Finding, Msg, PreviewContent } from './decision';
import type {
  ActionState,
  ActionType,
  AnchorState,
  CheckResult,
  EvidenceState,
  Freshness,
  IncidentState,
  Locale,
  OrgType,
  Role,
  ScamVerdict,
  Urgency,
  Vocabulary,
} from './vocabulary';

// Minimal permission-specific DTOs returned by the DAL and API. UI components consume
// only these; they never receive raw rows, token hashes or secrets.

export type ActorDTO = {
  userId: string;
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  role: Role;
  locale: Locale;
  vocabulary: Vocabulary;
  orgType: OrgType;
  timezone: string;
  isDemo: boolean;
  setupComplete: boolean;
  memberships: { orgId: string; orgName: string; role: Role }[];
};

export type CoverageSummaryDTO = {
  devices: { total: number; fresh: number; stale: number; offline: number; waiting: number; simulated: number };
  applications: { enforceable: number; readOnly: number; unconnected: number; failed: number };
  unknownDependencies: number;
  incompleteChecks: number;
  lastObservationAt: string | null;
  hasAnySource: boolean;
};

export type RestrictionDTO = {
  id: string;
  kind: 'throttle' | 'pause' | 'disable_account';
  targetType: 'session' | 'subject';
  targetLabel: string;
  ratePerMinute: number | null;
  startsAt: string;
  expiresAt: string | null;
  source: 'auto_guard' | 'action';
  incidentId: string | null;
};

export type IncidentCardDTO = {
  id: string;
  title: Msg;
  state: IncidentState;
  urgency: Urgency;
  family: string;
  source: Msg;
  observedAt: string;
  updatedAt: string;
  nextStep: Msg;
  containment: ContainmentAssessment['status'];
  findingCount: number;
  isReplay: boolean;
  hasActiveLimit: boolean;
};

export type TimelineEntryDTO = {
  at: string;
  kind: string;
  text: Msg;
  actionId?: string | null;
  evidenceState?: EvidenceState;
};

export type IncidentDetailDTO = IncidentCardDTO & {
  facts: Msg[];
  uncertain: Msg[];
  boundaries: Msg[];
  findings: Finding[];
  scope: { sources: Msg[]; observedAt: string; excluded: Msg[]; freshness: Freshness };
  containmentAssessment: ContainmentAssessment;
  activeRestrictions: RestrictionDTO[];
  options: ActionOption[];
  noSupportedOption: Msg | null;
  actions: ActionSummaryDTO[];
  timeline: TimelineEntryDTO[];
  recoveryCaseId: string | null;
  dismissedReason: string | null;
  permissions: { canPreview: boolean; canDismiss: boolean; canRecover: boolean; canExport: boolean; canExplain: boolean };
  reportId: string | null;
};

export type PreviewDTO = {
  id: string;
  incidentId: string | null;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'consumed' | 'stale' | 'expired';
  observedAt: string;
  content: PreviewContent;
  actionId: string | null;
  canApprove: boolean;
  approveBlockedReason: Msg | null;
  alternatives: ActionOption[];
};

export type ProbeDTO = {
  kind: string;
  label: Msg;
  expected: string;
  observed: string;
  result: CheckResult;
  checkedAt: string;
};

export type ActionSummaryDTO = {
  id: string;
  actionType: ActionType;
  title: Msg;
  state: ActionState;
  createdAt: string;
  updatedAt: string;
};

export type ActionDetailDTO = ActionSummaryDTO & {
  incidentId: string | null;
  previewId: string;
  targetLabel: Msg;
  outcome: Msg;
  probes: ProbeDTO[];
  boundaries: Msg[];
  remainingFindings: Finding[];
  containment: ContainmentAssessment | null;
  device: { id: string; name: string; freshness: Freshness; lastSeenAt: string | null; simulated: boolean } | null;
  command: { status: string; issuedAt: string | null; expiresAt: string | null; deliveredAt: string | null } | null;
  nextSteps: ('review_next_step' | 'return_to_incident' | 'check_status' | 'start_recovery' | 'fresh_preview')[];
  evidenceState: EvidenceState | 'none';
};

export type DeviceCardDTO = {
  id: string;
  name: string;
  hostname: string | null;
  status: string;
  freshness: Freshness;
  lastSeenAt: string | null;
  simulated: boolean;
  supportedActionCount: number;
  incompleteChecks: number;
  healthEarned: number | null;
};

export type DeviceDetailDTO = DeviceCardDTO & {
  osVersion: string | null;
  agentVersion: string | null;
  capabilities: { action: string; supported: boolean; reason: string | null }[];
  prerequisites: { key: string; met: boolean; detail: string | null }[];
  posture: { key: string; result: CheckResult; value: string | null; source: string; observedAt: string | null; stale: boolean }[];
  accounts: { sid: string; username: string; isAdmin: boolean; enabled: boolean; protected: boolean; staffLabel: string | null }[];
  recentObservations: { type: string; observedAt: string; receivedAt: string; disposition: string | null }[];
  actions: ActionSummaryDTO[];
  incidents: IncidentCardDTO[];
  spoolDepth: number;
  droppedEvents: number;
  interactiveSession: { present: boolean; locked: boolean | null; helperConnected: boolean } | null;
  changes: { id: string; actionType: ActionType; status: string; createdAt: string; actionId: string }[];
};

export type PersonCardDTO = {
  id: string;
  name: string;
  status: 'active' | 'offboarded';
  sharedAccount: boolean;
  activeSessions: number;
  restrictedSessions: number;
};

export type SessionDTO = {
  id: string;
  label: string;
  integrationName: string;
  status: 'active' | 'paused' | 'revoked';
  familiar: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  restrictions: RestrictionDTO[];
};

export type PersonDetailDTO = PersonCardDTO & {
  sessions: SessionDTO[];
  grants: { integrationName: string; capability: string }[];
  deviceAccounts: { deviceName: string; username: string; isAdmin: boolean }[];
  dependencies: { id: string; description: string; confidence: string; declaredAt: string }[];
  incidents: IncidentCardDTO[];
};

export type OverviewDTO = {
  needsAttention: IncidentCardDTO[];
  needsAttentionTotal: number;
  reviewToday: IncidentCardDTO[];
  reviewTodayTotal: number;
  recentlyHandled: (ActionSummaryDTO & { incidentId: string | null; outcome: Msg })[];
  temporaryLimits: RestrictionDTO[];
  coverage: CoverageSummaryDTO;
  health: { earned: number | null; unknownPoints: number; devicesCounted: number } | null;
  funnel: { since: string; rawEvents: number; dispositions: Record<string, number>; incidents: number; replayIncluded: boolean };
  pendingRecovery: number;
  notificationFailures: number;
  refreshedAt: string;
};

export type HealthCheckDTO = {
  key: string;
  weight: number;
  earned: number;
  unknownPoints: number;
  result: CheckResult;
  devices: { deviceId: string; deviceName: string; result: CheckResult; value: string | null; observedAt: string | null; stale: boolean; fixAction: ActionType | null; guidance: Msg | null }[];
};

export type HealthDTO = {
  weightsVersion: number;
  earned: number | null;
  unknownPoints: number;
  checks: HealthCheckDTO[];
  devicesCounted: number;
  devicesExcluded: { deviceId: string; name: string; reason: Msg }[];
  computedAt: string;
};

export type ScamCheckDTO = {
  id: string;
  createdAt: string;
  verdict: ScamVerdict;
  reasons: Msg[];
  uncertainty: Msg[];
  nextSteps: Msg[];
  domains: { display: string; ascii: string; flags: string[] }[];
  missingChecks: Msg[];
  aiExplanation: string | null;
  aiStatus: 'not_requested' | 'pending' | 'used' | 'unavailable' | 'failed';
  inputKind: 'text' | 'image';
  textPreview: string | null;
  reported: boolean;
  campaignId: string | null;
  isOwn: boolean;
};

export type CampaignDTO = {
  id: string;
  status: 'open' | 'warned' | 'dismissed';
  reporterCount: number;
  firstAt: string;
  lastAt: string;
  domains: string[];
  verdict: ScamVerdict;
  warnedAt: string | null;
  recipients: { userId: string; name: string; status: string }[];
  candidates: { userId: string; name: string; role: string }[];
};

export type CheckpointDTO = {
  id: string;
  seq: number;
  headHash: string;
  createdAt: string;
  keyId: string;
  signatureState: EvidenceState;
  anchor: AnchorStatusDTO;
  pendingIntents: number;
};

export type AnchorStatusDTO = {
  state: AnchorState;
  method: string | null;
  checkedAt: string | null;
  bitcoinHeight: number | null;
  blockHash: string | null;
  calendars: string[];
  attempts: number;
  lastError: string | null;
  isSample: boolean;
};

export type ReportDTO = {
  id: string;
  kind: 'incident' | 'weekly';
  title: Msg;
  status: 'queued' | 'ready' | 'failed';
  createdAt: string;
  incidentId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  integrityState: EvidenceState | 'none';
  anchorState: AnchorState;
};

export type IntegrationDTO = {
  id: string;
  name: string;
  kind: string;
  status: string;
  canObserve: boolean;
  canEnforce: boolean;
  lastEventAt: string | null;
  freshness: Freshness;
  isReference: boolean;
  capabilities: Msg[];
  limits: Msg[];
};

export type MemberDTO = {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'revoked';
  isSelf: boolean;
  telegramLinked: boolean;
};

export type TelegramLinkDTO = {
  code: string;
  expiresAt: string;
  /** Tap-to-open link that pre-fills /start <code> in the Telegram app tied to the organiser's phone number; null when TELEGRAM_BOT_USERNAME is not configured. */
  deepLink: string | null;
};
