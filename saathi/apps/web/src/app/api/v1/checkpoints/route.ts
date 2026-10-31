import { listCheckpoints } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listCheckpoints(db, ctx.actor)));
