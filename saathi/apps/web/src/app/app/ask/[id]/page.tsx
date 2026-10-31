import { can } from '@saathi/domain';
import { getCampaign, getScamCheck } from '@saathi/db';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { AssessmentView } from './assessment-view';

export default async function AssessmentPage(props: PageProps<'/app/ask/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/ask/${id}`);
  const res = /^[0-9a-f-]{36}$/.test(id)
    ? await load(ctx, async (db) => {
        const check = await getScamCheck(db, ctx.actor, id);
        const campaign = check.campaignId && can(ctx.actor.role, 'scam.review') ? await getCampaign(db, ctx.actor, check.campaignId) : null;
        return { check, campaign };
      })
    : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/ask" />;
  return <AssessmentView initial={res.data.check} campaign={res.data.campaign} canWarn={can(ctx.actor.role, 'campaign.warn')} />;
}
