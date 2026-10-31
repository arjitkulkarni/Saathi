#!/usr/bin/env node
// Bundle the standalone offline verifier into one browser script.
// Output: apps/web/public/verifier/saathi-verifier.js (gitignored). The /verify/standalone
// route inlines it, with the pinned public evidence keys, into a downloadable HTML file.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps', 'web');

/** esbuild is not a direct dependency; resolve the copy shipped with tsx. */
async function loadEsbuild() {
  const req = createRequire(join(root, 'package.json'));
  try {
    return await import(pathToFileURL(req.resolve('esbuild')).href);
  } catch {
    const tsxReq = createRequire(req.resolve('tsx/package.json'));
    return await import(pathToFileURL(tsxReq.resolve('esbuild')).href);
  }
}

export async function buildVerifier() {
  const esbuild = await loadEsbuild();
  const r = await esbuild.build({
    entryPoints: [join(web, 'src', 'app', 'verify', 'standalone-entry.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: ['es2020'],
    minify: true,
    legalComments: 'none',
    absWorkingDir: web,
    nodePaths: [join(web, 'node_modules'), join(root, 'node_modules')],
  });
  const js = r.outputFiles[0].text;
  const outDir = join(web, 'public', 'verifier');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'saathi-verifier.js'), js);
  return js;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildVerifier()
    .then((js) => console.log(`Built standalone verifier (${(js.length / 1024).toFixed(0)} KB).`))
    .catch((e) => {
      console.error('Verifier build failed:', e.message);
      process.exit(1);
    });
}
