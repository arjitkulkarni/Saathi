import { and, count, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { SaathiError } from '@saathi/contracts';
import { can } from '@saathi/domain';
import { coverageSummary, schema as s, withTx } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';
import { pool } from '@/server/db';
import { integrationsStatus } from '@/server/env';

// Operational health (build.md Ph17.4): DB, worker queue lag, agent freshness, notification
// delivery and proof-service results, each reported separately.
export const GET = userRoute(async ({ ctx }) => {
  if (!can(ctx.actor.role, 'ops.read')) throw new SaathiError('FORBIDDEN', 'Only owners can view operations status.');
  const queue = await withTx(pool(), {}, async (_db, c) => (await c.query('SELECT status, n::int AS n, oldest_due FROM saathi_queue_stats()')).rows as { status: string; n: number; oldest_due: string | null }[]);
  const queued = queue.find((q) => q.status === 'queued');
  const lagSeconds = queued?.oldest_due ? Math.max(0, Math.round((Date.now() - new Date(queued.oldest_due).getTime()) / 1000)) : 0;
  return actorTx(ctx, async (db) => {
    const since = new Date(Date.now() - 7 * 86400_000);
    const notif = await db.select({ status: s.notifications.status, n: count() }).from(s.notifications).where(and(eq(s.notifications.orgId, ctx.actor.orgId), gte(s.notifications.createdAt, since))).groupBy(s.notifications.status);
    const failedJobs = await db.select({ id: s.jobs.id, type: s.jobs.type, lastError: s.jobs.lastError, updatedAt: s.jobs.updatedAt, attempts: s.jobs.attempts }).from(s.jobs).where(and(eq(s.jobs.orgId, ctx.actor.orgId), eq(s.jobs.status, 'failed'))).orderBy(desc(s.jobs.updatedAt)).limit(20);
    const proofs = await db.select({ status: s.anchorProofs.status, n: count() }).from(s.anchorProofs).groupBy(s.anchorProofs.status);
    const [lastProof] = await db.select({ status: s.anchorProofs.status, lastError: s.anchorProofs.lastError, at: s.anchorProofs.lastAttemptAt }).from(s.anchorProofs).where(isNotNull(s.anchorProofs.lastAttemptAt)).orderBy(desc(s.anchorProofs.lastAttemptAt)).limit(1);
    const [head] = await db.select().from(s.evidenceChainHeads).where(eq(s.evidenceChainHeads.orgId, ctx.actor.orgId));
    const pendingIntents = await db.select({ n: count() }).from(s.evidenceIntents).where(and(eq(s.evidenceIntents.orgId, ctx.actor.orgId), inArray(s.evidenceIntents.status, ['pending_signature'])));
    return {
      web: 'ok',
      database: 'ok',
      worker: { queue, lagSeconds, healthy: lagSeconds < 120 },
      failedJobs: failedJobs.map((j) => ({ ...j, updatedAt: j.updatedAt.toISOString() })),
      agents: (await coverageSummary(db, ctx.actor.orgId)).devices,
      notifications: Object.fromEntries(notif.map((n) => [n.status, Number(n.n)])),
      proofs: { byStatus: Object.fromEntries(proofs.map((p) => [p.status, Number(p.n)])), last: lastProof ? { status: lastProof.status, lastError: lastProof.lastError, at: lastProof.at?.toISOString() ?? null } : null },
      evidence: { pendingIntents: Number(pendingIntents[0]?.n ?? 0), blockedReason: head?.blockedReason ?? null },
      configured: integrationsStatus(),
    };
  });
});
