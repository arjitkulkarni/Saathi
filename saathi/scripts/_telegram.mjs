// Shared helpers for the Telegram webhook setup scripts.
// Loads the single git-ignored saathi/.env (same file the web app and worker use).
// Never logs the bot token or the request URL (the URL embeds the token).
import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'); // saathi/
export const ENV_PATH = join(ROOT, '.env');
export const WEBHOOK_PATH = '/api/v1/telegram/webhook';
export const DEFAULT_USERNAME = 'v_saathi_bot';
const TIMEOUT_MS = 10_000;

export function loadEnv() {
  loadDotenv({ path: ENV_PATH, quiet: true });
  return process.env;
}

/** Remove anything that looks like a bot token from a string before it is printed. */
export function redact(s, token) {
  let out = String(s ?? '');
  if (token) out = out.split(token).join('***');
  return out.replace(/bot\d{3,}:[A-Za-z0-9_-]+/g, 'bot***').replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '***');
}

/**
 * Call one Telegram Bot API method with a bounded timeout. Returns `result` on success.
 * Throws a sanitized Error otherwise. The request URL (which contains the token) is never logged.
 */
export async function callTelegram(token, method, body) {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new Error(`network error calling ${method}: ${redact(e?.message ?? e, token)}`);
  }
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || !json || json.ok !== true) {
    const desc = json ? `${json.error_code ?? res.status}: ${json.description ?? 'unknown error'}` : `HTTP ${res.status}`;
    throw new Error(`${method} failed (${redact(desc, token)})`);
  }
  return json.result;
}

/** Validate that an origin is a public HTTPS origin Telegram can reach. */
export function validatePublicOrigin(origin) {
  if (!origin) return { ok: false, reason: 'APP_ORIGIN is not set.' };
  let u;
  try {
    u = new URL(origin);
  } catch {
    return { ok: false, reason: 'APP_ORIGIN is not a valid URL.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: `APP_ORIGIN must use HTTPS (got "${u.protocol.replace(':', '')}").` };
  if (u.username || u.password) return { ok: false, reason: 'APP_ORIGIN must not contain embedded credentials.' };
  if (u.search || u.hash) return { ok: false, reason: 'APP_ORIGIN must not contain a query string or fragment.' };
  const host = u.hostname.toLowerCase();
  const isPrivate =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host === '127.0.0.1' ||
    host === '::1' ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host);
  if (isPrivate) return { ok: false, reason: `APP_ORIGIN host "${host}" is localhost or a private-network address; Telegram cannot reach it.` };
  return { ok: true, origin: `${u.protocol}//${u.host}`, url: `${u.protocol}//${u.host}${WEBHOOK_PATH}` };
}
