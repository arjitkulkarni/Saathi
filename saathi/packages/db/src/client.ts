import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { SaathiError } from '@saathi/contracts';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

/**
 * Throw from inside a transaction to COMMIT the work done so far (e.g. an audit record of a
 * rejected approval) and then surface `inner` to the caller.
 */
export class CommitThenThrow extends Error {
  constructor(public readonly inner: Error) {
    super(inner.message);
  }
}
export type TxContext = { orgId?: string | null; userId?: string | null };

const pools = new Map<string, pg.Pool>();

/** Small pools; one checked-out client per transaction (build.md Ph01.2). */
export function getPool(url: string, max = 8): pg.Pool {
  let p = pools.get(url);
  if (!p) {
    p = new pg.Pool({ connectionString: url, max, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    p.on('error', () => {
      /* idle client errors are surfaced on next use */
    });
    pools.set(url, p);
  }
  return p;
}

export async function closePools() {
  await Promise.all([...pools.values()].map((p) => p.end().catch(() => undefined)));
  pools.clear();
}

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', '57P01', '57P03', '08001', '08006', '08003', '53300']);

export function isConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return !!err && (CONNECTION_ERROR_CODES.has(err.code ?? '') || /timeout exceeded when trying to connect|Connection terminated/i.test(err.message ?? ''));
}

/**
 * Run `fn` in one interactive transaction on a single checked-out client, with
 * transaction-local tenant context for RLS. Tenant context must come from an
 * authenticated membership (or a narrow resolver), never from client input alone.
 */
export async function withTx<T>(pool: pg.Pool, ctx: TxContext, fn: (db: Db, client: pg.PoolClient) => Promise<T>, opts: { isolation?: 'read committed' | 'repeatable read' | 'serializable' } = {}): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (e) {
    throw new SaathiError('DEPENDENCY_UNAVAILABLE', 'The database is temporarily unavailable.', { cause: (e as Error).message });
  }
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${(opts.isolation ?? 'read committed').toUpperCase()}`);
    await client.query("SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)", [ctx.orgId ?? '', ctx.userId ?? '']);
    const db = drizzle(client, { schema });
    const result = await fn(db, client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    if (e instanceof CommitThenThrow) {
      await client.query('COMMIT');
      throw e.inner;
    }
    await client.query('ROLLBACK').catch(() => undefined);
    if (isConnectionError(e)) throw new SaathiError('DEPENDENCY_UNAVAILABLE', 'The database is temporarily unavailable.');
    throw e;
  } finally {
    client.release();
  }
}

export { schema };
