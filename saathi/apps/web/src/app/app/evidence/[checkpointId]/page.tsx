import { getCheckpoint } from '@saathi/db';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { CheckpointView } from './checkpoint-view';

export default async function CheckpointPage(props: PageProps<'/app/evidence/[checkpointId]'>) {
  const { checkpointId } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/evidence/${checkpointId}`);
  const res = /^[0-9a-f-]{36}$/.test(checkpointId) ? await load(ctx, (db) => getCheckpoint(db, ctx.actor, checkpointId)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/evidence" />;
  return <CheckpointView initial={res.data} />;
}
