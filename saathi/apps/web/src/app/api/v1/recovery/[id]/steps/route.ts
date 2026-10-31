import { z } from 'zod';
import { hashPin, runRecoveryStep } from '@saathi/db';
import { actorTx, requireFreshAuth } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

const Body = z.object({
  step: z.enum(['verify_person', 'address_credentials', 'review_findings', 'revoke_old_session', 'issue_fresh_session', 'verify_old_token_rejected', 'restore_device_policy', 'verify_device_state', 'finish']),
  confirm: z.boolean().optional(),
  note: z.string().max(300).optional(),
  newPin: z.string().regex(/^\d{6}$/).optional(),
});

// The server checks machine-verifiable steps itself; attested steps record who confirmed.
export const POST = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  requireFreshAuth(ctx);
  const { step, ...input } = await readJson(req, Body);
  return actorTx(ctx, (db) => runRecoveryStep(db, ctx.actor, parseId(params.id), step, input, { hashPin }));
});
