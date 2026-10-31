import { getPreview } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

export const GET = userRoute<{ id: string }>(async ({ ctx, params }) => actorTx(ctx, (db) => getPreview(db, ctx.actor, parseId(params.id))));
