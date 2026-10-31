import { getPerson } from '@saathi/db';
import { can } from '@saathi/domain';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { PersonView } from './person-view';

export default async function PersonPage(props: PageProps<'/app/people/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/people/${id}`);
  const res = /^[0-9a-f-]{36}$/.test(id) ? await load(ctx, (db) => getPerson(db, ctx.actor, id)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/people" />;
  return <PersonView person={res.data} canPreview={can(ctx.actor.role, 'people.preview')} />;
}
