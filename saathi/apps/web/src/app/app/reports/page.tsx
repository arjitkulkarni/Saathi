import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { listReports } from '@saathi/db';
import { EmptyState, PageHeader, StateScreen } from '@/components/shared/states';
import { StatusBadge, anchorTone, evidenceTone } from '@/components/shared/status';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function ReportsPage() {
  const { ctx, i18n } = await pageContext('/app/reports');
  const { t, r, time } = i18n;
  const res = await load(ctx, (db) => listReports(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={t} backHref="/app/ask" />;
  return (
    <>
      <PageHeader title={t('reports.title')} />
      {res.data.length === 0 ? (
        <EmptyState icon={<FileText className="size-8" />} title={t('reports.empty')} />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-[16px] border border-border-subtle bg-surface">
          {res.data.map((rep) => (
            <li key={rep.id}>
              <Link href={`/app/reports/${rep.id}`} className="flex flex-col gap-2 px-4 py-3.5 hover:bg-canvas-warm sm:flex-row sm:items-center sm:gap-4 sm:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{r(rep.title)}</span>
                  <span className="block text-[14px] text-ink-secondary tabular">
                    {time(rep.createdAt)}
                    {rep.periodStart && ` · ${time(rep.periodStart)} – ${time(rep.periodEnd)}`}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1.5">
                  <StatusBadge tone={rep.status === 'ready' ? 'neutral' : rep.status === 'failed' ? 'danger' : 'info'} pending={rep.status === 'queued'} label={t(`reports.status.${rep.status}`)} />
                  <StatusBadge tone={evidenceTone(rep.integrityState)} label={`${t('reports.integrity')}: ${t(`status.evidence.${rep.integrityState}`)}`} />
                  <StatusBadge tone={anchorTone(rep.anchorState)} label={t(`status.anchor.${rep.anchorState}`)} />
                </span>
                <ChevronRight aria-hidden className="hidden size-5 text-ink-secondary sm:block" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
