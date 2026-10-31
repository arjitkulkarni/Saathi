import { listOwnScamChecks } from '@saathi/db';
import { PageHeader, StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { integrationsStatus } from '@/server/env';
import { pageContext } from '@/server/page';
import { AskForm } from './ask-form';

export default async function AskPage() {
  const { ctx, i18n } = await pageContext('/app/ask');
  const res = await load(ctx, (db) => listOwnScamChecks(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  const integrations = integrationsStatus();
  return (
    <>
      <PageHeader title={i18n.t('ask.title')} description={i18n.t('ask.intro')} />
      <AskForm history={res.data} aiConfigured={integrations.ai} aiVisionConfigured={integrations.aiVision} />
    </>
  );
}
