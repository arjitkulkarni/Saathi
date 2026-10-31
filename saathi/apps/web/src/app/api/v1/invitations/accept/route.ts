import { cookies } from 'next/headers';
import { z } from 'zod';
import { SaathiError } from '@saathi/contracts';
import { acceptInvitation } from '@saathi/db';
import { ORG_COOKIE, getSession } from '@/server/actor';
import { assertSameOrigin, errorResponse, ok, readJson } from '@/server/api';
import { pool } from '@/server/db';

export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(req);
    const s = await getSession();
    if (!s) throw new SaathiError('UNAUTHENTICATED', 'Sign in to continue.');
    const { token } = await readJson(req, z.object({ token: z.string().min(20).max(100) }));
    const r = await acceptInvitation(pool(), s.user, token);
    (await cookies()).set(ORG_COOKIE, r.orgId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return ok(r, requestId);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
