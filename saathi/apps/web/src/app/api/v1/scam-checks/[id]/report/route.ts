import { reportScamCheck } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

export const POST = userRoute<{ id: string }>(async ({ ctx, params }) => actorTx(ctx, (db) => reportScamCheck(db, ctx.actor, parseId(params.id))));
