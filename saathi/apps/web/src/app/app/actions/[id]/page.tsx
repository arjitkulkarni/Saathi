import { getActionDetail } from '@saathi/db';
import { ActionView } from '@/components/actions/action-view';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function ActionPage(props: PageProps<'/app/actions/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/actions/${id}`);
  const res = /^[0-9a-f-]{36}$/.test(id) ? await load(ctx, (db) => getActionDetail(db, ctx.actor, id)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  return <ActionView initial={res.data} />;
}
