import { z } from 'zod';
import { CheckResult, DeviceActionType, DEVICE_ACTIONS, EventType } from './vocabulary';

// Device protocol shared by the API, worker and Windows agent (build.md Ph05, Ph09).

export const AGENT_PROTOCOL_VERSION = 1;
export const MAX_EVENT_BATCH = 200;
export const MAX_DEVICE_BODY_BYTES = 256 * 1024;
export const DEVICE_CLOCK_SKEW_SECONDS = 300;

/** Headers on every HMAC-authenticated device request. */
export const DEVICE_HEADERS = {
  deviceId: 'x-saathi-device',
  keyVersion: 'x-saathi-key-version',
  timestamp: 'x-saathi-timestamp',
  nonce: 'x-saathi-nonce',
  signature: 'x-saathi-signature',
} as const;

/** Canonical string signed by the device: METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body) */
export function deviceSigningString(method: string, path: string, timestamp: string, nonce: string, bodySha256Hex: string): string {
  return [method.toUpperCase(), path, timestamp, nonce, bodySha256Hex].join('\n');
}

export const EnrollRequest = z.object({
  code: z.string().min(8).max(64),
  hostname: z.string().min(1).max(120),
  osVersion: z.string().max(200),
  agentVersion: z.string().max(40),
  simulated: z.boolean().default(false),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const EnrollResponse = z.object({
  deviceId: z.string().uuid(),
  orgId: z.string().uuid(),
  deviceSecret: z.string(),
  keyVersion: z.number().int(),
  commandKeys: z.array(z.object({ keyId: z.string(), publicKeyHex: z.string() })),
  pollIntervalSeconds: z.number().int(),
});
export type EnrollResponse = z.infer<typeof EnrollResponse>;

export const AgentEvent = z.object({
  logEpoch: z.string().max(80),
  channel: z.string().max(120),
  nativeEventId: z.string().max(80),
  type: EventType,
  observedAt: z.string().datetime(),
  facts: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export type AgentEvent = z.infer<typeof AgentEvent>;

export const EventBatch = z.object({
  batchId: z.string().max(80),
  events: z.array(AgentEvent).max(MAX_EVENT_BATCH),
  droppedSinceLast: z.number().int().min(0).default(0),
  spoolDepth: z.number().int().min(0).default(0),
});
export type EventBatch = z.infer<typeof EventBatch>;

export const EventBatchResponse = z.object({
  accepted: z.array(z.object({ channel: z.string(), logEpoch: z.string(), nativeEventId: z.string() })),
  duplicates: z.number().int(),
  rejected: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});

export const PostureCheck = z.object({
  result: CheckResult,
  value: z.string().nullable(),
  source: z.string(),
  observedAt: z.string().datetime(),
});
export type PostureCheck = z.infer<typeof PostureCheck>;

export const POSTURE_KEYS = ['av', 'firewall', 'updates', 'lockout', 'admin_exposure', 'remote_access'] as const;
export type PostureKey = (typeof POSTURE_KEYS)[number];

export const DeviceAccountFact = z.object({
  sid: z.string().max(200),
  username: z.string().max(200),
  isAdmin: z.boolean(),
  enabled: z.boolean(),
});

export const CapabilityReport = z.object({
  action: z.enum(DEVICE_ACTIONS),
  supported: z.boolean(),
  reason: z.string().nullable(),
});

export const Heartbeat = z.object({
  agentVersion: z.string().max(40),
  capabilityVersion: z.number().int(),
  capabilities: z.array(CapabilityReport),
  prerequisites: z.array(z.object({ key: z.string(), met: z.boolean(), detail: z.string().nullable() })),
  posture: z.partialRecord(z.enum(POSTURE_KEYS), PostureCheck).optional(),
  accounts: z.array(DeviceAccountFact).max(200).optional(),
  interactiveSession: z.object({ present: z.boolean(), locked: z.boolean().nullable(), helperConnected: z.boolean() }).optional(),
  spoolDepth: z.number().int().min(0),
  droppedEvents: z.number().int().min(0),
  simulated: z.boolean().default(false),
});
export type Heartbeat = z.infer<typeof Heartbeat>;

// ---------------------------------------------------------------------------
// Signed command envelope (build.md Ph09)
// {schemaVersion,id,orgId,deviceId,actionId,type,params,expectedStateHash,issuedAt,expiresAt,nonce,keyId,signature}
// ---------------------------------------------------------------------------

export const CommandParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const UnsignedCommand = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  deviceId: z.string().uuid(),
  actionId: z.string().uuid(),
  type: z.enum(DEVICE_ACTIONS),
  params: CommandParams,
  expectedStateHash: z.string(),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  nonce: z.string().min(16).max(64),
  keyId: z.string(),
});
export type UnsignedCommand = z.infer<typeof UnsignedCommand>;
export const CommandEnvelope = UnsignedCommand.extend({ signature: z.string() });
export type CommandEnvelope = z.infer<typeof CommandEnvelope>;

/** Bounded parameter schemas per device action. The agent rejects anything else. */
export const DEVICE_ACTION_PARAMS: Record<DeviceActionType, z.ZodType> = {
  'device.lock_session': z.object({ sessionUser: z.string().max(200).optional() }).strict(),
  'device.disable_local_account': z.object({ sid: z.string().regex(/^S-1-5-21-[0-9-]+$/) }).strict(),
  'device.restrict_removable_storage': z.object({ scope: z.literal('new_removable_disks') }).strict(),
  'device.enable_firewall': z.object({ profile: z.enum(['Domain', 'Private', 'Public', 'All']) }).strict(),
  'device.set_lockout_policy': z
    .object({ threshold: z.number().int().min(3).max(20), durationMinutes: z.number().int().min(5).max(60) })
    .strict(),
  'device.block_source_ip': z
    .object({
      address: z.string().regex(/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/),
      direction: z.literal('inbound'),
    })
    .strict(),
  'device.enable_av': z.object({ component: z.literal('realtime') }).strict(),
  'device.request_av_scan': z.object({ scanType: z.enum(['quick', 'full']) }).strict(),
  'device.undo_change': z.object({ changeId: z.string().uuid() }).strict(),
};

export const CommandOutcome = z.enum(['confirmed', 'partial', 'failed', 'unknown', 'rejected']);
export type CommandOutcome = z.infer<typeof CommandOutcome>;

export const CommandResult = z.object({
  commandId: z.string().uuid(),
  outcome: CommandOutcome,
  rejectionReason: z
    .enum(['bad_signature', 'unknown_key', 'wrong_device', 'wrong_org', 'expired', 'replayed', 'unsupported', 'invalid_params', 'precondition_changed', 'protected_identity'])
    .nullable(),
  executedAt: z.string().datetime().nullable(),
  probes: z
    .array(
      z.object({
        kind: z.string().max(80),
        expected: z.string().max(200),
        observed: z.string().max(400),
        result: CheckResult,
        checkedAt: z.string().datetime(),
      }),
    )
    .max(20),
  boundaries: z.array(z.string().max(80)).max(10),
  priorState: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  simulated: z.boolean().default(false),
});
export type CommandResult = z.infer<typeof CommandResult>;
