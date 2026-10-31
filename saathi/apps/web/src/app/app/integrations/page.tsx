import { listIntegrations } from '@saathi/db';
import { PageHeader, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { IntegrationsView } from './integrations-view';

export default async function IntegrationsPage() {
  const { ctx, i18n } = await pageContext('/app/integrations');
  const res = await load(ctx, (db) => listIntegrations(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  return (
    <>
      <PageHeader title={i18n.t('integrations.title')} description={i18n.t('integrations.intro')} />
      <IntegrationsView initial={res.data} canManage={ctx.actor.role === 'owner'} />
    </>
  );
}
