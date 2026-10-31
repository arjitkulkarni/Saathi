import { z } from 'zod';
import { recordScenarioDecision } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, readJson, userRoute } from '@/server/api';

const Body = z.object({ responseKey: z.string().min(1).max(80), idempotencyKey: z.string().min(8).max(100) });

// Records a deliberate response to the scenario modal. Only responseKey is trusted from the
// client; recordScenarioDecision re-derives the option (availability, action specification)
// from the server's own current scenario prompt before doing anything. For a device-action
// response this reuses the existing preview/approval machinery unchanged (createPreview +
// approvePreview), so every existing safety invariant there (idempotency, staleness, device
// freshness, simulated tagging) applies without modification.
export const POST = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const body = await readJson(req, Body, 4 * 1024);
  return actorTx(ctx, (db) => recordScenarioDecision(db, ctx.actor, parseId(params.id), body));
});
