import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

/** Load saathi/.env for CLI tools (migrate, seed, tests). Next.js loads env itself. */
export function loadRootEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const file = join(root, '.env');
  if (existsSync(file)) config({ path: file, quiet: true });
  return root;
}
