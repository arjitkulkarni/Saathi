import { getPreview } from '@saathi/db';
import { PreviewView } from '@/components/preview/preview-view';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function IncidentPreviewPage(props: PageProps<'/app/incidents/[id]/preview/[previewId]'>) {
  const { id, previewId } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/incidents/${id}/preview/${previewId}`);
  const res = /^[0-9a-f-]{36}$/.test(previewId) ? await load(ctx, (db) => getPreview(db, ctx.actor, previewId)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok || (res.data.incidentId && res.data.incidentId !== id)) return <StateScreen code={res.ok ? 'NOT_FOUND' : res.code} t={i18n.t} backHref={`/app/incidents/${id}`} />;
  return <PreviewView initial={res.data} backHref={`/app/incidents/${id}`} />;
}
