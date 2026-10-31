import { getOverview } from '@saathi/db';
import { OverviewView } from './overview-view';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function OverviewPage() {
  const { ctx, i18n } = await pageContext('/app/overview');
  const res = await load(ctx, (db) => getOverview(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/ask" />;
  return <OverviewView initial={res.data} canAddDevice={ctx.actor.role === 'owner'} />;
}
