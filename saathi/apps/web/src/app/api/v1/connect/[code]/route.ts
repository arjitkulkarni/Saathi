import { z } from 'zod';
import { PREVIEW_SCENARIOS, runAttackPreview } from '@saathi/db';
import { openRoute, readJson } from '@/server/api';
import { pool } from '@/server/db';

// Public, unauthenticated web preview reached via the enrollment code shown in the Add
// Device dialog (the code itself is the one-use "login"). It can only inject clearly
// synthetic events into a device that is always created with simulated=true — see
// runAttackPreview / resolvePreviewDevice in @saathi/db for the safety invariants.
export const POST = openRoute<{ code: string }>(async ({ req, params }) => {
  const body = await readJson(req, z.object({ scenario: z.enum(PREVIEW_SCENARIOS) }), 1024);
  return runAttackPreview(pool(), params.code, body.scenario);
});
