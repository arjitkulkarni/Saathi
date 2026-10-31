import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { loadRootEnv } from '../../packages/db/src/env';
import { getPool, withTx, type Db } from '../../packages/db/src/client';
import type { Actor } from '../../packages/db/src/services/core';
import { createRecordsSession } from '../../packages/db/src/services/gateway';

loadRootEnv();
export const appPool = getPool(process.env.TEST_DATABASE_URL!);
export const workerPool = getPool(process.env.TEST_DATABASE_URL_WORKER ?? process.env.TEST_DATABASE_URL!);
export const ownerClient = () => new pg.Client({ connectionString: process.env.TEST_DATABASE_URL_DIRECT });

export function checkPin(pin: string) {
  return (hash: string | null) => {
    if (!hash) return false;
    const [, salt, h] = hash.split('$');
    const a = scryptSync(pin, salt, 32);
    const b = Buffer.from(h, 'base64url');
    return a.length === b.length && timingSafeEqual(a, b);
  };
}

/** Look up fixture IDs with the owner role (test-only; bypasses RLS as table owner). */
export async function fixtures() {
  const c = ownerClient();
  await c.connect();
  const q = async (sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows;
  const orgs = await q('SELECT id, name FROM organizations');
  const org = (name: string) => orgs.find((o) => o.name === name)!.id as string;
  const users = await q('SELECT id, email, name FROM "user"');
  const user = (email: string) => users.find((u) => u.email === email)!;
  const staff = await q('SELECT id, org_id, employee_code FROM staff');
  await c.end();
  const lakeview = org('Lakeview Community Office');
  const northside = org('Northside Family Clinic');
  const actor = (email: string, orgId: string, role: Actor['role']): Actor => ({ userId: user(email).id, orgId, role, sessionCreatedAt: new Date(), name: user(email).name });
  return {
    lakeview,
    northside,
    staffId: (code: string) => staff.find((s) => s.employee_code === code)!.id as string,
    owner: actor('owner@lakeview.example', lakeview, 'owner'),
    approver: actor('approver@lakeview.example', lakeview, 'approver'),
    staffActor: actor('staff@lakeview.example', lakeview, 'staff'),
    auditor: actor('auditor@lakeview.example', lakeview, 'auditor'),
    northOwner: actor('owner@northside.example', northside, 'owner'),
  };
}

export function tx<T>(actorOrOrg: Actor | string, fn: (db: Db) => Promise<T>) {
  const ctx = typeof actorOrOrg === 'string' ? { orgId: actorOrOrg } : { orgId: actorOrOrg.orgId, userId: actorOrOrg.userId };
  return withTx(appPool, ctx, (db) => fn(db));
}

export async function newRecordsSession(orgId: string, code: string, pin: string, label: string, familiar = true) {
  return withTx(appPool, { orgId }, (db) => createRecordsSession(db, orgId, { employeeCode: code, pinHashCheck: checkPin(pin), label, familiar }));
}

export const idem = () => randomBytes(18).toString('base64url');
