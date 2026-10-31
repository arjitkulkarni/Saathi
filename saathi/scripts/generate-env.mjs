#!/usr/bin/env node
// Create saathi/.env for local development with freshly generated secrets.
// Never prints secret values. Existing variables in .env are preserved.
//
// Usage: node scripts/generate-env.mjs [--db-env .local/db.env]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const dbEnvArg = process.argv.indexOf('--db-env');
const dbEnvPath = dbEnvArg > 0 ? join(root, process.argv[dbEnvArg + 1]) : join(root, '.local', 'db.env');

function parse(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out.set(m[1], m[2]);
  }
  return out;
}

const existing = existsSync(envPath) ? parse(readFileSync(envPath, 'utf8')) : new Map();
const db = existsSync(dbEnvPath) ? parse(readFileSync(dbEnvPath, 'utf8')) : new Map();

function ed25519() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = privateKey.export({ format: 'jwk' });
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  return { seed: jwk.d, pub };
}
const secret = (n = 32) => randomBytes(n).toString('base64url');

const cmd = existing.has('COMMAND_SIGNING_PRIVATE_KEY') ? null : ed25519();
const evd = existing.has('EVIDENCE_SIGNING_PRIVATE_KEY') ? null : ed25519();

const defaults = [
  ['# --- database (local PostgreSQL; see docs/decisions.md D-004)'],
  ...['DATABASE_URL', 'DATABASE_URL_WORKER', 'DATABASE_URL_DIRECT', 'TEST_DATABASE_URL', 'TEST_DATABASE_URL_WORKER', 'TEST_DATABASE_URL_DIRECT'].map((k) => [k, db.get(k) ?? '']),
  ['# --- web'],
  ['APP_ORIGIN', 'http://localhost:3000'],
  ['BETTER_AUTH_URL', 'http://localhost:3000'],
  ['BETTER_AUTH_SECRET', secret(32)],
  ['DEVICE_SECRET_ENCRYPTION_KEY', secret(32)],
  ['DOWNLOAD_TOKEN_SECRET', secret(32)],
  ['SCAM_FINGERPRINT_SECRET', secret(32)],
  ['DEMO_MODE', 'on'],
  ['# --- worker signing keys (worker secret store only)'],
  ['WORKER_ID', 'worker-local-1'],
  ['COMMAND_SIGNING_KEY_ID', 'cmd-local-1'],
  ['COMMAND_SIGNING_PRIVATE_KEY', cmd?.seed ?? ''],
  ['EVIDENCE_SIGNING_KEY_ID', 'evd-local-1'],
  ['EVIDENCE_SIGNING_PRIVATE_KEY', evd?.seed ?? ''],
  ['# --- public verification keys (safe to distribute)'],
  ['COMMAND_PUBLIC_KEYS', cmd ? JSON.stringify([{ keyId: 'cmd-local-1', publicKeyHex: cmd.pub }]) : ''],
  ['EVIDENCE_PUBLIC_KEYS', evd ? JSON.stringify([{ keyId: 'evd-local-1', publicKeyHex: evd.pub }]) : ''],
  ['# --- anchoring'],
  ['OTS_BACKEND', 'native'],
  ['BITCOIN_VERIFIER', 'none'],
  ['# --- storage'],
  ['OBJECT_STORAGE_DRIVER', 'local'],
  ['OBJECT_STORAGE_LOCAL_DIR', '.local/objects'],
  ['# --- AI (optional; set a provider key and models to enable explanations/OCR)'],
  ['AI_PROVIDER', 'xai'],
  ['XAI_API_KEY', ''],
  ['ANTHROPIC_API_KEY', ''],
  ['AI_MODEL', ''],
  ['AI_VISION_MODEL', ''],
];

const lines = [];
for (const [k, v] of defaults) {
  if (k.startsWith('#')) {
    lines.push(k);
    continue;
  }
  lines.push(`${k}=${existing.has(k) ? existing.get(k) : v}`);
  existing.delete(k);
}
for (const [k, v] of existing) lines.push(`${k}=${v}`);
writeFileSync(envPath, lines.join('\n') + '\n', { mode: 0o600 });
console.log(`Wrote ${envPath} (${lines.filter((l) => !l.startsWith('#')).length} variables; values not printed).`);
