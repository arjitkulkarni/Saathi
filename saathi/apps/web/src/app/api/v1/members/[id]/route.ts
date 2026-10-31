import { z } from 'zod';
import { Role, SaathiError } from '@saathi/contracts';
import { listMembers, updateMember } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

export const GET = userRoute<{ id: string }>(async ({ ctx, params }) => {
  const id = parseId(params.id);
  const m = (await actorTx(ctx, (db) => listMembers(db, ctx.actor))).find((x) => x.id === id);
  if (!m) throw new SaathiError('NOT_FOUND', 'Member not found.');
  return m;
});

export const PATCH = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readJson(req, z.object({ role: Role.optional(), status: z.enum(['active', 'revoked']).optional() }).strict());
  await actorTx(ctx, (db) => updateMember(db, ctx.actor, parseId(params.id), body));
  return { updated: true };
});
