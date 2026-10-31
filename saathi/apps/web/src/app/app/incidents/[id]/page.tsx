import { getIncidentDetail } from '@saathi/db';
import { IncidentView } from '@/components/incidents/incident-view';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function IncidentPage(props: PageProps<'/app/incidents/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/incidents/${id}`);
  const valid = /^[0-9a-f-]{36}$/.test(id);
  const res = valid ? await load(ctx, (db) => getIncidentDetail(db, ctx.actor, id)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/incidents" />;
  return <IncidentView initial={res.data} />;
}
