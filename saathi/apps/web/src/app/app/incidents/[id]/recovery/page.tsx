import Link from 'next/link';
import { and, eq } from 'drizzle-orm';
import { SaathiError } from '@saathi/contracts';
import { can } from '@saathi/domain';
import { getRecoveryCase, requireMembership, schema as s } from '@saathi/db';
import { RecoveryView, type RecoveryCase } from '@/components/incidents/recovery-view';
import { EmptyState, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function RecoveryPage(props: PageProps<'/app/incidents/[id]/recovery'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/incidents/${id}/recovery`);
  const res = /^[0-9a-f-]{36}$/.test(id)
    ? await load(ctx, async (db) => {
        await requireMembership(db, ctx.actor, 'incidents.read');
        const [rc] = await db.select({ id: s.recoveryCases.id }).from(s.recoveryCases).where(and(eq(s.recoveryCases.orgId, ctx.actor.orgId), eq(s.recoveryCases.incidentId, id)));
        if (!rc) {
          const [inc] = await db.select({ id: s.incidents.id }).from(s.incidents).where(and(eq(s.incidents.orgId, ctx.actor.orgId), eq(s.incidents.id, id)));
          if (!inc) throw new SaathiError('NOT_FOUND', 'Incident not found.');
          return null;
        }
        return getRecoveryCase(db, ctx.actor, rc.id);
      })
    : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  if (!res.data)
    return (
      <div className="mx-auto max-w-[820px]">
        <Link href={`/app/incidents/${id}`} className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
          ← {i18n.t('preview.backToIncident')}
        </Link>
        <h1 className="mt-2 text-[28px] font-semibold">{i18n.t('recovery.title')}</h1>
        <div className="mt-6">
          <EmptyState title={i18n.t('recovery.notStarted')} body={i18n.t('recovery.intro')} />
        </div>
      </div>
    );
  return <RecoveryView initial={res.data as unknown as RecoveryCase} canManage={can(ctx.actor.role, 'recovery.manage')} />;
}
