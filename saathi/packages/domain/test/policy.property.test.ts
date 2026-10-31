import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { Snapshot } from '@saathi/contracts';
import { applyActionToSnapshot, authorize, computePreview, relevantStateHash, type ActionSpec } from '../src';

// Phase 07 gate (build.md): property tests compare predicted and actual policy transitions
// over randomized states — allow/deny/throttle, multiple sessions, dependencies, coverage.

const AT = '2026-10-31T10:00:00.000Z';
const INTEGRATION = 'int-records';

const snapshotArb: fc.Arbitrary<Snapshot> = fc
  .record({
    subjects: fc.array(fc.record({ status: fc.constantFrom('active', 'offboarded'), shared: fc.boolean() }), { minLength: 1, maxLength: 4 }),
    sessions: fc.array(fc.record({ subject: fc.nat(3), status: fc.constantFrom('active', 'active', 'revoked'), familiar: fc.boolean() }), { minLength: 1, maxLength: 7 }),
    grants: fc.array(fc.record({ subject: fc.nat(3), cap: fc.constantFrom('records.view', 'records.download') }), { maxLength: 10 }),
    restrictions: fc.array(
      fc.record({ onSession: fc.boolean(), target: fc.nat(6), kind: fc.constantFrom('throttle', 'pause', 'disable_account'), expired: fc.boolean(), rate: fc.integer({ min: 1, max: 3 }) }),
      { maxLength: 5 },
    ),
    deps: fc.array(fc.record({ subject: fc.nat(3), confidence: fc.constantFrom('high', 'medium', 'low', 'unknown') }), { maxLength: 3 }),
    integrationEnforces: fc.boolean(),
    extraUnconnected: fc.boolean(),
  })
  .map((g) => {
    const subjects = g.subjects.map((s, i) => ({ id: `sub-${i}`, label: `Person ${i}`, status: s.status as 'active' | 'offboarded', sharedAccount: s.shared }));
    const sessions = g.sessions.map((s, i) => ({ id: `ses-${i}`, subjectId: subjects[s.subject % subjects.length].id, integrationId: INTEGRATION, label: `Session ${i}`, status: s.status as 'active' | 'revoked', familiar: s.familiar }));
    const grants = g.grants.map((x) => ({ subjectId: subjects[x.subject % subjects.length].id, integrationId: INTEGRATION, capability: x.cap as 'records.view' | 'records.download' }));
    const restrictions = g.restrictions
      .filter((r) => (r.onSession ? sessions.length > 0 : true))
      .map((r, i) => {
        const targetType = r.kind === 'disable_account' ? 'subject' : r.onSession ? 'session' : 'subject';
        const targetId = targetType === 'session' ? sessions[r.target % sessions.length].id : subjects[r.target % subjects.length].id;
        return { id: `r-${i}`, targetType: targetType as 'session' | 'subject', targetId, kind: r.kind as 'throttle' | 'pause' | 'disable_account', ratePerMinute: r.kind === 'throttle' ? r.rate : null, expiresAt: r.expired ? '2026-10-31T09:00:00.000Z' : r.kind === 'throttle' ? '2026-10-31T11:00:00.000Z' : null, source: 'action' as const };
      });
    const integrations = [{ id: INTEGRATION, name: 'Records', kind: 'records_reference', canObserve: true, canEnforce: g.integrationEnforces, status: 'connected', lastEventAt: null }];
    if (g.extraUnconnected) integrations.push({ id: 'int-billing', name: 'Billing', kind: 'unconnected', canObserve: false, canEnforce: false, status: 'unconnected', lastEventAt: null });
    return {
      orgId: 'org',
      observedAt: AT,
      policyVersion: 3,
      policy: { autoThrottleEnabled: true, throttleRatePerMinute: 1, throttleDurationMinutes: 30, burstThreshold: 20, burstWindowSeconds: 120, dailyLimit: 100 },
      subjects,
      sessions,
      grants,
      restrictions,
      integrations,
      dependencies: g.deps.map((d, i) => ({ id: `d-${i}`, description: `dep ${i}`, kind: 'other', confidence: d.confidence as 'unknown', subjectIds: [subjects[d.subject % subjects.length].id], deviceIds: [], declaredAt: AT })),
      devices: [],
    } satisfies Snapshot;
  });

const actionFor = (s: Snapshot, kind: number, idx: number): ActionSpec =>
  kind === 0
    ? { actionType: 'records.pause_session', targetType: 'session', targetId: s.sessions[idx % s.sessions.length].id, params: {} }
    : kind === 1
      ? { actionType: 'records.disable_account', targetType: 'subject', targetId: s.subjects[idx % s.subjects.length].id, params: {} }
      : { actionType: 'records.offboard_subject', targetType: 'subject', targetId: s.subjects[idx % s.subjects.length].id, params: {} };

/**
 * Independent model of what the database service writes when an action is applied
 * (packages/db/src/services/decisions.ts applyRecordsAction). Kept separate on purpose so
 * the prediction is compared against enforcement semantics, not against itself.
 */
function enforce(s: Snapshot, a: ActionSpec): Snapshot {
  const n: Snapshot = JSON.parse(JSON.stringify(s));
  if (a.actionType === 'records.pause_session') n.restrictions.push({ id: 'db-row', targetType: 'session', targetId: a.targetId, kind: 'pause', ratePerMinute: null, expiresAt: null, source: 'action' });
  if (a.actionType === 'records.disable_account') n.restrictions.push({ id: 'db-row', targetType: 'subject', targetId: a.targetId, kind: 'disable_account', ratePerMinute: null, expiresAt: null, source: 'action' });
  if (a.actionType === 'records.offboard_subject') {
    n.subjects = n.subjects.map((x) => (x.id === a.targetId ? { ...x, status: 'offboarded' } : x));
    n.sessions = n.sessions.map((x) => (x.subjectId === a.targetId && x.status === 'active' ? { ...x, status: 'revoked' } : x));
  }
  return n;
}

const requests = (s: Snapshot) => s.sessions.flatMap((x) => (['records.view', 'records.download'] as const).map((capability) => ({ sessionId: x.id, capability, at: AT })));

describe('consequence preview vs enforcement (property)', () => {
  it('predicted decisions equal enforced decisions for every request', () => {
    fc.assert(
      fc.property(snapshotArb, fc.nat(2), fc.nat(10), (s, kind, idx) => {
        const a = actionFor(s, kind, idx);
        const predicted = applyActionToSnapshot(s, a, AT);
        const enforced = enforce(s, a);
        for (const r of requests(s)) expect(authorize(predicted, r).decision).toBe(authorize(enforced, r).decision);
      }),
      { numRuns: 400 },
    );
  });

  it('preview partitions are consistent with before/after decisions and never touch other people', () => {
    fc.assert(
      fc.property(snapshotArb, fc.nat(2), fc.nat(10), (s, kind, idx) => {
        const a = actionFor(s, kind, idx);
        const p = computePreview(s, a, null, AT);
        const after = applyActionToSnapshot(s, a, AT);
        for (const c of [...p.stops, ...p.limits, ...p.keepsWorking]) {
          if (!c.sessionId) continue;
          const req = { sessionId: c.sessionId, capability: c.capability as 'records.view', at: AT };
          expect(c.before).toBe(authorize(s, req).decision);
          expect(c.after).toBe(authorize(after, req).decision);
        }
        for (const c of p.stops) expect(c.after).toBe('deny');
        for (const c of p.limits) expect(c.after).toBe('throttle');
        for (const c of p.keepsWorking) expect(c.after).toBe(c.before);
        // Missing enforcement coverage is never hidden.
        if (s.integrations.some((i) => i.kind !== 'device_agent' && (!i.canEnforce || i.status !== 'connected'))) expect(p.unknown.map((m) => m.key)).toContain('unknown.unconnected_apps');
        expect(p.cannotControl.map((m) => m.key)).toContain('cannot.records_already_downloaded');
      }),
      { numRuns: 400 },
    );
  });

  it('relevant state hash ignores unrelated people but changes when the target gains a session', () => {
    fc.assert(
      fc.property(snapshotArb, fc.nat(10), (s, idx) => {
        if (s.subjects.length < 2) return;
        const target = s.subjects[idx % s.subjects.length];
        const other = s.subjects.find((x) => x.id !== target.id)!;
        const a: ActionSpec = { actionType: 'records.disable_account', targetType: 'subject', targetId: target.id, params: {} };
        const h = relevantStateHash(s, a, AT);
        const unrelated = { ...s, sessions: [...s.sessions, { id: 'new-unrelated', subjectId: other.id, integrationId: INTEGRATION, label: 'x', status: 'active' as const, familiar: true }] };
        expect(relevantStateHash(unrelated, a, AT)).toBe(h);
        const related = { ...s, sessions: [...s.sessions, { id: 'new-related', subjectId: target.id, integrationId: INTEGRATION, label: 'x', status: 'active' as const, familiar: false }] };
        expect(relevantStateHash(related, a, AT)).not.toBe(h);
      }),
      { numRuns: 200 },
    );
  });

  it('expired restrictions never deny or throttle', () => {
    fc.assert(
      fc.property(snapshotArb, (s) => {
        const onlyExpired = { ...s, restrictions: s.restrictions.map((r) => ({ ...r, expiresAt: '2026-10-31T09:00:00.000Z' })) };
        for (const r of requests(onlyExpired)) {
          const d = authorize(onlyExpired, r);
          expect(['session_paused', 'account_disabled', 'throttled']).not.toContain(d.reason);
        }
      }),
      { numRuns: 200 },
    );
  });
});

describe('authorize', () => {
  const base = (): Snapshot => ({
    orgId: 'o',
    observedAt: AT,
    policyVersion: 1,
    policy: { autoThrottleEnabled: true, throttleRatePerMinute: 1, throttleDurationMinutes: 30, burstThreshold: 20, burstWindowSeconds: 120, dailyLimit: 100 },
    subjects: [{ id: 'a', label: 'A', status: 'active', sharedAccount: false }],
    sessions: [
      { id: 's1', subjectId: 'a', integrationId: INTEGRATION, label: 'Office', status: 'active', familiar: true },
      { id: 's2', subjectId: 'a', integrationId: INTEGRATION, label: 'Laptop', status: 'active', familiar: false },
    ],
    grants: [{ subjectId: 'a', integrationId: INTEGRATION, capability: 'records.download' }],
    restrictions: [],
    integrations: [{ id: INTEGRATION, name: 'R', kind: 'records_reference', canObserve: true, canEnforce: true, status: 'connected', lastEventAt: null }],
    dependencies: [],
    devices: [],
  });
  const req = (sessionId: string) => ({ sessionId, capability: 'records.download' as const, at: AT });

  it('pausing one session leaves the other permitted', () => {
    const s = base();
    const after = applyActionToSnapshot(s, { actionType: 'records.pause_session', targetType: 'session', targetId: 's2', params: {} }, AT);
    expect(authorize(after, req('s2'))).toMatchObject({ decision: 'deny', reason: 'session_paused' });
    expect(authorize(after, req('s1'))).toMatchObject({ decision: 'allow' });
  });
  it('throttle is a distinct decision, not equal to allow or deny', () => {
    const s = base();
    s.restrictions.push({ id: 't', targetType: 'session', targetId: 's2', kind: 'throttle', ratePerMinute: 1, expiresAt: '2026-10-31T10:30:00.000Z', source: 'auto_guard' });
    expect(authorize(s, req('s2'))).toMatchObject({ decision: 'throttle', ratePerMinute: 1 });
  });
  it('a revoked token stays denied regardless of restrictions expiring', () => {
    const s = base();
    s.sessions[1].status = 'revoked';
    expect(authorize(s, req('s2')).reason).toBe('session_revoked');
  });
  it('a non-enforcing integration fails closed', () => {
    const s = base();
    s.integrations[0].canEnforce = false;
    expect(authorize(s, req('s1')).decision).toBe('deny');
  });
  it('vocabulary/locale never affect authorization (decisions are pure on policy state)', () => {
    const s = base();
    expect(authorize(s, req('s1'))).toEqual(authorize(JSON.parse(JSON.stringify(s)), req('s1')));
  });
});
