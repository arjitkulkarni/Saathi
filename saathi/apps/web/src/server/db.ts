import 'server-only';
import { getPool, storeFromEnv, type ObjectStore } from '@saathi/db';
import { env } from './env';

export function pool() {
  return getPool(env().DATABASE_URL, 10);
}

let store: ObjectStore | null = null;
export function objectStore() {
  if (!store) store = storeFromEnv(process.env);
  return store;
}
