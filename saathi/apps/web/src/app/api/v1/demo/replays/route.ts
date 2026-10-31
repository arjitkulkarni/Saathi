import { z } from 'zod';
import { runReplay } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';
import { assertDemo } from '@/server/demo';

// Synthetic, labelled replay events; never enabled for non-demo organizations.
export const POST = userRoute(
  async ({ req, ctx }) => {
    assertDemo(ctx);
    const { kind } = await readJson(req, z.object({ kind: z.enum(['normal_day', 'device_warning', 'slow_extraction']) }));
    return actorTx(ctx, (db) => runReplay(db, ctx.actor, kind));
  },
  { status: 202 },
);
