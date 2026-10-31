import { cookies } from 'next/headers';
import { z } from 'zod';
import { Locale, OrgType, SaathiError } from '@saathi/contracts';
import { createOrganization } from '@saathi/db';
import { ORG_COOKIE, getSession } from '@/server/actor';
import { assertSameOrigin, errorResponse, ok, readJson } from '@/server/api';
import { pool } from '@/server/db';

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  orgType: OrgType,
  locale: Locale,
  timezone: z
    .string()
    .min(3)
    .max(60)
    .refine((tz) => tz === 'UTC' || Intl.supportedValuesOf('timeZone').includes(tz), 'Unknown time zone'),
  workStart: z.string().regex(/^\d{2}:\d{2}$/),
  workEnd: z.string().regex(/^\d{2}:\d{2}$/),
  workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
});

// Onboarding: org + owner membership + initial policy in one transaction.
export async function POST(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(req);
    const s = await getSession();
    if (!s) throw new SaathiError('UNAUTHENTICATED', 'Sign in to continue.');
    const body = await readJson(req, Body);
    const r = await createOrganization(pool(), s.user, body);
    (await cookies()).set(ORG_COOKIE, r.orgId, { httpOnly: true, sameSite: 'lax', path: '/' });
    return ok(r, requestId, 201);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
