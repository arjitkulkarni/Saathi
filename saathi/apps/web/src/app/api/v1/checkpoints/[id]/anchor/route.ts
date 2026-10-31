import { anchorStatusForCheckpoint, getCheckpoint, requestCheckpointAnchor } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';

// Pending / confirmed / failed status with the verification method; never inferred by time.
export const GET = userRoute<{ id: string }>(async ({ ctx, params }) =>
  actorTx(ctx, async (db) => {
    const cp = await getCheckpoint(db, ctx.actor, parseId(params.id));
    const { memberId: _m, ...status } = await anchorStatusForCheckpoint(db, cp.id, cp.isSample);
    void _m;
    return status;
  }),
);

// Idempotent timestamp request (one randomized commitment per checkpoint).
export const POST = userRoute<{ id: string }>(
  async ({ ctx, params }) =>
    actorTx(ctx, async (db) => {
      const { memberId: _m, ...status } = await requestCheckpointAnchor(db, ctx.actor, parseId(params.id));
      void _m;
      return status;
    }),
  { status: 202 },
);
