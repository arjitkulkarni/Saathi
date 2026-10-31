import { getReport } from '@saathi/db';
import { StateScreen } from '@/components/shared/states';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';
import { ReportView, type ReportDetail } from './report-view';

export default async function ReportPage(props: PageProps<'/app/reports/[id]'>) {
  const { id } = await props.params;
  const { ctx, i18n } = await pageContext(`/app/reports/${id}`);
  const res = /^[0-9a-f-]{36}$/.test(id) ? await load(ctx, (db) => getReport(db, ctx.actor, id)) : ({ ok: false, code: 'NOT_FOUND', message: '' } as const);
  if (!res.ok) return <StateScreen code={res.code} t={i18n.t} backHref="/app/reports" />;
  return <ReportView initial={res.data as unknown as ReportDetail} />;
}
