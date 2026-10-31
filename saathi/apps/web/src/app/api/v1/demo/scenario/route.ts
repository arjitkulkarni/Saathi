import { and, eq } from 'drizzle-orm';
import { SaathiError } from '@saathi/contracts';
import { createRecordsSession, schema as s } from '@saathi/db';
import { actorTx } from '@/server/actor';
import { userRoute } from '@/server/api';
import { assertDemo } from '@/server/demo';

/**
 * Labelled demo scenario: two fresh records sessions for one synthetic staff member, created
 * through the normal session-creation writer (guard row, evidence). Tokens go only to the
 * demo owner's browser so the two sessions can be exercised side by side.
 */
export const POST = userRoute(async ({ ctx }) => {
  assertDemo(ctx);
  return actorTx(ctx, async (db) => {
    const [person] = await db.select().from(s.staff).where(and(eq(s.staff.orgId, ctx.actor.orgId), eq(s.staff.status, 'active'), eq(s.staff.sharedAccount, false))).orderBy(s.staff.employeeCode).limit(1);
    if (!person?.employeeCode) throw new SaathiError('NOT_FOUND', 'No synthetic staff member is available.');
    const mk = (label: string, familiar: boolean) => createRecordsSession(db, ctx.actor.orgId, { employeeCode: person.employeeCode!, pinHashCheck: () => true, label, familiar, via: 'demo_scenario' });
    // Distinct labels per run keep repeated demonstrations readable.
    const run = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: ctx.dto.timezone });
    const officeLabel = `Office PC (front desk) · ${run}`;
    const laptopLabel = `Unrecognised laptop · ${run}`;
    const office = await mk(officeLabel, true);
    const laptop = await mk(laptopLabel, false);
    return { orgId: ctx.actor.orgId, person: person.displayName, office: { token: office.token, label: officeLabel }, laptop: { token: laptop.token, label: laptopLabel } };
  });
});
