import { startRecovery } from '@saathi/db';
import { actorTx, requireFreshAuth } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

export const POST = userRoute<{ id: string }>(
  async ({ ctx, params }) => {
    requireFreshAuth(ctx);
    return actorTx(ctx, (db) => startRecovery(db, ctx.actor, parseId(params.id)));
  },
  { status: 201 },
);
