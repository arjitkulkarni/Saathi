import { EventBatch } from '@saathi/contracts';
import { ingestEvents } from '@saathi/db';
import { openRoute } from '@/server/api';
import { pool } from '@/server/db';
import { authenticateDevice, parseBody } from '@/server/device';

export const POST = openRoute(async ({ req }) => {
  const { device, body } = await authenticateDevice(req);
  return ingestEvents(pool(), device, parseBody(body, EventBatch));
});
