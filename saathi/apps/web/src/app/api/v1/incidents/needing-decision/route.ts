import { listIncidentsNeedingDecision } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

// Queue for the scenario decision modal: actionable incidents an owner/approver has not yet
// made a deliberate decision on, prioritized by urgency then age. Staff/auditor get FORBIDDEN
// (requireMembership rejects before the query runs) — the client only polls this when the
// signed-in role can decide, so a read-only viewer never has a reason to open the modal.
export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => listIncidentsNeedingDecision(db, ctx.actor)));
