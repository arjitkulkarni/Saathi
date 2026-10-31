import { createIncidentReport } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

// Queues an export job; the worker builds the report from an authorized snapshot.
export const POST = userRoute<{ id: string }>(async ({ ctx, params }) => actorTx(ctx, (db) => createIncidentReport(db, ctx.actor, parseId(params.id))), { status: 202 });
