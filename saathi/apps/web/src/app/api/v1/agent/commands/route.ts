import { pollCommands } from '@saathi/db';
import { openRoute } from '@/server/api';
import { pool } from '@/server/db';
import { authenticateDevice } from '@/server/device';

// Short HTTPS polling (build.md Ph09): only non-expired signed commands for this device.
export const GET = openRoute(async ({ req }) => {
  const { device } = await authenticateDevice(req);
  return { commands: await pollCommands(pool(), device) };
});
