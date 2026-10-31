import { z } from 'zod';
import { ActionParams, DEVICE_ACTIONS } from '@saathi/contracts';
import { createPreview } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

// Device action preview using the same domain engine (health fixes use this too).
export const POST = userRoute<{ id: string }>(
  async ({ req, ctx, params }) => {
    const body = await readJson(req, z.object({ actionType: z.enum(DEVICE_ACTIONS), params: ActionParams.default({}) }));
    return actorTx(ctx, (db) => createPreview(db, ctx.actor, { actionType: body.actionType, targetType: 'device', targetId: parseId(params.id), params: body.params }, null));
  },
  { status: 201 },
);
