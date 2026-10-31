import { z } from 'zod';
import { dismissIncident } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

export const POST = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { reason } = await readJson(req, z.object({ reason: z.string().trim().min(5).max(500) }));
  await actorTx(ctx, (db) => dismissIncident(db, ctx.actor, parseId(params.id), reason));
  return { dismissed: true };
});
