import { CommandResult } from '@saathi/contracts';
import { recordCommandResult } from '@saathi/db';
import { openRoute, parseId } from '@/server/api';
import { pool } from '@/server/db';
import { authenticateDevice, parseBody } from '@/server/device';

export const POST = openRoute<{ id: string }>(async ({ req, params }) => {
  const { device, body } = await authenticateDevice(req);
  const result = parseBody(body, CommandResult);
  const id = parseId(params.id);
  if (result.commandId !== id) return { accepted: false, duplicate: false };
  return recordCommandResult(pool(), device, id, result);
});
