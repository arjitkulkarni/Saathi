#!/usr/bin/env node
// Build a standalone Windows agent executable (no Node.js install needed on the target
// machine) using Node's Single Executable Applications support (--experimental-sea-config +
// postject; this Node build does not ship the newer --build-sea shortcut). Windows-only build
// step: it embeds a copy of the locally running node.exe, so it must run on Windows to produce
// a usable Windows binary. Not run during the Next.js (Vercel/Linux) build; run manually and
// publish the resulting .exe separately (see docs/agent.md).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.platform !== 'win32') {
  console.error('This must be run on Windows: it embeds the local node.exe into the output.');
  process.exit(1);
}

const SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const agentDir = join(root, 'apps', 'agent');
const distDir = join(agentDir, 'dist');
const bundlePath = join(distDir, 'agent-bundle.cjs');
const blobPath = join(distDir, 'agent-sea.blob');
const seaConfigPath = join(distDir, 'sea-config.json');
const outExe = join(distDir, 'saathi-agent-windows-x64.exe');

async function loadEsbuild() {
  const { createRequire } = await import('node:module');
  const req = createRequire(join(root, 'package.json'));
  try {
    return await import(pathToFileURL(req.resolve('esbuild')).href);
  } catch {
    const tsxReq = createRequire(req.resolve('tsx/package.json'));
    return await import(pathToFileURL(tsxReq.resolve('esbuild')).href);
  }
}

function hasSigntool() {
  try {
    execFileSync('where', ['signtool'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });

  console.log('Bundling apps/agent/src/sea-entry.ts into a single CommonJS file...');
  const esbuild = await loadEsbuild();
  await esbuild.build({
    entryPoints: [join(agentDir, 'src', 'sea-entry.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: ['node22'],
    logOverride: { 'empty-import-meta': 'silent' }, // index.ts's dev-only self-check is unreachable via sea-entry.ts
  });

  writeFileSync(seaConfigPath, JSON.stringify({ main: bundlePath, output: blobPath, disableExperimentalSEAWarning: true }, null, 2));

  console.log('Generating the SEA preparation blob...');
  execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], { stdio: 'inherit', cwd: distDir });
  if (!existsSync(blobPath)) throw new Error('Blob generation finished but the expected .blob file was not produced.');

  console.log('Copying node.exe...');
  copyFileSync(process.execPath, outExe);

  if (hasSigntool()) {
    console.log('Removing the existing signature from the copied node.exe (signtool found)...');
    execFileSync('signtool', ['remove', '/s', outExe], { stdio: 'inherit' });
  } else {
    console.log('signtool not found; skipping signature removal (postject may print a signature warning, which is expected unsigned).');
  }

  console.log('Injecting the blob with postject...');
  const { createRequire } = await import('node:module');
  const postjectCli = createRequire(join(agentDir, 'package.json')).resolve('postject/dist/cli.js');
  execFileSync(process.execPath, [postjectCli, outExe, 'NODE_SEA_BLOB', blobPath, '--sentinel-fuse', SENTINEL_FUSE], { stdio: 'inherit' });

  if (!existsSync(outExe)) throw new Error('Build finished but the expected .exe was not produced.');
  const { size } = statSync(outExe);
  console.log(`Built ${outExe} (${(size / (1024 * 1024)).toFixed(1)} MB).`);
  console.log('Unsigned: Windows SmartScreen will warn on first run. Sign with signtool for a cleaner install experience.');
}

main().catch((e) => {
  console.error('Agent exe build failed:', e.message);
  process.exit(1);
});
