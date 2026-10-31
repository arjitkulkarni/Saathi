import { z } from 'zod';
import { getPolicy, updatePolicy } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => getPolicy(db, ctx.actor)));

const Body = z.object({
  autoThrottleEnabled: z.boolean(),
  throttleRatePerMinute: z.number().int().min(1).max(10),
  throttleDurationMinutes: z.number().int().min(5).max(120),
  burstThreshold: z.number().int().min(5).max(500),
  burstWindowSeconds: z.number().int().min(30).max(3600),
  dailyLimit: z.number().int().min(10).max(10000),
  expectedVersion: z.number().int().min(1),
});

// Security policy changes wait for server confirmation; the response carries the saved version.
export const PATCH = userRoute(async ({ req, ctx }) => {
  const body = await readJson(req, Body);
  return actorTx(ctx, (db) => updatePolicy(db, ctx.actor, body));
});
