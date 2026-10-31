import { SaathiError } from '@saathi/contracts';
import { listIntegrations } from '@saathi/db';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { IntegrationDetail } from './integration-detail';

export default async function IntegrationPage(props: PageProps<'/app/integrations/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/integrations/${id}`);
  const res = await load(ctx, async (db) => {
    const i = (await listIntegrations(db, ctx.actor)).find((x) => x.id === id);
    if (!i) throw new SaathiError('NOT_FOUND', 'Integration not found.');
    return i;
  });
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/integrations" />;
  return <IntegrationDetail initial={res.data} canManage={ctx.actor.role === 'owner'} />;
}
