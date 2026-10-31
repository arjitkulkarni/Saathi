import { CommandEnvelope, DEVICE_ACTION_PARAMS, DEVICE_ACTIONS, type CommandResult, type UnsignedCommand } from '@saathi/contracts';
import { canonicalBytes, sha256Hex, verifyHashSignature } from '@saathi/evidence';

// Command envelope verification (build.md Ph09). The agent accepts only commands that are
// addressed to this device and organization, signed by a pinned command key, of an allowed
// type with bounded parameters, not expired, and not previously used.

export type RejectionReason = NonNullable<CommandResult['rejectionReason']>;
export type PinnedKey = { keyId: string; publicKeyHex: string };

export type VerifyContext = {
  deviceId: string;
  orgId: string;
  keys: PinnedKey[];
  now: Date;
  /** Returns the commandId that previously used this nonce, if any (persistent ledger). */
  nonceOwner: (nonce: string) => string | null;
};

export type Verified = { ok: true; command: CommandEnvelope } | { ok: false; reason: RejectionReason; commandId: string | null };

export function commandSigningHash(c: UnsignedCommand): string {
  const { schemaVersion, id, orgId, deviceId, actionId, type, params, expectedStateHash, issuedAt, expiresAt, nonce, keyId } = c;
  return sha256Hex(canonicalBytes({ schemaVersion, id, orgId, deviceId, actionId, type, params, expectedStateHash, issuedAt, expiresAt, nonce, keyId }));
}

export function verifyCommand(raw: unknown, ctx: VerifyContext): Verified {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const commandId = typeof obj.id === 'string' && /^[0-9a-f-]{36}$/.test(obj.id) ? obj.id : null;
  if (typeof obj.type === 'string' && !(DEVICE_ACTIONS as readonly string[]).includes(obj.type)) return { ok: false, reason: 'unsupported', commandId };
  const parsed = CommandEnvelope.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'invalid_params', commandId };
  const c = parsed.data;
  if (c.orgId !== ctx.orgId) return { ok: false, reason: 'wrong_org', commandId };
  if (c.deviceId !== ctx.deviceId) return { ok: false, reason: 'wrong_device', commandId };
  const key = ctx.keys.find((k) => k.keyId === c.keyId);
  if (!key) return { ok: false, reason: 'unknown_key', commandId };
  const { signature, ...unsigned } = c;
  if (!verifyHashSignature(commandSigningHash(unsigned), signature, key.publicKeyHex)) return { ok: false, reason: 'bad_signature', commandId };
  // Only after the signature verifies do we trust times, nonce and parameters.
  if (new Date(c.expiresAt).getTime() <= ctx.now.getTime()) return { ok: false, reason: 'expired', commandId };
  const owner = ctx.nonceOwner(c.nonce);
  if (owner && owner !== c.id) return { ok: false, reason: 'replayed', commandId };
  if (!DEVICE_ACTION_PARAMS[c.type].safeParse(c.params).success) return { ok: false, reason: 'invalid_params', commandId };
  return { ok: true, command: c };
}
