import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { evidenceKeys } from '@/server/env';

const run = promisify(execFile);
let cachedJs: string | null = null;

/** Prebuilt by `pnpm build:verifier` (prebuild); built on demand if missing, then cached. */
async function verifierJs(): Promise<string> {
  if (cachedJs) return cachedJs;
  const file = join(process.cwd(), 'public', 'verifier', 'saathi-verifier.js');
  try {
    cachedJs = await readFile(file, 'utf8');
  } catch {
    await run(process.execPath, [join(process.cwd(), '..', '..', 'scripts', 'build-verifier.mjs')], { timeout: 60_000 });
    cachedJs = await readFile(file, 'utf8');
  }
  return cachedJs;
}

const CSS = `body{margin:0;background:#f8f6f2;color:#242420;font:16px/1.6 system-ui,"Segoe UI",sans-serif}main{max-width:760px;margin:0 auto;padding:32px 16px}h1{font-size:28px;margin:0 0 8px}h2{font-size:18px;margin-top:32px}.muted{color:#60605a}label{display:block;margin-top:14px;font-weight:600}input{display:block;width:100%;box-sizing:border-box;min-height:44px;margin-top:6px;padding:8px;border:1px solid #8a877f;border-radius:10px;background:#fff;font:inherit}fieldset{margin-top:18px;border:1px solid #e4e0d9;border-radius:12px;padding:12px 16px}button{margin-top:18px;min-height:48px;padding:0 20px;border:0;border-radius:11px;background:#be3e24;color:#fff;font:inherit;font-weight:600;cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #182e54;outline-offset:3px}ol{padding:0;list-style:none}ol>li{background:#fff;border:1px solid #e4e0d9;border-radius:14px;padding:12px 16px;margin-top:10px}.ok{color:#176344}.bad{color:#a52b28}.banner{font-weight:600;margin-top:20px}code{display:block;overflow-wrap:anywhere;font-size:12px;background:#f1efeb;padding:4px 8px;border-radius:8px}`;

// Self-contained offline verifier with pinned public keys (no network access needed).
export async function GET() {
  const js = (await verifierJs()).replace(/<\/script/gi, '<\\/script');
  const keys = JSON.stringify(evidenceKeys().map(({ keyId, publicKeyHex }) => ({ keyId, publicKeyHex }))).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>Saathi standalone receipt verifier</title><style>${CSS}</style></head>
<body><noscript>JavaScript is required to verify files locally.</noscript>
<script>window.SAATHI_TRUSTED_KEYS=${keys};</script>
<script>${js}</script></body></html>`;
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': 'attachment; filename="saathi-verifier.html"',
      'Cache-Control': 'no-store',
    },
  });
}
