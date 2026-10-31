import { z } from 'zod';
import { createPreview } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

// Session/account restriction or offboarding preview outside an incident.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const body = await readJson(
      req,
      z.object({
        actionType: z.enum(['records.pause_session', 'records.disable_account', 'records.offboard_subject']),
        targetType: z.enum(['session', 'subject']),
        targetId: z.string().uuid(),
      }),
    );
    return actorTx(ctx, (db) => createPreview(db, ctx.actor, { ...body, params: {} }, null));
  },
  { status: 201 },
);
