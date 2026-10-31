import { listPeople } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listPeople(db, ctx.actor)));
