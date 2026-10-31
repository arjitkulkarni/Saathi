import { z } from 'zod';
import { aiAvailable, createScamCheck, listOwnScamChecks } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { readJson, userRoute } from '@/server/api';
import { env } from '@/server/env';

export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listOwnScamChecks(db, ctx.actor)));

// The client sends the text the user reviewed (and optionally redacted). Screenshots are
// extracted separately (/scam-checks/extract) and only their reviewed text arrives here.
export const POST = userRoute(
  async ({ req, ctx }) => {
    const body = await readJson(
      req,
      z.object({
        text: z.string().max(5000),
        inputKind: z.enum(['text', 'image']).default('text'),
        attachmentRef: z.string().regex(/^scam\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/).nullable().optional(),
        externalProcessingConsent: z.boolean().default(false),
      }),
      16 * 1024,
    );
    const e = env();
    if (body.attachmentRef && !body.attachmentRef.startsWith(`scam/${ctx.actor.orgId}/`)) body.attachmentRef = null;
    return actorTx(ctx, (db) =>
      createScamCheck(
        db,
        ctx.actor,
        { ...body, attachmentExpiresAt: body.attachmentRef ? new Date(Date.now() + 24 * 3600 * 1000) : null },
        { fingerprintSecret: e.SCAM_FINGERPRINT_SECRET, aiConfigured: aiAvailable({ apiKey: e.ANTHROPIC_API_KEY, model: e.AI_MODEL }), textRetentionHours: 24 * 30 },
      ),
    );
  },
  { status: 201 },
);
