import 'server-only';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { env } from './env';
import { pool } from './db';

// Better Auth with database sessions (build.md Ph02). The cookie cache stays disabled so a
// revoked session or role change is seen on the next request. Authorization lives in Saathi.
let instance: ReturnType<typeof create> | null = null;
function create() {
  const e = env();
  return betterAuth({
    database: pool(),
    secret: e.BETTER_AUTH_SECRET,
    baseURL: e.BETTER_AUTH_URL,
    trustedOrigins: [e.APP_ORIGIN],
    emailAndPassword: { enabled: true, minPasswordLength: 10, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: { useSecureCookies: e.APP_ORIGIN.startsWith('https://') },
    plugins: [nextCookies()],
  });
}
export function auth() {
  if (!instance) instance = create();
  return instance;
}
