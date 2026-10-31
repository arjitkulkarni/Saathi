import { getPreview } from '@saathi/db';
import { PreviewView } from '@/components/preview/preview-view';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

// Standalone preview for people, device and health actions (flow.md §3). Same component and
// approval path as incident previews.
export default async function StandalonePreviewPage(props: PageProps<'/app/previews/[previewId]'>) {
  const { previewId } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/previews/${previewId}`);
  const res = /^[0-9a-f-]{36}$/.test(previewId) ? await load(ctx, (db) => getPreview(db, ctx.actor, previewId)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} />;
  const c = res.data.content;
  const back = res.data.incidentId ? `/app/incidents/${res.data.incidentId}` : c.targetType === 'device' ? `/app/devices/${c.targetId}` : '/app/people';
  return <PreviewView initial={res.data} backHref={back} />;
}
