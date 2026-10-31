import { z } from 'zod';
import { EventType, SaathiError } from '@saathi/contracts';
import { ingestConnectorEvents } from '@saathi/db';
import { openRoute, parseId, readJson } from '@/server/api';
import { pool } from '@/server/db';

// Idempotent source events from an authenticated (read-only) connector identity.
export const POST = openRoute<{ id: string }>(async ({ req, params }) => {
  parseId(params.id);
  const h = req.headers.get('authorization') ?? '';
  if (!h.startsWith('Bearer ')) throw new SaathiError('UNAUTHENTICATED', 'Connector key required.');
  const body = await readJson(
    req,
    z.object({
      events: z
        .array(z.object({ id: z.string().min(1).max(120), type: EventType, observedAt: z.string().datetime(), facts: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])) }))
        .max(200),
    }),
    256 * 1024,
  );
  return ingestConnectorEvents(pool(), h.slice(7).trim(), body.events);
});
