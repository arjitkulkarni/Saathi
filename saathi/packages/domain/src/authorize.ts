import type { AccessRequest, AuthorizationResult, Snapshot, SnapshotRestriction } from '@saathi/contracts';

// Pure authorization (build.md Ph04.2). The records gateway, the consequence preview and
// post-action probes all call this one function, so prediction and enforcement agree.

export const AUTHZ_REASONS = [
  'granted',
  'throttled',
  'session_unknown',
  'session_revoked',
  'session_paused',
  'subject_unknown',
  'subject_offboarded',
  'account_disabled',
  'integration_unavailable',
  'no_grant',
] as const;
export type AuthzReason = (typeof AUTHZ_REASONS)[number];

export function isRestrictionActive(r: SnapshotRestriction, at: string): boolean {
  return r.expiresAt === null || new Date(r.expiresAt).getTime() > new Date(at).getTime();
}

export function authorize(snapshot: Snapshot, request: AccessRequest): AuthorizationResult & { reason: AuthzReason } {
  const base = { policyVersion: snapshot.policyVersion, ratePerMinute: null as number | null };
  const deny = (reason: AuthzReason) => ({ ...base, decision: 'deny' as const, reason });

  const session = snapshot.sessions.find((s) => s.id === request.sessionId);
  if (!session) return deny('session_unknown');
  if (session.status === 'revoked') return deny('session_revoked');

  const subject = snapshot.subjects.find((s) => s.id === session.subjectId);
  if (!subject) return deny('subject_unknown');
  if (subject.status === 'offboarded') return deny('subject_offboarded');

  const integration = snapshot.integrations.find((i) => i.id === session.integrationId);
  if (!integration || !integration.canEnforce || !['connected', 'stale'].includes(integration.status)) return deny('integration_unavailable');

  const granted = snapshot.grants.some((g) => g.subjectId === subject.id && g.integrationId === integration.id && g.capability === request.capability);
  if (!granted) return deny('no_grant');

  const active = snapshot.restrictions.filter(
    (r) => isRestrictionActive(r, request.at) && ((r.targetType === 'session' && r.targetId === session.id) || (r.targetType === 'subject' && r.targetId === subject.id)),
  );
  if (session.status === 'paused' || active.some((r) => r.kind === 'pause' && r.targetType === 'session')) return deny('session_paused');
  if (active.some((r) => r.kind === 'disable_account' || (r.kind === 'pause' && r.targetType === 'subject'))) return deny('account_disabled');

  const throttles = active.filter((r) => r.kind === 'throttle');
  if (throttles.length > 0) {
    const rate = Math.min(...throttles.map((r) => r.ratePerMinute ?? 1));
    return { ...base, decision: 'throttle', reason: 'throttled', ratePerMinute: rate };
  }
  return { ...base, decision: 'allow', reason: 'granted' };
}
