import { z } from 'zod';
import { ActionParams, ActionType } from '@saathi/contracts';
import { createPreview } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

const OptionBody = z.object({
  actionType: ActionType,
  targetType: z.enum(['session', 'subject', 'device']),
  targetId: z.string().uuid(),
  params: ActionParams.default({}),
});

// Creates and stores a server-side consequence preview for one of the incident's options.
export const POST = userRoute<{ id: string }>(
  async ({ req, ctx, params }) => {
    const body = await readJson(req, OptionBody);
    return actorTx(ctx, (db) => createPreview(db, ctx.actor, body, parseId(params.id)));
  },
  { status: 201 },
);
