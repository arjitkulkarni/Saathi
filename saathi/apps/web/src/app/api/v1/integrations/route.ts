import { z } from 'zod';
import { addIntegration, listIntegrations } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listIntegrations(db, ctx.actor)));

// Owners record read-only or unconnected sources so coverage gaps are explicit.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const body = await readJson(req, z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(['read_only', 'unconnected']) }));
    return actorTx(ctx, (db) => addIntegration(db, ctx.actor, body));
  },
  { status: 201 },
);
