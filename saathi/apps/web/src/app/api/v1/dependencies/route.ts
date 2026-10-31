import { z } from 'zod';
import { addDependency, listDependencies } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listDependencies(db, ctx.actor)));

// Owner declarations, recorded as such; never treated as discovered truth.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const body = await readJson(
      req,
      z.object({
        kind: z.enum(['workstation_runs', 'shared_account', 'app_status', 'other']),
        description: z.string().trim().min(5).max(300),
        confidence: z.enum(['high', 'medium', 'low', 'unknown']),
        subjectIds: z.array(z.string().uuid()).max(20).optional(),
        deviceIds: z.array(z.string().uuid()).max(20).optional(),
        integrationIds: z.array(z.string().uuid()).max(20).optional(),
      }),
    );
    return actorTx(ctx, (db) => addDependency(db, ctx.actor, body));
  },
  { status: 201 },
);
