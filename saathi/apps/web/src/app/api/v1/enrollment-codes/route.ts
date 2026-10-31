import { z } from 'zod';
import { createEnrollmentCode } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

// Short-lived one-use code; only its hash is stored and the code is shown once.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const { deviceName } = await readJson(req, z.object({ deviceName: z.string().trim().min(2).max(80) }));
    return actorTx(ctx, (db) => createEnrollmentCode(db, ctx.actor, deviceName));
  },
  { status: 201 },
);
