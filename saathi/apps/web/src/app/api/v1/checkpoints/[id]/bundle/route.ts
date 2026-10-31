import { NextResponse } from 'next/server';
import { buildEvidenceBundle, retainedCheckpoint } from '@saathi/db';
import { actorTx, requireActorApi } from '@/server/actor';
import { errorResponse, parseId } from '@/server/api';

// Authorized download of the proof bundle (?kind=bundle) or the checkpoint to retain (?kind=retained).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await requireActorApi();
    const id = parseId((await ctx.params).id);
    const kind = new URL(req.url).searchParams.get('kind') === 'retained' ? 'retained' : 'bundle';
    const data: { checkpoint: { seq: number } } = await actorTx(actor, (db): Promise<{ checkpoint: { seq: number } }> => (kind === 'retained' ? retainedCheckpoint(db, actor.actor, id) : buildEvidenceBundle(db, actor.actor, id)));
    const seq = data.checkpoint.seq;
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="saathi-${kind === 'retained' ? 'retained-checkpoint' : 'proof-bundle'}-${seq}.json"`,
        'Cache-Control': 'private, no-store',
        'X-Request-Id': requestId,
      },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
