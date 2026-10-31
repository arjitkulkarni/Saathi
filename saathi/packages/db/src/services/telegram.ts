import { randomBytes } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import type pg from 'pg';
import { SaathiError } from '@saathi/contracts';
import { withTx, type Db } from '../client';
import { notifications, telegramLinks, telegramUpdates } from '../schema';
import { recordIntent, requireMembership, sha256, type Actor } from './core';

// Telegram Bot API (build.md Ph12): minimal generic alerts with authenticated deep links.
// Chat linking needs a one-use code; Telegram display names are never treated as identity.
// No approvals happen in chat.

export const LINK_CODE_TTL_MINUTES = 10;

export async function createTelegramLinkCode(db: Db, actor: Actor, botUsername: string | undefined) {
  await requireMembership(db, actor, 'telegram.link');
  const code = randomBytes(6).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60 * 1000);
  await db.insert(telegramLinks).values({ orgId: actor.orgId, userId: actor.userId, codeHash: sha256(code), codeExpiresAt: expiresAt });
  return { code, expiresAt: expiresAt.toISOString(), deepLink: botUsername ? `https://t.me/${botUsername}?start=${code}` : null };
}

export async function unlinkTelegram(db: Db, actor: Actor) {
  await requireMembership(db, actor, 'telegram.link');
  await db.update(telegramLinks).set({ unlinkedAt: new Date() }).where(and(eq(telegramLinks.orgId, actor.orgId), eq(telegramLinks.userId, actor.userId), isNull(telegramLinks.unlinkedAt)));
  await recordIntent(db, actor.orgId, 'telegram.unlinked', { userId: actor.userId });
}

export async function telegramStatus(db: Db, actor: Actor) {
  const [l] = await db.select().from(telegramLinks).where(and(eq(telegramLinks.orgId, actor.orgId), eq(telegramLinks.userId, actor.userId), isNull(telegramLinks.unlinkedAt)));
  return { linked: !!l?.chatId, linkedAt: l?.linkedAt?.toISOString() ?? null };
}

export type TelegramUpdate = { update_id: number; message?: { message_id: number; chat: { id: number; type: string }; text?: string } };

/**
 * Handle a webhook update. The caller has validated X-Telegram-Bot-Api-Secret-Token.
 * Duplicate update IDs are ignored. Returns an optional reply for the chat.
 */
export async function handleTelegramUpdate(pool: pg.Pool, u: TelegramUpdate): Promise<{ chatId: string; reply: string; report?: { orgId: string; userId: string; text: string } } | null> {
  const fresh = await withTx(pool, {}, async (db) => (await db.insert(telegramUpdates).values({ updateId: u.update_id }).onConflictDoNothing().returning()).length > 0);
  if (!fresh || !u.message?.text || u.message.chat.type !== 'private') return null;
  const chatId = String(u.message.chat.id);
  const text = u.message.text.trim();
  const start = text.match(/^\/start\s+([A-Za-z0-9_-]{4,32})$/);
  if (start) {
    const found = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, link_id FROM saathi_telegram_code_lookup($1)', [sha256(start[1])])).rows[0]);
    if (!found) return { chatId, reply: 'This link code is not valid. Generate a new one in Saathi settings.' };
    // A chat can only be actively linked to one Saathi account at a time (DB constraint
    // telegram_links_chat_active_uq). Check first so a chat already linked elsewhere gets a
    // clear reply instead of a silent failure when the unique index rejects the update below.
    const already = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT link_id FROM saathi_telegram_chat_lookup($1)', [chatId])).rows[0]);
    if (already && already.link_id !== found.link_id) return { chatId, reply: 'This Telegram chat is already linked to a different Saathi account. Unlink it there first (Settings → Alerts → Unlink), then try this code again.' };
    let ok: boolean;
    try {
      ok = await withTx(pool, { orgId: found.org_id }, async (db) => {
        const [l] = await db.select().from(telegramLinks).where(eq(telegramLinks.id, found.link_id)).for('update');
        if (!l || l.chatId || !l.codeExpiresAt || l.codeExpiresAt.getTime() < Date.now()) return false;
        await db.update(telegramLinks).set({ unlinkedAt: new Date() }).where(and(eq(telegramLinks.orgId, l.orgId), eq(telegramLinks.userId, l.userId), isNull(telegramLinks.unlinkedAt), eq(telegramLinks.chatId, chatId)));
        await db.update(telegramLinks).set({ chatId, linkedAt: new Date(), codeHash: null, codeExpiresAt: null }).where(eq(telegramLinks.id, l.id));
        await recordIntent(db, l.orgId, 'telegram.linked', { userId: l.userId });
        return true;
      });
    } catch (e) {
      // Race with another chat linking concurrently: the precheck above missed it, so the
      // unique index caught it instead. Same friendly reply, not a crash.
      if ((e as { code?: string }).code === '23505') return { chatId, reply: 'This Telegram chat is already linked to a different Saathi account. Unlink it there first (Settings → Alerts → Unlink), then try this code again.' };
      throw e;
    }
    return { chatId, reply: ok ? 'Linked. Saathi will send short alerts here. Open the link in each alert and sign in to review.' : 'This link code has expired or was already used.' };
  }
  const link = await withTx(pool, {}, async (_db, client) => (await client.query('SELECT org_id, user_id, link_id FROM saathi_telegram_chat_lookup($1)', [chatId])).rows[0]);
  if (!link) return { chatId, reply: 'This chat is not linked to Saathi. Use the link code from Saathi settings.' };
  if (text === '/unlink') {
    await withTx(pool, { orgId: link.org_id }, async (db) => {
      await db.update(telegramLinks).set({ unlinkedAt: new Date() }).where(eq(telegramLinks.id, link.link_id));
      await recordIntent(db, link.org_id, 'telegram.unlinked', { userId: link.user_id, via: 'chat' });
    });
    return { chatId, reply: 'Unlinked. You will not receive Saathi alerts here.' };
  }
  // Any other text from a linked chat is a staff report through the Ask Saathi pipeline.
  return { chatId, reply: '', report: { orgId: link.org_id, userId: link.user_id, text: text.slice(0, 5000) } };
}

export async function sendTelegramMessage(token: string, chatId: string, text: string, fetchImpl: typeof fetch = fetch) {
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Telegram API returned HTTP ${res.status}`);
}

/** Deliver one notification with retries reusing its identity; record honest status. */
export async function deliverNotification(db: Db, orgId: string, notificationId: string, cfg: { token?: string; appOrigin: string; render: (key: string, params: Record<string, unknown>) => string }) {
  const [n] = await db.select().from(notifications).where(and(eq(notifications.orgId, orgId), eq(notifications.id, notificationId))).for('update');
  if (!n || n.status === 'sent') return 'skipped';
  if (!cfg.token) {
    await db.update(notifications).set({ status: 'unavailable', lastError: 'Telegram bot token is not configured.' }).where(eq(notifications.id, n.id));
    return 'unavailable';
  }
  const [link] = await db.select().from(telegramLinks).where(and(eq(telegramLinks.orgId, orgId), eq(telegramLinks.userId, n.userId), isNull(telegramLinks.unlinkedAt)));
  if (!link?.chatId) {
    await db.update(notifications).set({ status: 'not_linked', lastError: 'Chat unlinked before delivery.' }).where(eq(notifications.id, n.id));
    return 'not_linked';
  }
  const t = n.text as { key: string; params: Record<string, unknown> };
  const text = `${cfg.render(t.key, t.params)}\n${cfg.appOrigin}${n.linkPath ?? '/app/overview'}`;
  try {
    await sendTelegramMessage(cfg.token, link.chatId, text);
    await db.update(notifications).set({ status: 'sent', sentAt: new Date(), attempts: n.attempts + 1, lastError: null }).where(eq(notifications.id, n.id));
    return 'sent';
  } catch (e) {
    // Record the failure (committed by the caller); the worker then retries with backoff.
    await db.update(notifications).set({ status: 'failed', attempts: n.attempts + 1, lastError: (e as Error).message }).where(eq(notifications.id, n.id));
    return 'failed';
  }
}
