import 'server-only';
import { cache } from 'react';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { SaathiError, type ActorDTO } from '@saathi/contracts';
import { landingPath } from '@saathi/domain';
import { listMembershipsForUser, loadActor, getPreferences, withTx, type Actor, type Db } from '@saathi/db';
import { auth } from './auth';
import { pool } from './db';
import { env } from './env';

export const ORG_COOKIE = 'saathi_org';

export type Session = { user: { id: string; name: string; email: string }; createdAt: Date };

/** Fresh database-backed session read; no cookie cache (build.md Ph02.1). */
export const getSession = cache(async (): Promise<Session | null> => {
  const s = await auth().api.getSession({ headers: await headers(), query: { disableCookieCache: true } });
  if (!s) return null;
  return { user: { id: s.user.id, name: s.user.name, email: s.user.email }, createdAt: new Date(s.session.createdAt) };
});

export type ActorContext = { actor: Actor; dto: ActorDTO; session: Session };

/**
 * Resolve the active organization from the selector cookie / saved preference and verify
 * current membership. The cookie is only a selector; membership is the authority.
 */
export const getActorContext = cache(async (): Promise<ActorContext | null | 'no_membership'> => {
  const session = await getSession();
  if (!session) return null;
  const selector = (await cookies()).get(ORG_COOKIE)?.value;
  return withTx(pool(), { userId: session.user.id }, async (db) => {
    const memberships = await listMembershipsForUser(db, session.user.id);
    if (memberships.length === 0) return 'no_membership' as const;
    const prefs = await getPreferences(db, session.user.id);
    const candidates = [selector, prefs?.activeOrgId, memberships[0].orgId].filter(Boolean) as string[];
    const orgId = candidates.find((c) => memberships.some((m) => m.orgId === c))!;
    const r = await loadActor(db, session.user, orgId, session.createdAt);
    return r ? { ...r, session } : ('no_membership' as const);
  });
});

/** For pages: redirect to sign-in (preserving destination) or onboarding when needed. */
export async function requireActorPage(path: string): Promise<ActorContext> {
  const ctx = await getActorContext();
  if (ctx === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (ctx === 'no_membership') redirect('/onboarding');
  return ctx;
}

/** For Route Handlers: throws UNAUTHENTICATED/FORBIDDEN instead of redirecting. */
export async function requireActorApi(): Promise<ActorContext> {
  const ctx = await getActorContext();
  if (ctx === null) throw new SaathiError('UNAUTHENTICATED', 'Sign in to continue.');
  if (ctx === 'no_membership') throw new SaathiError('FORBIDDEN', 'You are not a member of any organization.');
  return ctx;
}

/** Sensitive operations need a sign-in younger than SENSITIVE_AUTH_MAX_AGE_MINUTES (D-016). */
export function requireFreshAuth(ctx: ActorContext) {
  const maxAge = env().SENSITIVE_AUTH_MAX_AGE_MINUTES * 60 * 1000;
  if (Date.now() - ctx.session.createdAt.getTime() > maxAge) throw new SaathiError('UNAUTHENTICATED', 'For your security, sign in again before approving.', { reauth: true });
}

/** Run a tenant-scoped transaction for this actor (RLS context from verified membership). */
export function actorTx<T>(ctx: ActorContext, fn: (db: Db) => Promise<T>) {
  return withTx(pool(), { orgId: ctx.actor.orgId, userId: ctx.actor.userId }, (db) => fn(db));
}

export { landingPath };

/** Page loader that turns domain errors into renderable states instead of throwing. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; code: 'FORBIDDEN' | 'NOT_FOUND' | 'DEPENDENCY_UNAVAILABLE' | 'INTERNAL'; message: string };
export async function load<T>(ctx: ActorContext, fn: (db: Db) => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await actorTx(ctx, fn) };
  } catch (e) {
    if (e instanceof SaathiError) {
      const code = e.code === 'FORBIDDEN' || e.code === 'NOT_FOUND' || e.code === 'DEPENDENCY_UNAVAILABLE' ? e.code : 'INTERNAL';
      return { ok: false, code, message: e.message };
    }
    console.error('page loader failed', e);
    return { ok: false, code: 'INTERNAL', message: 'Unexpected error' };
  }
}
