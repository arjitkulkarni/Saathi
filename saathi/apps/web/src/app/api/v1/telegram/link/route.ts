import { SaathiError } from '@saathi/contracts';
import { createTelegramLinkCode, telegramStatus, unlinkTelegram } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';
import { env, integrationsStatus } from '@/server/env';

export const GET = userRoute(async ({ ctx }) => ({ ...(await actorTx(ctx, (db) => telegramStatus(db, ctx.actor))), configured: integrationsStatus().telegram }));

export const POST = userRoute(async ({ ctx }) => {
  if (!integrationsStatus().telegram) throw new SaathiError('DEPENDENCY_UNAVAILABLE', 'Telegram is not configured on this Saathi server.');
  return actorTx(ctx, (db) => createTelegramLinkCode(db, ctx.actor, env().TELEGRAM_BOT_USERNAME));
});

export const DELETE = userRoute(async ({ ctx }) => {
  await actorTx(ctx, (db) => unlinkTelegram(db, ctx.actor));
  return { linked: false };
});
