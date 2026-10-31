import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadRootEnv } from './env';

// Controlled release step (build.md Ph17.3): runs with the migration role only.
export async function runMigrations(url: string) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations') });
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  loadRootEnv();
  const target = process.argv.includes('--test') ? process.env.TEST_DATABASE_URL_DIRECT : process.env.DATABASE_URL_DIRECT;
  if (!target) {
    console.error('DATABASE_URL_DIRECT (or TEST_DATABASE_URL_DIRECT with --test) is required for migrations.');
    process.exit(1);
  }
  runMigrations(target)
    .then(() => console.log('Migrations applied.'))
    .catch((e) => {
      console.error('Migration failed:', e.message);
      process.exit(1);
    });
}
