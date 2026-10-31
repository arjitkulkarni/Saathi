// Entry point for the packaged standalone executable (Node Single Executable Applications).
// Unlike src/index.ts's CLI guard, a SEA binary has no script path in process.argv — the
// `import.meta.url === process.argv[1]` self-check there never matches inside the executable,
// so this file calls run() unconditionally instead. Dev usage (`pnpm dev:agent`) is unaffected;
// it still runs src/index.ts directly via tsx.
//
// process.argv still has the conventional two leading slots in SEA mode (both equal to the
// executable's own path, verified empirically), so user arguments start at index 2, same as a
// normal `node script.js <args>` invocation.
import { parseArgs, run } from './index';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await run(args);
}

// Set exitCode and let Node drain the event loop naturally rather than calling process.exit():
// forcing immediate termination while a fetch's AbortSignal.timeout() handle is still closing
// crashes the packaged executable with a native libuv assertion on Windows.
main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });
