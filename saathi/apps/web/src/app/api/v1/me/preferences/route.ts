import { cookies } from 'next/headers';
import { z } from 'zod';
import { Locale } from '@saathi/contracts';
import { setPreferences, withTx } from '@saathi/db';
import { LOCALE_COOKIE } from '@/i18n/request';
import { getSession } from '@/server/actor';
import { assertSameOrigin, errorResponse, ok, readJson } from '@/server/api';
import { pool } from '@/server/db';

// Language preference. Works signed out (landing/login) via cookie; saved when signed in.
export async function PATCH(req: Request) {
  const requestId = crypto.randomUUID();
  try {
    assertSameOrigin(req);
    const { locale } = await readJson(req, z.object({ locale: Locale }));
    (await cookies()).set(LOCALE_COOKIE, locale, { sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365 });
    const s = await getSession();
    if (s) await withTx(pool(), { userId: s.user.id }, (db) => setPreferences(db, s.user.id, { locale }));
    return ok({ locale }, requestId);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
