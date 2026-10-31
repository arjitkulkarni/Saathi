import { z } from 'zod';
import { SaathiError } from '@saathi/contracts';
import { listIntegrations, patchIntegration } from '@saathi/db';
import { actorTx, requireFreshAuth } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

export const GET = userRoute<{ id: string }>(async ({ ctx, params }) => {
  const id = parseId(params.id);
  const i = (await actorTx(ctx, (db) => listIntegrations(db, ctx.actor))).find((x) => x.id === id);
  if (!i) throw new SaathiError('NOT_FOUND', 'Integration not found.');
  return i;
});

// Credentials are write-only: a rotated connector key is returned once and never readable.
export const PATCH = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ name: z.string().trim().min(2).max(80).optional(), action: z.enum(['revoke', 'rotate_connector_key', 'test']).optional() }).strict());
  if (body.action === 'revoke' || body.action === 'rotate_connector_key') requireFreshAuth(ctx);
  return actorTx(ctx, (db) => patchIntegration(db, ctx.actor, parseId(params.id), body));
});
