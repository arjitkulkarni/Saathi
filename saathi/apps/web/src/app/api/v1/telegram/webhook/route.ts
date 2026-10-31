import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { SaathiError, type Role } from '@saathi/contracts';
import { aiConfigured, createScamCheck, handleTelegramUpdate, sendTelegramMessage, withTx } from '@saathi/db';
import { renderMsg } from '@saathi/i18n';
import { pool } from '@/server/db';
import { aiConfig, env } from '@/server/env';

function secretOk(given: string | null, expected: string) {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Telegram webhook (build.md Ph12): validates the webhook secret, deduplicates update IDs,
 * links chats with one-use codes and routes linked-chat messages through Ask Saathi.
 * No approvals or other actions are possible from chat.
 */
export async function POST(req: Request) {
  const e = env();
  if (!e.TELEGRAM_BOT_TOKEN || !e.TELEGRAM_WEBHOOK_SECRET) return NextResponse.json({ error: 'not configured' }, { status: 503 });
  if (!secretOk(req.headers.get('x-telegram-bot-api-secret-token'), e.TELEGRAM_WEBHOOK_SECRET)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const update = JSON.parse((await req.text()).slice(0, 64 * 1024));
  const r = await handleTelegramUpdate(pool(), update);
  if (!r) return NextResponse.json({ ok: true });
  let reply = r.reply;
  if (r.report) {
    const rep = r.report;
    try {
      const out = await withTx(pool(), { orgId: rep.orgId, userId: rep.userId }, async (db, client) => {
        const m = await client.query('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 AND status = $3', [rep.orgId, rep.userId, 'active']);
        if (!m.rows[0]) throw new SaathiError('FORBIDDEN', 'not a member');
        const actor = { userId: rep.userId, orgId: rep.orgId, role: m.rows[0].role as Role, sessionCreatedAt: new Date(), name: '' };
        // Telegram submissions never grant consent to forward content to the AI provider
        // (externalProcessingConsent stays false); aiConfigured is reported only for consistency.
        return createScamCheck(db, actor, { text: rep.text, inputKind: 'text', externalProcessingConsent: false, channel: 'telegram' }, { fingerprintSecret: e.SCAM_FINGERPRINT_SECRET, aiConfigured: aiConfigured(aiConfig()), textRetentionHours: 24 * 30 });
      });
      reply = `Saathi checked this message: ${renderMsg({ key: `status.verdict.${out.verdict}`, params: {} }, { locale: 'en', vocabulary: 'generic', timezone: 'UTC' })}. Open Saathi to see why: ${e.APP_ORIGIN}/app/ask/${out.id}`;
    } catch {
      reply = 'Saathi could not check this message right now. Please use the Ask Saathi page.';
    }
  }
  if (reply) await sendTelegramMessage(e.TELEGRAM_BOT_TOKEN, r.chatId, reply).catch(() => undefined);
  return NextResponse.json({ ok: true });
}
