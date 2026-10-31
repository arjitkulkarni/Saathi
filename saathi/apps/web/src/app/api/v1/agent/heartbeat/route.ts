import { Heartbeat } from '@saathi/contracts';
import { recordHeartbeat } from '@saathi/db';
import { openRoute } from '@/server/api';
import { pool } from '@/server/db';
import { authenticateDevice, parseBody } from '@/server/device';

export const POST = openRoute(async ({ req }) => {
  const { device, body } = await authenticateDevice(req);
  return recordHeartbeat(pool(), device, parseBody(body, Heartbeat));
});
