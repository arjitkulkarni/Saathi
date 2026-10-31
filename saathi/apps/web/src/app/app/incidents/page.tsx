import { listIncidents } from '@saathi/db';
import { IncidentList } from './incident-list';
import { PageHeader, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

const TABS = ['needs_attention', 'investigating', 'recovering', 'all'] as const;

export default async function IncidentsPage(props: PageProps<'/app/incidents'>) {
  const sp = await props.searchParams;
  const tabParam = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  const tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as (typeof TABS)[number]) : 'needs_attention';
  const { ctx, i18n } = await pageContext(`/app/incidents?tab=${tab}`);
  const res = await load(ctx, (db) => listIncidents(db, ctx.actor, { tab }));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  return (
    <>
      <PageHeader title={i18n.t('incidents.title')} />
      <IncidentList key={tab} tab={tab} initial={res.data} />
    </>
  );
}
