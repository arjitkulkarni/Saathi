import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { SaathiError } from '../../packages/contracts/src';
import { closePools, getPool, withTx } from '../../packages/db/src/client';
import { approvePreview, createPreview, getActionDetail, getPreview, probeRecordsAction } from '../../packages/db/src/services/decisions';
import { gatewayDecide, resolveAppSession } from '../../packages/db/src/services/gateway';
import { getIncidentDetail } from '../../packages/db/src/services/incidents';
import { appPool, fixtures, idem, newRecordsSession, ownerClient, tx } from './helpers';

let F: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  F = await fixtures();
});
afterAll(async () => {
  await closePools();
});

async function download(token: string, recordId: string | null = null) {
  const s = await resolveAppSession(appPool, token);
  if (!s) return { decision: 'deny', admitted: false, reason: 'session_unknown' } as const;
  return withTx(appPool, { orgId: s.orgId }, (db) => gatewayDecide(db, s, { capability: 'records.download', recordId }));
}

async function firstRecord(orgId: string) {
  const c = ownerClient();
  await c.connect();
  const r = await c.query('SELECT id FROM demo_records WHERE org_id = $1 AND NOT is_decoy LIMIT 1', [orgId]);
  await c.end();
  return r.rows[0].id as string;
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toSatisfy((e: unknown) => e instanceof SaathiError && e.code === code);
}

describe('two sessions, pause only one (acceptance A3, demo core)', () => {
  it('denies the paused session while the other session keeps working, confirmed by probe', async () => {
    const office = await newRecordsSession(F.lakeview, 'JOS002', '305117', 'Office PC', true);
    const laptop = await newRecordsSession(F.lakeview, 'JOS002', '305117', 'Unrecognised laptop', false);
    const rec = await firstRecord(F.lakeview);
    expect((await download(laptop.token, rec)).admitted).toBe(true);

    const { previewId } = await tx(F.approver, (db) => createPreview(db, F.approver, { actionType: 'records.pause_session', targetType: 'session', targetId: laptop.sessionId, params: {} }, null));
    const preview = await tx(F.approver, (db) => getPreview(db, F.approver, previewId));
    expect(preview.content.stops.some((c) => c.sessionId === laptop.sessionId && c.after === 'deny')).toBe(true);
    expect(preview.content.keepsWorking.some((c) => c.sessionId === office.sessionId && c.after === 'allow')).toBe(true);
    expect(preview.content.cannotControl.map((m) => m.key)).toContain('cannot.records_already_downloaded');

    const { actionId } = await tx(F.approver, (db) => approvePreview(db, F.approver, previewId, idem()));
    const state = await tx(F.lakeview, (db) => probeRecordsAction(db, F.lakeview, actionId));
    expect(state).toBe('confirmed');

    const denied = await download(laptop.token, rec);
    expect(denied).toMatchObject({ decision: 'deny', admitted: false, reason: 'session_paused' });
    const allowed = await download(office.token, rec);
    expect(allowed).toMatchObject({ decision: 'allow', admitted: true });

    const detail = await tx(F.approver, (db) => getActionDetail(db, F.approver, actionId));
    expect(detail.probes.find((p) => p.kind === 'target_denied')?.result).toBe('pass');
    expect(detail.probes.find((p) => p.kind === 'unaffected_permitted')?.observed).toBe('allow');
  });
});

describe('atomic rate budget (acceptance A8)', () => {
  it('concurrent burst cannot over-admit and applies exactly one consented throttle', async () => {
    const s = await newRecordsSession(F.lakeview, 'LAK003', '771204', 'Burst laptop', false);
    const rec = await firstRecord(F.lakeview);
    const pool = getPool(process.env.TEST_DATABASE_URL!, 20);
    const results = await Promise.all(
      Array.from({ length: 40 }, async () => {
        const r = await resolveAppSession(pool, s.token);
        return withTx(pool, { orgId: r!.orgId }, (db) => gatewayDecide(db, r!, { capability: 'records.download', recordId: rec }));
      }),
    );
    const admitted = results.filter((r) => r.admitted).length;
    // threshold 20 admitted at full rate + at most 1 per minute once throttled
    expect(admitted).toBeLessThanOrEqual(21);
    expect(admitted).toBeGreaterThanOrEqual(20);
    expect(results.filter((r) => r.throttleUntil).length).toBe(1);
    const c = ownerClient();
    await c.connect();
    const t = await c.query("SELECT count(*)::int n FROM restrictions WHERE target_id = $1 AND kind = 'throttle'", [s.sessionId]);
    await c.end();
    expect(t.rows[0].n).toBe(1);
  });
});

describe('stale previews (acceptance A5, A6)', () => {
  it('rejects approval when a relevant new session appeared after the preview', async () => {
    const staffId = F.staffId('ASH001');
    await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Front desk PC', true);
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.disable_account', targetType: 'subject', targetId: staffId, params: {} }, null));
    await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Phone browser', false);
    await expectCode(tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem())), 'STALE_PREVIEW');
    const p = await tx(F.owner, (db) => getPreview(db, F.owner, previewId));
    expect(p.status).toBe('stale');
    expect(p.actionId).toBeNull();
  });

  it('does not invalidate a narrow preview when an unrelated person signs in', async () => {
    const target = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Asha laptop', false);
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null));
    await newRecordsSession(F.lakeview, 'JOS002', '305117', 'Joseph tablet', true);
    const r = await tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem()));
    expect(r.actionId).toBeTruthy();
  });

  it('rejects an expired preview', async () => {
    const target = await newRecordsSession(F.lakeview, 'JOS002', '305117', 'Expiry test', true);
    const created = new Date(Date.now() - 11 * 60 * 1000);
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null, created));
    await expectCode(tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem())), 'STALE_PREVIEW');
  });

  it('serializes session creation racing with approval: no phantom escape (repeated)', async () => {
    for (let i = 0; i < 8; i++) {
      const staffId = F.staffId('LAK003');
      const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.disable_account', targetType: 'subject', targetId: staffId, params: {} }, null));
      const p = await tx(F.owner, (db) => getPreview(db, F.owner, previewId));
      const predicted = new Set(p.content.stops.map((c) => c.sessionId));
      const [approval, created] = await Promise.allSettled([
        tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem())),
        newRecordsSession(F.lakeview, 'LAK003', '771204', `Race ${i}`, false),
      ]);
      expect(created.status).toBe('fulfilled');
      if (approval.status === 'fulfilled') {
        // Approval won the guard: the new session must have been created after it, so the
        // approved preview did not omit an existing session.
        const c = ownerClient();
        await c.connect();
        const a = await c.query('SELECT created_at FROM actions WHERE id = $1', [approval.value.actionId]);
        const sess = await c.query('SELECT id, created_at FROM app_sessions WHERE staff_id = $1 AND created_at < $2', [staffId, a.rows[0].created_at]);
        await c.end();
        for (const row of sess.rows) expect(predicted.has(row.id)).toBe(true);
        // and the new session is denied by the subject-level restriction
        const sid = (created as PromiseFulfilledResult<{ token: string }>).value.token;
        expect((await download(sid)).decision).toBe('deny');
        // clean up the restriction for the next iteration
        const c2 = ownerClient();
        await c2.connect();
        await c2.query("UPDATE restrictions SET lifted_at = now(), lifted_reason = 'test reset' WHERE target_id = $1 AND kind = 'disable_account' AND lifted_at IS NULL", [staffId]);
        await c2.end();
      } else {
        expect((approval.reason as SaathiError).code).toBe('STALE_PREVIEW');
      }
    }
  });
});

describe('idempotent approval (acceptance A7)', () => {
  it('concurrent duplicate taps produce a single logical action', async () => {
    const target = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Dup test', false);
    const { previewId } = await tx(F.approver, (db) => createPreview(db, F.approver, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null));
    const key = idem();
    const results = await Promise.all([...Array(4)].map(() => tx(F.approver, (db) => approvePreview(db, F.approver, previewId, key))).concat([tx(F.approver, (db) => approvePreview(db, F.approver, previewId, idem()))]));
    expect(new Set(results.map((r) => r.actionId)).size).toBe(1);
    const c = ownerClient();
    await c.connect();
    const n = await c.query('SELECT count(*)::int n FROM actions WHERE preview_id = $1', [previewId]);
    const r = await c.query("SELECT count(*)::int n FROM restrictions WHERE target_id = $1 AND kind = 'pause'", [target.sessionId]);
    await c.end();
    expect(n.rows[0].n).toBe(1);
    expect(r.rows[0].n).toBe(1);
  });
});

describe('authority (acceptance A1, A2)', () => {
  it('staff cannot preview or approve', async () => {
    const target = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Staff test', true);
    await expectCode(tx(F.staffActor, (db) => createPreview(db, F.staffActor, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null)), 'FORBIDDEN');
  });

  it('an approver whose role is revoked mid-flow is denied', async () => {
    const target = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Revocation test', true);
    const { previewId } = await tx(F.approver, (db) => createPreview(db, F.approver, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null));
    const c = ownerClient();
    await c.connect();
    await c.query("UPDATE memberships SET role = 'staff', version = version + 1 WHERE org_id = $1 AND user_id = $2", [F.lakeview, F.approver.userId]);
    try {
      await expectCode(tx(F.approver, (db) => approvePreview(db, F.approver, previewId, idem())), 'FORBIDDEN');
    } finally {
      await c.query("UPDATE memberships SET role = 'approver' WHERE org_id = $1 AND user_id = $2", [F.lakeview, F.approver.userId]);
      await c.end();
    }
  });

  it('a member of another organization cannot read, preview or approve by guessing IDs', async () => {
    const target = await newRecordsSession(F.lakeview, 'ASH001', '482910', 'Tenant test', true);
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null));
    // Forged actor: northside owner claiming the lakeview org must fail membership check.
    const forged = { ...F.northOwner, orgId: F.lakeview };
    await expectCode(tx(forged, (db) => getPreview(db, forged, previewId)), 'FORBIDDEN');
    // Real northside context cannot see the lakeview objects at all.
    await expectCode(tx(F.northOwner, (db) => getPreview(db, F.northOwner, previewId)), 'NOT_FOUND');
    await expectCode(tx(F.northOwner, (db) => createPreview(db, F.northOwner, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null)), 'NOT_FOUND');
    await expectCode(tx(F.northOwner, (db) => approvePreview(db, F.northOwner, previewId, idem())), 'NOT_FOUND');
    await expectCode(tx(F.northOwner, (db) => getIncidentDetail(db, F.northOwner, '00000000-0000-4000-8000-000000000000')), 'NOT_FOUND');
  });

  it('RLS hides other tenants even without the DAL (defense in depth)', async () => {
    const rows = await withTx(appPool, { orgId: F.northside }, async (_db, client) => (await client.query('SELECT id FROM staff WHERE org_id = $1', [F.lakeview])).rows);
    expect(rows).toHaveLength(0);
    const none = await withTx(appPool, {}, async (_db, client) => (await client.query('SELECT id FROM incidents')).rows);
    expect(none).toHaveLength(0);
    await expect(withTx(appPool, { orgId: F.northside }, async (_db, client) => client.query("INSERT INTO restrictions(org_id, target_type, target_id, kind, source) VALUES ($1, 'session', gen_random_uuid(), 'pause', 'action')", [F.lakeview]))).rejects.toThrow(/row-level security/);
    const role = await withTx(appPool, {}, async (_db, client) => (await client.query('SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0]);
    expect(role).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe('honest outcomes (acceptance A13-style, Ph08 gate)', () => {
  it('an injected enforcement failure yields failed, never confirmed', async () => {
    const target = await newRecordsSession(F.lakeview, 'JOS002', '305117', 'Injected failure', false);
    const { previewId } = await tx(F.owner, (db) => createPreview(db, F.owner, { actionType: 'records.pause_session', targetType: 'session', targetId: target.sessionId, params: {} }, null));
    const { actionId } = await tx(F.owner, (db) => approvePreview(db, F.owner, previewId, idem()));
    const state = await tx(F.lakeview, (db) =>
      probeRecordsAction(db, F.lakeview, actionId, {
        decide: async () => ({ decision: 'allow', admitted: true, reason: 'granted', retryAfterSeconds: null, record: null, throttleUntil: null, probe: true }),
      }),
    );
    expect(state).toBe('failed');
  });
});

describe('fail closed (Ph04 gate, flow §13)', () => {
  it('database unavailable returns DEPENDENCY_UNAVAILABLE, never access', async () => {
    const dead = new pg.Pool({ connectionString: 'postgres://saathi_app:x@127.0.0.1:1/none', connectionTimeoutMillis: 500 });
    await expectCode(resolveAppSession(dead, 'x'.repeat(43)), 'DEPENDENCY_UNAVAILABLE');
    await dead.end();
  });
});

describe('revoked tokens', () => {
  it('a revoked session token stays denied', async () => {
    const s = await newRecordsSession(F.lakeview, 'JOS002', '305117', 'To be revoked', true);
    const c = ownerClient();
    await c.connect();
    await c.query("UPDATE app_sessions SET status = 'revoked', revoked_at = now() WHERE id = $1", [s.sessionId]);
    await c.end();
    expect((await download(s.token)).reason).toBe('session_revoked');
  });

  it('former staff requests are denied by policy', async () => {
    await expect(newRecordsSession(F.lakeview, 'VIK004', '119900', 'Old laptop', true)).rejects.toSatisfy((e: unknown) => (e as SaathiError).code === 'FORBIDDEN');
  });
});
