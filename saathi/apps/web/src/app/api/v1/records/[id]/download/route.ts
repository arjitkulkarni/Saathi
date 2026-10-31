import { NextResponse } from 'next/server';
import { RETRYABLE } from '@saathi/contracts';
import { gatewayDecide, withTx } from '@saathi/db';
import { errorResponse, parseId } from '@/server/api';
import { pool } from '@/server/db';
import { recordsSession } from '@/server/records';

/**
 * Protected download (build.md Ph04). Synchronous authorization and atomic budget reservation
 * happen before any content is served. Already delivered bytes cannot be recalled.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const s = await recordsSession(req);
    const recordId = parseId((await ctx.params).id);
    const r = await withTx(pool(), { orgId: s.orgId }, (db) => gatewayDecide(db, s, { capability: 'records.download', recordId }));
    const headers = { 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId, 'X-Saathi-Decision': r.decision };
    if (!r.admitted) {
      const status = r.decision === 'throttle' ? 429 : 403;
      const code = r.decision === 'throttle' ? 'RATE_LIMITED' : 'FORBIDDEN';
      return NextResponse.json(
        { error: { code, message: r.decision === 'throttle' ? 'Downloads are temporarily limited.' : 'Access refused.', retryable: RETRYABLE[code], details: { reason: r.reason, decision: r.decision } }, requestId },
        { status, headers: { ...headers, ...(r.retryAfterSeconds ? { 'Retry-After': String(r.retryAfterSeconds) } : {}) } },
      );
    }
    return NextResponse.json({ data: { record: r.record, decision: r.decision, throttleUntil: r.throttleUntil }, requestId }, { headers });
  } catch (e) {
    // Database unavailable → 503 DEPENDENCY_UNAVAILABLE: fail closed, never serve content.
    return errorResponse(e, requestId);
  }
}
