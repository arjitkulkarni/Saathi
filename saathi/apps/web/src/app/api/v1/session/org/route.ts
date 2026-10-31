import { cookies } from 'next/headers';
import { z } from 'zod';
import { SaathiError } from '@saathi/contracts';
import { listMembershipsForUser, setPreferences, withTx } from '@saathi/db';
import { ORG_COOKIE } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';
import { pool } from '@/server/db';

// Switch active organization. The selector is checked against current membership.
export const POST = userRoute(async ({ req, ctx }) => {
  const { orgId } = await readJson(req, z.object({ orgId: z.string().uuid() }));
  await withTx(pool(), { userId: ctx.actor.userId }, async (db) => {
    const m = await listMembershipsForUser(db, ctx.actor.userId);
    if (!m.some((x) => x.orgId === orgId)) throw new SaathiError('FORBIDDEN', 'You are not a member of that organization.');
    await setPreferences(db, ctx.actor.userId, { activeOrgId: orgId });
  });
  (await cookies()).set(ORG_COOKIE, orgId, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
  return { orgId };
});
