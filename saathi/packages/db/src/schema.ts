import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Logical model from build.md §4. Every tenant table carries org_id, is covered by RLS
// (see migrations/0001_rls.sql) and is indexed on tenant + time/status.

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const id = () => uuid('id').primaryKey().defaultRandom();
const orgId = () => uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });
const created = () => ts('created_at').notNull().defaultNow();

// ------------------------------------------------------------------ Better Auth (library shape)

export const authUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
});

export const authSession = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const authAccount = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamp('accessTokenExpiresAt', { mode: 'date' }),
    refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt', { mode: 'date' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const authVerification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expiresAt', { mode: 'date' }).notNull(),
    createdAt: timestamp('createdAt', { mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updatedAt', { mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => authUser.id, { onDelete: 'cascade' }),
  locale: text('locale'),
  activeOrgId: uuid('active_org_id'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ------------------------------------------------------------------ Organizations

export const organizations = pgTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  orgType: text('org_type').notNull(),
  vocabulary: text('vocabulary').notNull().default('generic'),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  workStart: text('work_start').notNull().default('09:00'),
  workEnd: text('work_end').notNull().default('18:00'),
  workDays: jsonb('work_days').$type<number[]>().notNull().default([1, 2, 3, 4, 5, 6]),
  setupStep: text('setup_step').notNull().default('organization'),
  setupComplete: boolean('setup_complete').notNull().default(false),
  recoveryContact: text('recovery_contact'),
  recoveryUserId: text('recovery_user_id'),
  notificationPrefs: jsonb('notification_prefs').$type<Record<string, unknown>>().notNull().default({}),
  retention: jsonb('retention').$type<{ telemetryDays: number; messageImageHours: number; reportDays: number }>().notNull().default({ telemetryDays: 7, messageImageHours: 24, reportDays: 30 }),
  isDemo: boolean('is_demo').notNull().default(false),
  profileVersion: integer('profile_version').notNull().default(1),
  createdAt: created(),
});

export const memberships = pgTable(
  'memberships',
  {
    id: id(),
    orgId: orgId(),
    userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('memberships_org_user_uq').on(t.orgId, t.userId), index('memberships_user_idx').on(t.userId)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    orgId: orgId(),
    email: text('email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    acceptedBy: text('accepted_by'),
    invitedBy: text('invited_by').notNull(),
    createdAt: created(),
  },
  (t) => [index('invitations_org_idx').on(t.orgId, t.createdAt)],
);

export const orgPolicy = pgTable('org_policy', {
  orgId: uuid('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  autoThrottleEnabled: boolean('auto_throttle_enabled').notNull().default(false),
  throttleRatePerMinute: integer('throttle_rate_per_minute').notNull().default(1),
  throttleDurationMinutes: integer('throttle_duration_minutes').notNull().default(30),
  burstThreshold: integer('burst_threshold').notNull().default(20),
  burstWindowSeconds: integer('burst_window_seconds').notNull().default(120),
  dailyLimit: integer('daily_limit').notNull().default(100),
  consentVersion: integer('consent_version'),
  consentedBy: text('consented_by'),
  consentedAt: ts('consented_at'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/** Immutable history of policy versions (audit trail of consent). */
export const orgPolicyVersions = pgTable(
  'org_policy_versions',
  {
    id: id(),
    orgId: orgId(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    changedBy: text('changed_by').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('org_policy_versions_uq').on(t.orgId, t.version)],
);

/** Guard rows serialize related writers (build.md Ph04.4). key: 'org' or 'subject:<staffId>'. */
export const policyGuards = pgTable(
  'policy_guards',
  {
    orgId: orgId(),
    guardKey: text('guard_key').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.guardKey] })],
);

// ------------------------------------------------------------------ People, apps, dependencies

export const staff = pgTable(
  'staff',
  {
    id: id(),
    orgId: orgId(),
    displayName: text('display_name').notNull(),
    email: text('email'),
    employeeCode: text('employee_code'),
    recordsPinHash: text('records_pin_hash'),
    status: text('status').notNull().default('active'),
    sharedAccount: boolean('shared_account').notNull().default(false),
    userId: text('user_id'),
    offboardedAt: ts('offboarded_at'),
    createdAt: created(),
  },
  (t) => [index('staff_org_idx').on(t.orgId, t.status), uniqueIndex('staff_org_code_uq').on(t.orgId, t.employeeCode)],
);

export const integrations = pgTable(
  'integrations',
  {
    id: id(),
    orgId: orgId(),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    canObserve: boolean('can_observe').notNull().default(false),
    canEnforce: boolean('can_enforce').notNull().default(false),
    status: text('status').notNull().default('unconnected'),
    lastEventAt: ts('last_event_at'),
    lastTestAt: ts('last_test_at'),
    lastTestResult: jsonb('last_test_result'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    credentialCiphertext: text('credential_ciphertext'),
    connectorKeyHash: text('connector_key_hash').unique(),
    revokedAt: ts('revoked_at'),
    createdAt: created(),
  },
  (t) => [index('integrations_org_idx').on(t.orgId, t.status)],
);

export const dependencies = pgTable(
  'dependencies',
  {
    id: id(),
    orgId: orgId(),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    confidence: text('confidence').notNull().default('unknown'),
    subjectIds: jsonb('subject_ids').$type<string[]>().notNull().default([]),
    deviceIds: jsonb('device_ids').$type<string[]>().notNull().default([]),
    integrationIds: jsonb('integration_ids').$type<string[]>().notNull().default([]),
    declaredBy: text('declared_by').notNull(),
    declaredAt: ts('declared_at').notNull().defaultNow(),
    source: text('source').notNull().default('owner_declared'),
  },
  (t) => [index('dependencies_org_idx').on(t.orgId)],
);

export const appSessions = pgTable(
  'app_sessions',
  {
    id: id(),
    orgId: orgId(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    staffId: uuid('staff_id').notNull().references(() => staff.id),
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    familiar: boolean('familiar').notNull().default(true),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    lastUsedAt: ts('last_used_at'),
    revokedAt: ts('revoked_at'),
    revokedReason: text('revoked_reason'),
    createdVia: text('created_via').notNull().default('records_login'),
  },
  (t) => [index('app_sessions_org_staff_idx').on(t.orgId, t.staffId, t.status)],
);

export const grants = pgTable(
  'grants',
  {
    id: id(),
    orgId: orgId(),
    staffId: uuid('staff_id').notNull().references(() => staff.id),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    capability: text('capability').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('grants_uq').on(t.orgId, t.staffId, t.integrationId, t.capability)],
);

/** Restrictions have independent lifecycles: a throttle expiring never lifts a pause. */
export const restrictions = pgTable(
  'restrictions',
  {
    id: id(),
    orgId: orgId(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    kind: text('kind').notNull(),
    ratePerMinute: integer('rate_per_minute'),
    startsAt: ts('starts_at').notNull().defaultNow(),
    expiresAt: ts('expires_at'),
    liftedAt: ts('lifted_at'),
    liftedReason: text('lifted_reason'),
    source: text('source').notNull(),
    actionId: uuid('action_id'),
    incidentId: uuid('incident_id'),
    policyVersion: integer('policy_version'),
    warnedAt: ts('warned_at'),
    createdAt: created(),
  },
  (t) => [index('restrictions_org_target_idx').on(t.orgId, t.targetType, t.targetId), index('restrictions_org_active_idx').on(t.orgId, t.liftedAt, t.expiresAt)],
);

export const accessLog = pgTable(
  'access_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: orgId(),
    sessionId: uuid('session_id').notNull(),
    staffId: uuid('staff_id').notNull(),
    recordId: uuid('record_id'),
    capability: text('capability').notNull(),
    decision: text('decision').notNull(),
    admitted: boolean('admitted').notNull(),
    reason: text('reason').notNull(),
    policyVersion: integer('policy_version').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('access_log_session_at_idx').on(t.sessionId, t.at), index('access_log_org_at_idx').on(t.orgId, t.at)],
);

export const demoRecords = pgTable(
  'demo_records',
  {
    id: id(),
    orgId: orgId(),
    integrationId: uuid('integration_id').notNull().references(() => integrations.id),
    title: text('title').notNull(),
    category: text('category').notNull(),
    body: text('body').notNull(),
    isDecoy: boolean('is_decoy').notNull().default(false),
    createdAt: created(),
  },
  (t) => [index('demo_records_org_idx').on(t.orgId)],
);

// ------------------------------------------------------------------ Devices

export const devices = pgTable(
  'devices',
  {
    id: id(),
    orgId: orgId(),
    name: text('name').notNull(),
    status: text('status').notNull().default('waiting'),
    hostname: text('hostname'),
    osVersion: text('os_version'),
    agentVersion: text('agent_version'),
    simulated: boolean('simulated').notNull().default(false),
    lastSeenAt: ts('last_seen_at'),
    lastEventAt: ts('last_event_at'),
    capabilities: jsonb('capabilities').$type<{ action: string; supported: boolean; reason: string | null }[]>().notNull().default([]),
    prerequisites: jsonb('prerequisites').$type<{ key: string; met: boolean; detail: string | null }[]>().notNull().default([]),
    capabilityVersion: integer('capability_version').notNull().default(0),
    interactiveSession: jsonb('interactive_session'),
    spoolDepth: integer('spool_depth').notNull().default(0),
    droppedEvents: integer('dropped_events').notNull().default(0),
    retiredAt: ts('retired_at'),
    createdAt: created(),
  },
  (t) => [index('devices_org_idx').on(t.orgId, t.status)],
);

export const deviceKeys = pgTable(
  'device_keys',
  {
    id: id(),
    orgId: orgId(),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    keyVersion: integer('key_version').notNull(),
    secretCiphertext: text('secret_ciphertext').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    retiredAt: ts('retired_at'),
  },
  (t) => [uniqueIndex('device_keys_uq').on(t.deviceId, t.keyVersion)],
);

export const enrollmentCodes = pgTable(
  'enrollment_codes',
  {
    id: id(),
    orgId: orgId(),
    codeHash: text('code_hash').notNull().unique(),
    deviceName: text('device_name').notNull(),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    deviceId: uuid('device_id'),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
  },
  (t) => [index('enrollment_codes_org_idx').on(t.orgId, t.createdAt)],
);

export const deviceNonces = pgTable(
  'device_nonces',
  {
    deviceId: uuid('device_id').notNull(),
    nonce: text('nonce').notNull(),
    orgId: orgId(),
    seenAt: ts('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.nonce] })],
);

export const deviceAccounts = pgTable(
  'device_accounts',
  {
    id: id(),
    orgId: orgId(),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    sid: text('sid').notNull(),
    username: text('username').notNull(),
    isAdmin: boolean('is_admin').notNull(),
    enabled: boolean('enabled').notNull(),
    staffId: uuid('staff_id'),
    isRecoveryIdentity: boolean('is_recovery_identity').notNull().default(false),
    isAgentIdentity: boolean('is_agent_identity').notNull().default(false),
    observedAt: ts('observed_at').notNull(),
  },
  (t) => [uniqueIndex('device_accounts_uq').on(t.deviceId, t.sid)],
);

export const devicePosture = pgTable(
  'device_posture',
  {
    id: id(),
    orgId: orgId(),
    deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    checks: jsonb('checks').$type<Record<string, { result: string; value: string | null; source: string; observedAt: string }>>().notNull(),
    observedAt: ts('observed_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('device_posture_uq').on(t.deviceId, t.revision)],
);

// ------------------------------------------------------------------ Observations and incidents

export const rawEvents = pgTable(
  'raw_events',
  {
    id: id(),
    orgId: orgId(),
    sourceType: text('source_type').notNull(),
    deviceId: uuid('device_id'),
    integrationId: uuid('integration_id'),
    logEpoch: text('log_epoch'),
    channel: text('channel'),
    nativeEventId: text('native_event_id'),
    dedupeKey: text('dedupe_key').notNull(),
    type: text('type').notNull(),
    observedAt: ts('observed_at').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    facts: jsonb('facts').$type<Record<string, unknown>>().notNull().default({}),
    isReplay: boolean('is_replay').notNull().default(false),
    processedAt: ts('processed_at'),
  },
  (t) => [
    uniqueIndex('raw_events_org_dedupe_uq').on(t.orgId, t.dedupeKey),
    uniqueIndex('raw_events_device_native_uq').on(t.deviceId, t.logEpoch, t.channel, t.nativeEventId).where(sql`device_id IS NOT NULL`),
    index('raw_events_org_obs_idx').on(t.orgId, t.observedAt),
  ],
);

export const signals = pgTable(
  'signals',
  {
    id: id(),
    orgId: orgId(),
    type: text('type').notNull(),
    family: text('family').notNull(),
    subjectKey: text('subject_key').notNull(),
    count: integer('count').notNull().default(1),
    firstAt: ts('first_at').notNull(),
    lastAt: ts('last_at').notNull(),
    rawEventIds: jsonb('raw_event_ids').$type<string[]>().notNull().default([]),
    provenance: jsonb('provenance').$type<Record<string, unknown>>().notNull().default({}),
    isReplay: boolean('is_replay').notNull().default(false),
    createdAt: created(),
  },
  (t) => [index('signals_org_subject_idx').on(t.orgId, t.subjectKey, t.lastAt)],
);

export const eventDispositions = pgTable(
  'event_dispositions',
  {
    id: id(),
    orgId: orgId(),
    rawEventId: uuid('raw_event_id').notNull().references(() => rawEvents.id, { onDelete: 'cascade' }),
    disposition: text('disposition').notNull(),
    reason: text('reason').notNull(),
    signalId: uuid('signal_id'),
    incidentId: uuid('incident_id'),
    isReplay: boolean('is_replay').notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex('event_dispositions_event_uq').on(t.rawEventId), index('event_dispositions_org_idx').on(t.orgId, t.createdAt)],
);

export const incidents = pgTable(
  'incidents',
  {
    id: id(),
    orgId: orgId(),
    family: text('family').notNull(),
    correlationKey: text('correlation_key').notNull(),
    title: jsonb('title').notNull(),
    urgency: text('urgency').notNull(),
    state: text('state').notNull().default('open'),
    facts: jsonb('facts').notNull().default([]),
    uncertain: jsonb('uncertain').notNull().default([]),
    boundaries: jsonb('boundaries').notNull().default([]),
    scope: jsonb('scope').notNull(),
    containment: jsonb('containment').notNull(),
    subjectStaffId: uuid('subject_staff_id'),
    subjectSessionId: uuid('subject_session_id'),
    subjectDeviceId: uuid('subject_device_id'),
    dismissedReason: text('dismissed_reason'),
    isReplay: boolean('is_replay').notNull().default(false),
    openedAt: ts('opened_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    // Scenario decision popup (build.md Ph07/08 reuse). `version` bumps on every reassessment
    // pass (not just new evidence), so reopening compares the set of open finding IDs instead:
    // the prompt reopens only when a finding exists that was not open at decision time.
    decidedAt: ts('decided_at'),
    decidedVersion: integer('decided_version'),
    decidedFindingIds: jsonb('decided_finding_ids').$type<string[]>(),
    decidedResponse: text('decided_response'),
    decidedByUserId: text('decided_by_user_id'),
  },
  (t) => [index('incidents_org_state_idx').on(t.orgId, t.state, t.updatedAt), index('incidents_org_corr_idx').on(t.orgId, t.family, t.correlationKey)],
);

export const incidentFindings = pgTable(
  'incident_findings',
  {
    id: id(),
    orgId: orgId(),
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    ruleVersion: integer('rule_version').notNull(),
    status: text('status').notNull().default('open'),
    harmfulCapability: text('harmful_capability').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    facts: jsonb('facts').notNull().default([]),
    boundaries: jsonb('boundaries').notNull().default([]),
    signalIds: jsonb('signal_ids').$type<string[]>().notNull().default([]),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('incident_findings_incident_idx').on(t.incidentId), uniqueIndex('incident_findings_rule_target_uq').on(t.incidentId, t.ruleId, t.targetType, t.targetId)],
);

export const incidentHistory = pgTable(
  'incident_history',
  {
    id: id(),
    orgId: orgId(),
    incidentId: uuid('incident_id').notNull().references(() => incidents.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    text: jsonb('text').notNull(),
    actorUserId: text('actor_user_id'),
    actionId: uuid('action_id'),
    evidenceIntentId: uuid('evidence_intent_id'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('incident_history_incident_idx').on(t.incidentId, t.at)],
);

// ------------------------------------------------------------------ Decisions

export const previews = pgTable(
  'previews',
  {
    id: id(),
    orgId: orgId(),
    incidentId: uuid('incident_id'),
    actorUserId: text('actor_user_id').notNull(),
    actionType: text('action_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    params: jsonb('params').notNull().default({}),
    stateHash: text('state_hash').notNull(),
    policyVersion: integer('policy_version').notNull(),
    guardKeys: jsonb('guard_keys').$type<string[]>().notNull(),
    content: jsonb('content').notNull(),
    observedAt: ts('observed_at').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: created(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('previews_org_incident_idx').on(t.orgId, t.incidentId, t.createdAt)],
);

export const actions = pgTable(
  'actions',
  {
    id: id(),
    orgId: orgId(),
    previewId: uuid('preview_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    incidentId: uuid('incident_id'),
    actorUserId: text('actor_user_id').notNull(),
    actionType: text('action_type').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    params: jsonb('params').notNull().default({}),
    state: text('state').notNull().default('requested'),
    expectedPostconditions: jsonb('expected_postconditions').notNull().default([]),
    result: jsonb('result'),
    boundaries: jsonb('boundaries').notNull().default([]),
    deviceId: uuid('device_id'),
    simulated: boolean('simulated').notNull().default(false),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    uniqueIndex('actions_org_preview_uq').on(t.orgId, t.previewId),
    uniqueIndex('actions_org_idem_uq').on(t.orgId, t.idempotencyKey),
    index('actions_org_state_idx').on(t.orgId, t.state, t.updatedAt),
  ],
);

export const actionProbes = pgTable(
  'action_probes',
  {
    id: id(),
    orgId: orgId(),
    actionId: uuid('action_id').notNull().references(() => actions.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    label: jsonb('label').notNull(),
    expected: text('expected').notNull(),
    observed: text('observed').notNull(),
    result: text('result').notNull(),
    checkedAt: ts('checked_at').notNull(),
    source: text('source').notNull(),
  },
  (t) => [index('action_probes_action_idx').on(t.actionId)],
);

export const agentCommands = pgTable(
  'agent_commands',
  {
    id: id(),
    orgId: orgId(),
    deviceId: uuid('device_id').notNull().references(() => devices.id),
    actionId: uuid('action_id').notNull().references(() => actions.id),
    type: text('type').notNull(),
    params: jsonb('params').notNull(),
    expectedStateHash: text('expected_state_hash').notNull(),
    nonce: text('nonce').notNull(),
    status: text('status').notNull().default('pending_signature'),
    envelope: jsonb('envelope'),
    keyId: text('key_id'),
    issuedAt: ts('issued_at'),
    expiresAt: ts('expires_at'),
    deliveredAt: ts('delivered_at'),
    deliveryCount: integer('delivery_count').notNull().default(0),
    result: jsonb('result'),
    resultReceivedAt: ts('result_received_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('agent_commands_device_nonce_uq').on(t.deviceId, t.nonce), uniqueIndex('agent_commands_action_uq').on(t.actionId), index('agent_commands_device_status_idx').on(t.deviceId, t.status)],
);

/** Saathi-owned device changes; undo only restores prior state if still owned. */
export const deviceChanges = pgTable(
  'device_changes',
  {
    id: id(),
    orgId: orgId(),
    deviceId: uuid('device_id').notNull(),
    actionId: uuid('action_id').notNull(),
    actionType: text('action_type').notNull(),
    priorState: jsonb('prior_state'),
    appliedState: jsonb('applied_state'),
    status: text('status').notNull().default('active'),
    undoneByActionId: uuid('undone_by_action_id'),
    createdAt: created(),
  },
  (t) => [index('device_changes_device_idx').on(t.deviceId, t.status)],
);

export const recoveryCases = pgTable(
  'recovery_cases',
  {
    id: id(),
    orgId: orgId(),
    incidentId: uuid('incident_id').notNull().references(() => incidents.id),
    status: text('status').notNull().default('in_progress'),
    steps: jsonb('steps').notNull(),
    newSessionId: uuid('new_session_id'),
    oldSessionIds: jsonb('old_session_ids').$type<string[]>().notNull().default([]),
    blockedReason: jsonb('blocked_reason'),
    createdBy: text('created_by').notNull(),
    createdAt: created(),
    completedAt: ts('completed_at'),
  },
  (t) => [uniqueIndex('recovery_cases_incident_open_uq').on(t.incidentId).where(sql`status <> 'cancelled'`)],
);

// ------------------------------------------------------------------ Durable work

export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    orgId: uuid('org_id'),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    dedupeKey: text('dedupe_key').notNull().unique(),
    status: text('status').notNull().default('queued'),
    runAt: ts('run_at').notNull().defaultNow(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: ts('lease_expires_at'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    lastError: text('last_error'),
    createdAt: created(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [index('jobs_due_idx').on(t.status, t.runAt), index('jobs_org_idx').on(t.orgId, t.status)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    orgId: orgId(),
    userId: text('user_id').notNull(),
    channel: text('channel').notNull(),
    kind: text('kind').notNull(),
    incidentId: uuid('incident_id'),
    text: jsonb('text').notNull(),
    linkPath: text('link_path'),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    sentAt: ts('sent_at'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('notifications_org_dedupe_uq').on(t.orgId, t.dedupeKey), index('notifications_org_status_idx').on(t.orgId, t.status)],
);

export const telegramLinks = pgTable(
  'telegram_links',
  {
    id: id(),
    orgId: orgId(),
    userId: text('user_id').notNull(),
    codeHash: text('code_hash').unique(),
    codeExpiresAt: ts('code_expires_at'),
    chatId: text('chat_id'),
    linkedAt: ts('linked_at'),
    unlinkedAt: ts('unlinked_at'),
    createdAt: created(),
  },
  (t) => [index('telegram_links_user_idx').on(t.orgId, t.userId), uniqueIndex('telegram_links_chat_active_uq').on(t.chatId).where(sql`chat_id IS NOT NULL AND unlinked_at IS NULL`)],
);

export const telegramUpdates = pgTable('telegram_updates', {
  updateId: bigint('update_id', { mode: 'number' }).primaryKey(),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

export const scamChecks = pgTable(
  'scam_checks',
  {
    id: id(),
    orgId: orgId(),
    reporterUserId: text('reporter_user_id').notNull(),
    inputKind: text('input_kind').notNull(),
    channel: text('channel').notNull().default('web'),
    reviewedText: text('reviewed_text'),
    fingerprint: text('fingerprint').notNull(),
    campaignKey: text('campaign_key'),
    domains: jsonb('domains').notNull().default([]),
    findings: jsonb('findings').notNull(),
    verdict: text('verdict').notNull(),
    aiStatus: text('ai_status').notNull().default('not_requested'),
    aiExplanation: text('ai_explanation'),
    externalProcessingConsent: boolean('external_processing_consent').notNull().default(false),
    attachmentRef: text('attachment_ref'),
    attachmentExpiresAt: ts('attachment_expires_at'),
    reported: boolean('reported').notNull().default(false),
    campaignId: uuid('campaign_id'),
    textExpiresAt: ts('text_expires_at'),
    createdAt: created(),
  },
  (t) => [index('scam_checks_org_reporter_idx').on(t.orgId, t.reporterUserId, t.createdAt), index('scam_checks_org_campaign_idx').on(t.orgId, t.campaignKey, t.createdAt)],
);

export const campaignReports = pgTable(
  'campaign_reports',
  {
    id: id(),
    orgId: orgId(),
    campaignKey: text('campaign_key').notNull(),
    status: text('status').notNull().default('open'),
    reporterCount: integer('reporter_count').notNull().default(0),
    verdict: text('verdict').notNull(),
    summary: jsonb('summary').notNull(),
    firstAt: ts('first_at').notNull(),
    lastAt: ts('last_at').notNull(),
    incidentId: uuid('incident_id'),
    warnedAt: ts('warned_at'),
    warnedBy: text('warned_by'),
    recipients: jsonb('recipients').$type<{ userId: string; status: string }[]>().notNull().default([]),
  },
  (t) => [uniqueIndex('campaign_reports_open_uq').on(t.orgId, t.campaignKey).where(sql`status = 'open'`)],
);

// Audit trail for optional AI assistance (build.md Ph13). Records that a call happened and
// how it resolved, never the prompt or the model's output, so the log itself cannot leak the
// facts or message text that were sent.
export const aiCallLog = pgTable(
  'ai_call_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: orgId(),
    operation: text('operation').notNull(),
    capability: text('capability').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    outcome: text('outcome').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('ai_call_log_org_at_idx').on(t.orgId, t.at)],
);

// ------------------------------------------------------------------ Evidence and anchoring

export const evidenceChainHeads = pgTable('evidence_chain_heads', {
  orgId: uuid('org_id').primaryKey().references(() => organizations.id, { onDelete: 'cascade' }),
  nextIntentSeq: bigint('next_intent_seq', { mode: 'number' }).notNull().default(1),
  lastSignedSeq: bigint('last_signed_seq', { mode: 'number' }).notNull().default(0),
  lastHash: text('last_hash').notNull().default('0'.repeat(64)),
  lastCheckpointSeq: bigint('last_checkpoint_seq', { mode: 'number' }).notNull().default(0),
  lastCheckpointAt: ts('last_checkpoint_at'),
  blockedSeq: bigint('blocked_seq', { mode: 'number' }),
  blockedReason: text('blocked_reason'),
});

export const evidenceIntents = pgTable(
  'evidence_intents',
  {
    id: id(),
    orgId: orgId(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    type: text('type').notNull(),
    occurredAt: ts('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    incidentId: uuid('incident_id'),
    status: text('status').notNull().default('pending_signature'),
    error: text('error'),
    createdAt: created(),
  },
  (t) => [uniqueIndex('evidence_intents_org_seq_uq').on(t.orgId, t.seq), index('evidence_intents_org_status_idx').on(t.orgId, t.status, t.seq), index('evidence_intents_incident_idx').on(t.orgId, t.incidentId)],
);

export const evidenceEntries = pgTable(
  'evidence_entries',
  {
    orgId: orgId(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    intentId: uuid('intent_id').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    type: text('type').notNull(),
    occurredAt: text('occurred_at').notNull(),
    recordedAt: text('recorded_at').notNull(),
    payload: jsonb('payload').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    signature: text('signature').notNull(),
    keyId: text('key_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.seq] })],
);

export const checkpoints = pgTable(
  'checkpoints',
  {
    id: id(),
    orgId: orgId(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    headHash: text('head_hash').notNull(),
    createdAt: text('created_at').notNull(),
    keyId: text('key_id').notNull(),
    hash: text('hash').notNull(),
    signature: text('signature').notNull(),
    retainedRef: text('retained_ref'),
    isSample: boolean('is_sample').notNull().default(false),
    insertedAt: ts('inserted_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('checkpoints_org_seq_uq').on(t.orgId, t.seq)],
);

/** Global (cross-tenant) batch: contains only the Merkle root and public proof. */
export const anchorBatches = pgTable('anchor_batches', {
  id: id(),
  merkleVersion: integer('merkle_version').notNull(),
  rootHex: text('root_hex').notNull().unique(),
  rootFile: bytea('root_file').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: created(),
});

export const anchorMembers = pgTable(
  'anchor_members',
  {
    id: id(),
    orgId: orgId(),
    checkpointId: uuid('checkpoint_id').notNull().references(() => checkpoints.id),
    batchId: uuid('batch_id').references(() => anchorBatches.id),
    nonceHex: text('nonce_hex').notNull(),
    commitmentHex: text('commitment_hex').notNull().unique(),
    leafIndex: integer('leaf_index'),
    path: jsonb('path').$type<{ side: 'L' | 'R'; hash: string }[]>(),
    requestedBy: text('requested_by').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('anchor_members_checkpoint_uq').on(t.checkpointId)],
);

export const anchorProofs = pgTable('anchor_proofs', {
  id: id(),
  batchId: uuid('batch_id').notNull().unique().references(() => anchorBatches.id),
  backend: text('backend').notNull(),
  otsBytes: bytea('ots_bytes'),
  status: text('status').notNull().default('pending'),
  calendars: jsonb('calendars').$type<string[]>().notNull().default([]),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: ts('last_attempt_at'),
  nextAttemptAt: ts('next_attempt_at'),
  submittedAt: ts('submitted_at'),
  bitcoinHeight: integer('bitcoin_height'),
  blockHash: text('block_hash'),
  merkleRootHex: text('merkle_root_hex'),
  verificationMethod: text('verification_method'),
  verifiedAt: ts('verified_at'),
  lastError: text('last_error'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

// ------------------------------------------------------------------ Reports

export const reports = pgTable(
  'reports',
  {
    id: id(),
    orgId: orgId(),
    kind: text('kind').notNull(),
    incidentId: uuid('incident_id'),
    periodStart: ts('period_start'),
    periodEnd: ts('period_end'),
    manifestVersion: integer('manifest_version').notNull().default(1),
    manifest: jsonb('manifest'),
    status: text('status').notNull().default('queued'),
    artifactRef: text('artifact_ref'),
    artifactSha256: text('artifact_sha256'),
    bundleRef: text('bundle_ref'),
    checkpointId: uuid('checkpoint_id'),
    createdBy: text('created_by').notNull(),
    error: text('error'),
    createdAt: created(),
    expiresAt: ts('expires_at'),
  },
  (t) => [index('reports_org_idx').on(t.orgId, t.createdAt)],
);

export const reportAccessLog = pgTable(
  'report_access_log',
  {
    id: id(),
    orgId: orgId(),
    reportId: uuid('report_id').notNull(),
    userId: text('user_id').notNull(),
    artifact: text('artifact').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('report_access_log_report_idx').on(t.reportId)],
);
