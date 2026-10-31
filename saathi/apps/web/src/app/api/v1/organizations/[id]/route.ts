import { z } from 'zod';
import { Locale, OrgType, SaathiError, Vocabulary } from '@saathi/contracts';
import { updateOrganization } from '@saathi/db';
import { actorTx, type ActorContext } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

const Patch = z
  .object({
    name: z.string().trim().min(2).max(120),
    orgType: OrgType,
    locale: Locale,
    timezone: z.string().min(3).max(60),
    workStart: z.string().regex(/^\d{2}:\d{2}$/),
    workEnd: z.string().regex(/^\d{2}:\d{2}$/),
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    vocabulary: Vocabulary,
    recoveryContact: z.string().max(200),
    notificationPrefs: z.record(z.string(), z.union([z.string(), z.boolean()])),
    setupStep: z.enum(['organization', 'people', 'sources', 'automation', 'notifications', 'review', 'done']),
    setupComplete: z.boolean(),
    retention: z.object({ telemetryDays: z.number().int().min(1).max(365), messageImageHours: z.number().int().min(1).max(720), reportDays: z.number().int().min(1).max(3650) }),
  })
  .partial()
  .strict();

// The URL id must be the active (membership-verified) organization; it is never authority.
function sameOrg(ctx: ActorContext, id: string) {
  if (parseId(id) !== ctx.actor.orgId) throw new SaathiError('NOT_FOUND', 'Not found.');
}

export const GET = userRoute<{ id: string }>(async ({ ctx, params }) => {
  sameOrg(ctx, params.id);
  return ctx.dto;
});

export const PATCH = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  sameOrg(ctx, params.id);
  const body = await readJson(req, Patch);
  return actorTx(ctx, (db) => updateOrganization(db, ctx.actor, body));
});
