import 'server-only';
import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { RETRYABLE, SaathiError, type ErrorCode } from '@saathi/contracts';
import { requireActorApi, type ActorContext } from './actor';
import { env } from './env';

// Route Handler conventions (build.md §3): {data, requestId} or {error, requestId};
// private/no-store; validated, size-limited JSON; same-origin check on browser mutations.

const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export function ok<T>(data: T, requestId: string, status = 200) {
  return NextResponse.json({ data, requestId, serverTime: new Date().toISOString() }, { status, headers: { ...NO_STORE, 'X-Request-Id': requestId } });
}

export function fail(code: ErrorCode, message: string, requestId: string, details?: Record<string, unknown>) {
  const status = new SaathiError(code, message).status;
  return NextResponse.json({ error: { code, message, retryable: RETRYABLE[code], ...(details ? { details } : {}) }, requestId }, { status, headers: { ...NO_STORE, 'X-Request-Id': requestId } });
}

export function errorResponse(e: unknown, requestId: string) {
  if (e instanceof SaathiError) return fail(e.code, e.message, requestId, e.details);
  if (e instanceof ZodError) return fail('VALIDATION_FAILED', 'Some fields are missing or invalid.', requestId, { issues: e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
  console.error(`[${requestId}]`, e);
  return fail('INTERNAL', 'Something went wrong. Nothing was changed by this request.', requestId);
}

export function assertSameOrigin(req: Request) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  const site = req.headers.get('sec-fetch-site');
  if (origin ? origin !== env().APP_ORIGIN : site && site !== 'same-origin') throw new SaathiError('FORBIDDEN', 'Cross-origin request refused.');
}

export async function readJson<T extends z.ZodType>(req: Request, schema: T, maxBytes = 64 * 1024): Promise<z.infer<T>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new SaathiError('VALIDATION_FAILED', 'Request body is too large.');
  const text = await req.text();
  if (text.length > maxBytes) throw new SaathiError('VALIDATION_FAILED', 'Request body is too large.');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new SaathiError('VALIDATION_FAILED', 'Request body must be JSON.');
  }
  return schema.parse(json);
}

/** Authenticated browser route: actor + same-origin + error mapping. */
export function userRoute<P = Record<string, string>>(handler: (args: { req: Request; ctx: ActorContext; params: P; requestId: string }) => Promise<unknown>, opts: { status?: number } = {}) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    const requestId = randomUUID();
    try {
      assertSameOrigin(req);
      const ctx = await requireActorApi();
      const params = await routeCtx.params;
      const data = await handler({ req, ctx, params, requestId });
      if (data instanceof Response) return data;
      return ok(data, requestId, opts.status);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

/** Unauthenticated route (device, webhook, connector, records app) with its own auth. */
export function openRoute<P = Record<string, string>>(handler: (args: { req: Request; params: P; requestId: string }) => Promise<unknown>) {
  return async (req: Request, routeCtx: { params: Promise<P> }) => {
    const requestId = randomUUID();
    try {
      const params = await routeCtx.params;
      const data = await handler({ req, params, requestId });
      if (data instanceof Response) return data;
      return ok(data, requestId);
    } catch (e) {
      return errorResponse(e, requestId);
    }
  };
}

export const uuidParam = z.string().uuid();
export function parseId(v: string) {
  const r = uuidParam.safeParse(v);
  // Malformed IDs are reported as not found to avoid revealing object existence.
  if (!r.success) throw new SaathiError('NOT_FOUND', 'Not found.');
  return r.data;
}
