import { NextResponse } from 'next/server';
import { SaathiError } from '@saathi/contracts';
import { reportArtifactRef } from '@saathi/db';
import { actorTx, requireActorApi } from '@/server/actor';
import { errorResponse, parseId } from '@/server/api';
import { objectStore } from '@/server/db';

// Every download is authorized against current membership, logged (without content) and
// streamed from private storage. There is no public artifact URL.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  try {
    const actor = await requireActorApi();
    const id = parseId((await ctx.params).id);
    const q = new URL(req.url).searchParams.get('artifact');
    const artifact = q === 'bundle' || q === 'manifest' ? q : 'pdf';
    const a = await actorTx(actor, (db) => reportArtifactRef(db, actor.actor, id, artifact));
    const bytes = await objectStore().get(a.ref);
    if (!bytes) throw new SaathiError('NOT_FOUND', 'Artifact is no longer stored.');
    return new NextResponse(Buffer.from(bytes), {
      headers: { 'Content-Type': a.contentType, 'Content-Disposition': `attachment; filename="${a.filename}"`, 'Cache-Control': 'private, no-store', 'X-Request-Id': requestId },
    });
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
