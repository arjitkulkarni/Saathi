import { getHealth } from '@saathi/db';
import { can } from '@saathi/domain';
import { PageHeader, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { HealthView } from './health-view';

export default async function HealthPage() {
  const { ctx, i18n } = await pageContext('/app/health');
  const res = await load(ctx, (db) => getHealth(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  return (
    <>
      <PageHeader title={i18n.t('health.title')} description={i18n.t('health.intro')} />
      <HealthView initial={res.data} canPreview={can(ctx.actor.role, 'people.preview')} />
    </>
  );
}
