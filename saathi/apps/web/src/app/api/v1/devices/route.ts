import { listDevices } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listDevices(db, ctx.actor)));
