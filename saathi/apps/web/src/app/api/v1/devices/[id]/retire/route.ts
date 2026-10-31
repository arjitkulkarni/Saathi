import { retireDevice } from '@saathi/db';
import { actorTx, requireFreshAuth } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

export const POST = userRoute<{ id: string }>(async ({ ctx, params }) => {
  requireFreshAuth(ctx);
  await actorTx(ctx, (db) => retireDevice(db, ctx.actor, parseId(params.id)));
  return { retired: true };
});
