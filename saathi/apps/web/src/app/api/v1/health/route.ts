import { getHealth } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';

// Posture score components (build.md Ph14). Not to be confused with /api/v1/status (liveness).
export const GET = userRoute(async ({ ctx }) => actorTx(ctx, (db) => getHealth(db, ctx.actor)));
