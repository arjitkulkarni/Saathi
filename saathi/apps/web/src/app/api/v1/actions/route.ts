import { z } from 'zod';
import { IdempotencyKey } from '@saathi/contracts';
import { approvePreview, probeRecordsAction } from '@saathi/db';
import { actorTx, requireFreshAuth } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

/**
 * Approve a stored preview (build.md Ph08). Only previewId + idempotency key are accepted.
 * Records actions are probed right after commit; a durable worker job repeats the probe if
 * this request ends early. The response reports persisted state, never assumed success.
 */
export const POST = userRoute(async ({ req, ctx }) => {
  requireFreshAuth(ctx);
  const { previewId, idempotencyKey } = await readJson(req, z.object({ previewId: z.string().uuid(), idempotencyKey: IdempotencyKey }));
  const r = await actorTx(ctx, (db) => approvePreview(db, ctx.actor, previewId, idempotencyKey));
  let state: string | null = null;
  try {
    state = await actorTx(ctx, (db) => probeRecordsAction(db, ctx.actor.orgId, r.actionId));
  } catch {
    state = null; // the fallback job will probe; the client polls the action
  }
  return { actionId: r.actionId, duplicate: r.duplicate, state };
}, { status: 201 });
