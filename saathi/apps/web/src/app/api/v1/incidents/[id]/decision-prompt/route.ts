import { getScenarioPrompt } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

// The modal's content: scenario message plus options, each re-derived from the incident's
// current open findings and the authoritative recommendOptions() output — never guessed and
// never trusting anything the browser previously cached.
export const GET = userRoute<{ id: string }>(async ({ ctx, params }) => actorTx(ctx, (db) => getScenarioPrompt(db, ctx.actor, parseId(params.id))));
