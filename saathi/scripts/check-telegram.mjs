#!/usr/bin/env node
// Read-only inspection of the Telegram bot and its registered webhook.
// Does NOT change the webhook and does NOT start getUpdates polling.
// Never prints the token, the secret, or the request URL.
//
// Usage:  node scripts/check-telegram.mjs      # from the saathi/ directory
import { loadEnv, callTelegram, validatePublicOrigin, redact, DEFAULT_USERNAME } from './_telegram.mjs';

async function main() {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set in saathi/.env. Save it there privately, then re-run.');
    process.exit(1);
  }
  const expectedUser = (process.env.TELEGRAM_BOT_USERNAME || DEFAULT_USERNAME).trim();
  const ov = validatePublicOrigin(process.env.APP_ORIGIN?.trim());
  const intended = ov.ok ? ov.url : null;

  const me = await callTelegram(token, 'getMe');
  console.log(`Bot:                @${me.username} (id ${me.id})`);
  console.log(`Expected bot:       @${expectedUser} ${me.username?.toLowerCase() === expectedUser.toLowerCase() ? '(match)' : '(MISMATCH)'}`);

  const info = await callTelegram(token, 'getWebhookInfo');
  console.log(`Registered URL:     ${info.url || '(none)'}`);
  console.log(`Intended URL:       ${intended ?? '(APP_ORIGIN is not a public HTTPS origin)'}`);
  if (intended) console.log(`Matches intended:   ${info.url === intended ? 'yes' : 'NO'}`);
  console.log(`Pending updates:    ${info.pending_update_count ?? 0}`);
  console.log(`Allowed updates:    ${JSON.stringify(info.allowed_updates ?? ['(default)'])}`);
  console.log(`Custom certificate: ${info.has_custom_certificate ? 'yes' : 'no'}`);
  console.log(`Max connections:    ${info.max_connections ?? '(default)'}`);
  if (info.last_error_message) {
    const when = info.last_error_date ? ` (at ${new Date(info.last_error_date * 1000).toISOString()})` : '';
    console.log(`Last delivery error: ${redact(info.last_error_message, token)}${when}`);
  }
  console.log('\nRead-only: this script did not change the webhook.');
}

main().catch((e) => {
  console.error(redact(e?.message ?? String(e), process.env.TELEGRAM_BOT_TOKEN));
  process.exit(1);
});
