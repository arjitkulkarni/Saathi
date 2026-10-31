import { z } from 'zod';
import { listIncidents } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

const Query = z.object({
  tab: z.enum(['needs_attention', 'investigating', 'recovering', 'all']).default('needs_attention'),
  cursor: z.string().max(200).optional(),
});

export const GET = userRoute(async ({ req, ctx }) => {
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));
  return actorTx(ctx, (db) => listIncidents(db, ctx.actor, { tab: q.tab, cursor: q.cursor ?? null }));
});
