import { z } from 'zod';
import { ActionType, Capability, ContainmentStatus, Decision, RuleId, Urgency } from './vocabulary';

/**
 * Template message: a reviewed i18n key plus structured parameters. Core warnings are
 * never free text generated afresh (build.md Ph10.5).
 */
export const Msg = z.object({
  key: z.string(),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
export type Msg = z.infer<typeof Msg>;
export const msg = (key: string, params: Record<string, string | number | boolean | null> = {}): Msg => ({ key, params });

// ---------------------------------------------------------------------------
// Snapshot: the known state the policy engine reasons over (build.md Ph07.1)
// ---------------------------------------------------------------------------

export const SnapshotSubject = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['active', 'offboarded']),
  sharedAccount: z.boolean(),
});
export const SnapshotSession = z.object({
  id: z.string(),
  subjectId: z.string(),
  integrationId: z.string(),
  label: z.string(),
  status: z.enum(['active', 'paused', 'revoked']),
  familiar: z.boolean(),
});
export const SnapshotGrant = z.object({
  subjectId: z.string(),
  integrationId: z.string(),
  capability: Capability,
});
export const SnapshotRestriction = z.object({
  id: z.string(),
  targetType: z.enum(['session', 'subject']),
  targetId: z.string(),
  kind: z.enum(['throttle', 'pause', 'disable_account']),
  ratePerMinute: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  source: z.enum(['auto_guard', 'action']),
});
export const SnapshotIntegration = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  canObserve: z.boolean(),
  canEnforce: z.boolean(),
  status: z.string(),
  lastEventAt: z.string().nullable(),
});
export const SnapshotDependency = z.object({
  id: z.string(),
  description: z.string(),
  kind: z.string(),
  confidence: z.enum(['high', 'medium', 'low', 'unknown']),
  subjectIds: z.array(z.string()),
  deviceIds: z.array(z.string()),
  declaredAt: z.string(),
});
export const SnapshotDevice = z.object({
  id: z.string(),
  name: z.string(),
  freshness: z.enum(['fresh', 'stale', 'offline', 'never']),
  lastSeenAt: z.string().nullable(),
  supportedActions: z.array(z.string()),
  simulated: z.boolean(),
  posture: z.record(z.string(), z.unknown()).nullable(),
  accounts: z.array(z.object({ sid: z.string(), username: z.string(), isAdmin: z.boolean(), enabled: z.boolean(), protected: z.boolean() })),
});

export const Snapshot = z.object({
  orgId: z.string(),
  observedAt: z.string(),
  policyVersion: z.number().int(),
  policy: z.object({
    autoThrottleEnabled: z.boolean(),
    throttleRatePerMinute: z.number().int(),
    throttleDurationMinutes: z.number().int(),
    burstThreshold: z.number().int(),
    burstWindowSeconds: z.number().int(),
    dailyLimit: z.number().int(),
  }),
  subjects: z.array(SnapshotSubject),
  sessions: z.array(SnapshotSession),
  grants: z.array(SnapshotGrant),
  restrictions: z.array(SnapshotRestriction),
  integrations: z.array(SnapshotIntegration),
  dependencies: z.array(SnapshotDependency),
  devices: z.array(SnapshotDevice),
});
export type Snapshot = z.infer<typeof Snapshot>;
export type SnapshotSession = z.infer<typeof SnapshotSession>;
export type SnapshotRestriction = z.infer<typeof SnapshotRestriction>;
export type SnapshotDevice = z.infer<typeof SnapshotDevice>;

export const AccessRequest = z.object({
  sessionId: z.string(),
  capability: Capability,
  at: z.string(),
});
export type AccessRequest = z.infer<typeof AccessRequest>;

export const AuthorizationResult = z.object({
  decision: Decision,
  reason: z.string(),
  policyVersion: z.number().int(),
  ratePerMinute: z.number().int().nullable(),
});
export type AuthorizationResult = z.infer<typeof AuthorizationResult>;

// ---------------------------------------------------------------------------
// Consequence preview (build.md Ph07.3)
// ---------------------------------------------------------------------------

export const Consequence = z.object({
  capability: z.string(),
  subjectId: z.string().nullable(),
  sessionId: z.string().nullable(),
  label: Msg,
  before: Decision.or(z.literal('unknown')),
  after: Decision.or(z.literal('unknown')),
  /** True when the state does not change (e.g. already limited). */
  unchanged: z.boolean().default(false),
});
export type Consequence = z.infer<typeof Consequence>;

export const RecoveryRequirement = z.object({
  step: Msg,
  approver: z.enum(['owner', 'approver', 'local_admin']),
});
export type RecoveryRequirement = z.infer<typeof RecoveryRequirement>;

export const Coverage = z.object({
  scope: z.array(z.string()),
  observedAt: z.string(),
  completeForScope: z.boolean(),
  gaps: z.array(Msg),
});
export type Coverage = z.infer<typeof Coverage>;

export const ActionParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
export type ActionParams = z.infer<typeof ActionParams>;

export const PreviewContent = z.object({
  actionType: ActionType,
  targetType: z.enum(['session', 'subject', 'device']),
  targetId: z.string(),
  targetLabel: Msg,
  params: ActionParams,
  title: Msg,
  stops: z.array(Consequence),
  limits: z.array(Consequence),
  keepsWorking: z.array(Consequence),
  unknown: z.array(Msg),
  cannotControl: z.array(Msg),
  undo: z.array(RecoveryRequirement),
  reversible: z.boolean(),
  objectiveMet: z.boolean(),
  supported: z.boolean(),
  unsupportedReason: Msg.nullable(),
  coverage: Coverage,
  /** Device previews are predictions from an observed snapshot, not guarantees. */
  predictionBasis: z.enum(['modeled_policy', 'observed_device_snapshot']),
});
export type PreviewContent = z.infer<typeof PreviewContent>;

export const ActionOption = z.object({
  actionType: ActionType,
  targetType: z.enum(['session', 'subject', 'device']),
  targetId: z.string(),
  params: ActionParams,
  recommended: z.boolean(),
  reason: Msg,
});
export type ActionOption = z.infer<typeof ActionOption>;

// ---------------------------------------------------------------------------
// Incident content
// ---------------------------------------------------------------------------

export const Finding = z.object({
  id: z.string(),
  ruleId: RuleId,
  ruleVersion: z.number().int(),
  status: z.enum(['open', 'restricted', 'resolved']),
  harmfulCapability: z.string(),
  target: z.object({ type: z.enum(['session', 'subject', 'device', 'org']), id: z.string() }),
  facts: z.array(Msg),
  boundaries: z.array(Msg),
});
export type Finding = z.infer<typeof Finding>;

export const ContainmentAssessment = z.object({
  status: ContainmentStatus,
  reasons: z.array(Msg),
  assessedAt: z.string(),
});
export type ContainmentAssessment = z.infer<typeof ContainmentAssessment>;

export const IncidentUrgency = Urgency;
