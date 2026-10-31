import { z } from 'zod';
import { createRecordsSession, verifyPin, withTx } from '@saathi/db';
import { openRoute, readJson, assertSameOrigin } from '@/server/api';
import { pool } from '@/server/db';
import { limitSignIn } from '@/server/records';

/**
 * Sign in to the reference records app. The organization ID only selects which workspace
 * to sign in to; the employee code + PIN is the authentication. Each sign-in creates a new
 * application session under the person's guard row.
 */
export const POST = openRoute(async ({ req }) => {
  assertSameOrigin(req);
  const body = await readJson(
    req,
    z.object({ orgId: z.string().uuid(), employeeCode: z.string().trim().min(3).max(20), pin: z.string().regex(/^\d{4,8}$/), deviceLabel: z.string().trim().min(2).max(60), familiar: z.boolean() }),
  );
  limitSignIn(`${req.headers.get('x-forwarded-for') ?? 'local'}:${body.employeeCode}`);
  const r = await withTx(pool(), { orgId: body.orgId }, (db) =>
    createRecordsSession(db, body.orgId, { employeeCode: body.employeeCode.toUpperCase(), pinHashCheck: (h) => verifyPin(body.pin, h), label: body.deviceLabel, familiar: body.familiar }),
  );
  return { token: r.token, sessionId: r.sessionId, staffName: r.staffName, deviceLabel: body.deviceLabel };
});
