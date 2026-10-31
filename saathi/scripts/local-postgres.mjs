#!/usr/bin/env node
// Local development PostgreSQL cluster for Saathi.
//
// Neon is the specified hosted database (build.md §2). When Neon credentials are not
// available, this script runs a private PostgreSQL cluster inside `.local/pgdata` on its
// own port so that transaction, RLS and concurrency tests still run against real
// PostgreSQL. It never touches other PostgreSQL services on the machine.
//
// Usage: node scripts/local-postgres.mjs init|start|stop|status
import { spawnSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const localDir = join(root, '.local');
const dataDir = join(localDir, 'pgdata');
const logFile = join(localDir, 'postgres.log');
const credsFile = join(localDir, 'pg-credentials.json');
const port = Number(process.env.LOCAL_PG_PORT ?? 55432);

function findBin() {
  const candidates = [
    process.env.PG_BIN,
    'C:/Program Files/PostgreSQL/18/bin',
    'C:/Program Files/PostgreSQL/17/bin',
    'C:/Program Files/PostgreSQL/16/bin',
    '/usr/lib/postgresql/18/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
  ].filter(Boolean);
  const exe = process.platform === 'win32' ? '.exe' : '';
  for (const c of candidates) if (existsSync(join(c, `initdb${exe}`))) return { dir: c, exe };
  throw new Error('PostgreSQL binaries not found. Set PG_BIN to the directory containing initdb and pg_ctl.');
}

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...opts });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) {
    // Do not echo arguments: they can contain role passwords.
    throw new Error(`${bin.split(/[\\/]/).pop()} failed (exit ${r.status}):\n${r.stderr}`);
  }
  return r;
}

function creds() {
  if (existsSync(credsFile)) return JSON.parse(readFileSync(credsFile, 'utf8'));
  const c = {
    superuser: 'postgres',
    superPassword: randomBytes(18).toString('base64url'),
    ownerPassword: randomBytes(18).toString('base64url'),
    appPassword: randomBytes(18).toString('base64url'),
    workerPassword: randomBytes(18).toString('base64url'),
  };
  mkdirSync(localDir, { recursive: true });
  writeFileSync(credsFile, JSON.stringify(c, null, 2), { mode: 0o600 });
  return c;
}

function psql(bin, c, db, sql) {
  return run(join(bin.dir, `psql${bin.exe}`), ['-h', '127.0.0.1', '-p', String(port), '-U', c.superuser, '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, PGPASSWORD: c.superPassword },
  });
}

function isRunning(bin) {
  const r = run(join(bin.dir, `pg_ctl${bin.exe}`), ['status', '-D', dataDir], { allowFail: true });
  return r.status === 0;
}

function start(bin) {
  if (isRunning(bin)) return console.log(`PostgreSQL already running on port ${port}`);
  // pg_ctl -w waits for startup; spawn detached so this script can exit.
  // stdio must be ignored: the postmaster inherits pipe handles and would keep spawnSync waiting.
  run(join(bin.dir, `pg_ctl${bin.exe}`), ['start', '-w', '-D', dataDir, '-l', logFile, '-o', `-p ${port} -c listen_addresses=127.0.0.1`], { stdio: 'ignore' });
  console.log(`PostgreSQL started on port ${port}`);
}

function init() {
  const bin = findBin();
  const c = creds();
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    mkdirSync(localDir, { recursive: true });
    const pw = join(localDir, 'superpw.txt');
    writeFileSync(pw, c.superPassword, { mode: 0o600 });
    run(join(bin.dir, `initdb${bin.exe}`), ['-D', dataDir, '-U', c.superuser, '--pwfile', pw, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C']);
    rmSync(pw);
    console.log(`Initialised cluster in ${dataDir}`);
  }
  start(bin);
  // Roles: owner runs migrations and owns tables; app and worker are runtime roles
  // without BYPASSRLS (build.md §4).
  const roleSql = (name, pass) => `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${name}') THEN
      CREATE ROLE ${name} LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
    ELSE ALTER ROLE ${name} LOGIN PASSWORD '${pass}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS; END IF; END $$;`;
  psql(bin, c, 'postgres', roleSql('saathi_owner', c.ownerPassword));
  psql(bin, c, 'postgres', roleSql('saathi_app', c.appPassword));
  psql(bin, c, 'postgres', roleSql('saathi_worker', c.workerPassword));
  for (const db of ['saathi_dev', 'saathi_test']) {
    const exists = psql(bin, c, 'postgres', `SELECT 1 FROM pg_database WHERE datname='${db}'`).stdout.includes('(1 row)');
    if (!exists) psql(bin, c, 'postgres', `CREATE DATABASE ${db} OWNER saathi_owner`);
    psql(bin, c, db, `REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT ALL ON SCHEMA public TO saathi_owner; GRANT USAGE ON SCHEMA public TO saathi_app, saathi_worker;`);
  }
  const url = (role, pass, db) => `postgres://${role}:${encodeURIComponent(pass)}@127.0.0.1:${port}/${db}`;
  console.log('\nAdd these to saathi/.env (local development only):\n');
  console.log(`DATABASE_URL=${url('saathi_app', c.appPassword, 'saathi_dev')}`);
  console.log(`DATABASE_URL_WORKER=${url('saathi_worker', c.workerPassword, 'saathi_dev')}`);
  console.log(`DATABASE_URL_DIRECT=${url('saathi_owner', c.ownerPassword, 'saathi_dev')}`);
  console.log(`TEST_DATABASE_URL=${url('saathi_app', c.appPassword, 'saathi_test')}`);
  console.log(`TEST_DATABASE_URL_WORKER=${url('saathi_worker', c.workerPassword, 'saathi_test')}`);
  console.log(`TEST_DATABASE_URL_DIRECT=${url('saathi_owner', c.ownerPassword, 'saathi_test')}`);
}

const cmd = process.argv[2];
try {
  if (cmd === 'init') init();
  else if (cmd === 'start') start(findBin());
  else if (cmd === 'stop') run(join(findBin().dir, `pg_ctl${findBin().exe}`), ['stop', '-D', dataDir, '-m', 'fast']);
  else if (cmd === 'status') console.log(isRunning(findBin()) ? `running on ${port}` : 'stopped');
  else console.log('usage: local-postgres.mjs init|start|stop|status');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
void spawn;
