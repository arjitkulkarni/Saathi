import { z } from 'zod';
import { warnCampaign } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

// Explicitly approved internal warning to scoped, deduplicated organization members.
export const POST = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const { recipientUserIds } = await readJson(req, z.object({ recipientUserIds: z.array(z.string().min(1).max(100)).min(1).max(200) }));
  return actorTx(ctx, (db) => warnCampaign(db, ctx.actor, parseId(params.id), recipientUserIds));
});
