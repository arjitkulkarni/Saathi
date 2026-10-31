import 'server-only';
import { SaathiError } from '@saathi/contracts';
import { resolveAppSession } from '@saathi/db';
import { pool } from './db';

/** Records-app bearer session (separate from the console's Better Auth session, D-014). */
export async function recordsSession(req: Request) {
  const h = req.headers.get('authorization') ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  const s = await resolveAppSession(pool(), token);
  if (!s) throw new SaathiError('UNAUTHENTICATED', 'Sign in to the records workspace.');
  return s;
}

// Small in-process limiter for records sign-in attempts (reference app only).
const attempts = new Map<string, number[]>();
export function limitSignIn(key: string, max = 8, windowMs = 60_000) {
  const now = Date.now();
  const list = (attempts.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new SaathiError('RATE_LIMITED', 'Too many sign-in attempts. Wait a minute and try again.');
  list.push(now);
  attempts.set(key, list);
}
