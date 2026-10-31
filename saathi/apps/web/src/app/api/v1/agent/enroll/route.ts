import { EnrollRequest } from '@saathi/contracts';
import { enrollDevice } from '@saathi/db';
import { openRoute, readJson } from '@/server/api';
import { pool } from '@/server/db';
import { commandKeys, env } from '@/server/env';

// One-use code exchange; returns the device secret once plus pinned command keys.
export const POST = openRoute(async ({ req }) => {
  const body = await readJson(req, EnrollRequest, 8 * 1024);
  return enrollDevice(pool(), body, { encryptionKey: env().DEVICE_SECRET_ENCRYPTION_KEY, commandKeys: commandKeys().filter((k) => !k.retiredAt) });
});
