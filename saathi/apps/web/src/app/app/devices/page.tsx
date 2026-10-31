import { listDevices } from '@saathi/db';
import { PageHeader, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { DevicesView } from './devices-view';

export default async function DevicesPage() {
  const { ctx, i18n } = await pageContext('/app/devices');
  const res = await load(ctx, (db) => listDevices(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  return (
    <>
      <PageHeader title={i18n.t('devices.title')} description={i18n.t('onboarding.coverageExplain')} />
      <DevicesView initial={res.data} canEnroll={ctx.actor.role === 'owner'} />
    </>
  );
}
