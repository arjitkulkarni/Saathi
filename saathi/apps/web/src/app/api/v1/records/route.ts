import { and, eq } from 'drizzle-orm';
import { SaathiError } from '@saathi/contracts';
import { gatewayDecide, schema, withTx } from '@saathi/db';
import { openRoute } from '@/server/api';
import { pool } from '@/server/db';
import { recordsSession } from '@/server/records';

// Record list (titles only). The view capability is checked through the same gateway policy;
// content is served only by the download endpoint, one authorized request at a time.
export const GET = openRoute(async ({ req }) => {
  const s = await recordsSession(req);
  return withTx(pool(), { orgId: s.orgId }, async (db) => {
    const check = await gatewayDecide(db, s, { capability: 'records.view', recordId: null, probe: true });
    if (check.decision === 'deny') throw new SaathiError('FORBIDDEN', `Access refused: ${check.reason}`, { reason: check.reason });
    const rows = await db
      .select({ id: schema.demoRecords.id, title: schema.demoRecords.title, category: schema.demoRecords.category })
      .from(schema.demoRecords)
      .where(and(eq(schema.demoRecords.orgId, s.orgId)))
      .orderBy(schema.demoRecords.title)
      .limit(200);
    const [sess] = await db.select({ label: schema.appSessions.label }).from(schema.appSessions).where(eq(schema.appSessions.id, s.sessionId));
    const [person] = await db.select({ name: schema.staff.displayName }).from(schema.staff).where(eq(schema.staff.id, s.staffId));
    return { records: rows, session: { label: sess?.label ?? '', person: person?.name ?? '', decision: check.decision } };
  });
});
