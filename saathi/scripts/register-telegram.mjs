#!/usr/bin/env node
// Register the Telegram webhook for the existing Saathi bot (@v_saathi_bot).
//
// Reads TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET and APP_ORIGIN
// from the git-ignored saathi/.env. It verifies the token belongs to the expected bot,
// inspects the current webhook, then calls setWebhook with the verified URL, the secret
// header token and allowed_updates:["message"]. Pending updates are preserved.
//
// It never prints the token, the secret, or the request URL. Re-running is safe.
//
// Usage:  node scripts/register-telegram.mjs            # from the saathi/ directory
//         node scripts/register-telegram.mjs --force    # replace a webhook on a different host
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ENV_PATH, loadEnv, callTelegram, validatePublicOrigin, redact, DEFAULT_USERNAME } from './_telegram.mjs';

const force = process.argv.includes('--force');

/** Return the configured webhook secret, generating and persisting one privately if absent. */
function ensureSecret() {
  const existing = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (existing) return existing;
  const secret = randomBytes(32).toString('hex');
  let text = readFileSync(ENV_PATH, 'utf8');
  if (/^TELEGRAM_WEBHOOK_SECRET=.*$/m.test(text)) text = text.replace(/^TELEGRAM_WEBHOOK_SECRET=.*$/m, `TELEGRAM_WEBHOOK_SECRET=${secret}`);
  else text = (text.endsWith('\n') ? text : text + '\n') + `TELEGRAM_WEBHOOK_SECRET=${secret}\n`;
  writeFileSync(ENV_PATH, text, { mode: 0o600 });
  process.env.TELEGRAM_WEBHOOK_SECRET = secret;
  console.log('Generated a new TELEGRAM_WEBHOOK_SECRET and stored it in saathi/.env (value not shown).');
  console.log('Restart the web app so it serves with the new secret, or the webhook will be rejected.');
  return secret;
}

async function main() {
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const expectedUser = (process.env.TELEGRAM_BOT_USERNAME || DEFAULT_USERNAME).trim();
  const ov = validatePublicOrigin(process.env.APP_ORIGIN?.trim());

  const problems = [];
  if (!token) problems.push('TELEGRAM_BOT_TOKEN is not set. Save the BotFather replacement token in saathi/.env as TELEGRAM_BOT_TOKEN=… (do not paste it in chat).');
  if (!ov.ok) problems.push(`${ov.reason} Set APP_ORIGIN in saathi/.env to your public HTTPS origin (or an HTTPS tunnel URL).`);
  if (problems.length) {
    console.error('Cannot register the webhook yet:\n - ' + problems.join('\n - '));
    process.exit(1);
  }

  const webhookUrl = ov.url;
  const secret = ensureSecret();

  // A. Confirm the token identifies the expected bot.
  const me = await callTelegram(token, 'getMe');
  if ((me.username || '').toLowerCase() !== expectedUser.toLowerCase()) {
    console.error(`This token identifies @${me.username}, but @${expectedUser} was expected. Aborting without any change.`);
    process.exit(1);
  }
  console.log(`Token verified: @${me.username} (id ${me.id}).`);

  // B. Inspect the current webhook before changing anything.
  const before = await callTelegram(token, 'getWebhookInfo');
  const current = before.url || '';
  if (current === webhookUrl) {
    console.log('Webhook already points to the intended URL; re-registering will refresh it safely.');
  } else if (current) {
    let sameHost = false;
    try {
      sameHost = new URL(current).host === new URL(webhookUrl).host;
    } catch {
      /* treat unparseable as different */
    }
    console.log(`A webhook is already set for a ${sameHost ? 'matching' : 'DIFFERENT'} host: ${current}`);
    if (!sameHost && !force) {
      console.error(`Intended URL is ${webhookUrl}.\nIf the existing webhook is an active deployment you do not want to disrupt, stop here.\nRe-run with --force to replace it.`);
      process.exit(2);
    }
    if (!sameHost) console.log('Replacing a webhook on a different host (--force was given).');
  } else {
    console.log('No webhook is currently set.');
  }

  // C. Register. allowed_updates is limited to messages; pending updates are preserved.
  await callTelegram(token, 'setWebhook', { url: webhookUrl, secret_token: secret, allowed_updates: ['message'] });
  console.log('setWebhook reported ok.');

  // D. Verify and print only safe diagnostics.
  const after = await callTelegram(token, 'getWebhookInfo');
  console.log('\n--- Webhook status ---');
  console.log(`Bot:                @${me.username}`);
  console.log(`Registered URL:     ${after.url || '(none)'}`);
  console.log(`Matches intended:   ${after.url === webhookUrl ? 'yes' : 'NO'}`);
  console.log(`Pending updates:    ${after.pending_update_count ?? 0}`);
  console.log(`Allowed updates:    ${JSON.stringify(after.allowed_updates ?? ['(default)'])}`);
  console.log(`Custom certificate: ${after.has_custom_certificate ? 'yes' : 'no'}`);
  if (after.last_error_message) {
    const when = after.last_error_date ? ` (at ${new Date(after.last_error_date * 1000).toISOString()})` : '';
    console.log(`Last delivery error: ${redact(after.last_error_message, token)}${when}`);
  }
  console.log('\nNote: a successful setWebhook does NOT prove end-to-end delivery. Run the manual link test to confirm.');
}

main().catch((e) => {
  console.error(redact(e?.message ?? String(e), process.env.TELEGRAM_BOT_TOKEN));
  process.exit(1);
});
