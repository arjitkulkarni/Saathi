import pg from 'pg';
import { loadRootEnv } from '../../packages/db/src/env';
import { runMigrations } from '../../packages/db/src/migrate';
import { seed } from '../../packages/db/src/seed';

// Real PostgreSQL (TEST_DATABASE_URL_*): migrate, wipe, reseed synthetic data.
export default async function setup() {
  loadRootEnv();
  const direct = process.env.TEST_DATABASE_URL_DIRECT;
  if (!direct || !process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL and TEST_DATABASE_URL_DIRECT are required for integration tests');
  await runMigrations(direct);
  const c = new pg.Client({ connectionString: direct });
  await c.connect();
  const { rows } = await c.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  await c.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await c.end();
  await seed(direct, { quiet: true });
}
