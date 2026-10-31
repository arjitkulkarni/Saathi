import Link from 'next/link';
import { ChevronRight, FileCheck2 } from 'lucide-react';
import { listCheckpoints } from '@saathi/db';
import { EmptyState, Notice, PageHeader, StateScreen } from '@/components/shared/states';
import { StatusBadge, anchorTone } from '@/components/shared/status';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function EvidencePage() {
  const { ctx, i18n } = await pageContext('/app/evidence');
  const { t, time } = i18n;
  const res = await load(ctx, (db) => listCheckpoints(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={t} backHref="/app/ask" />;
  const { items, status } = res.data;
  return (
    <>
      <PageHeader
        title={t('evidence.title')}
        description={t('evidence.intro')}
        actions={
          <Link href="/verify" className="inline-flex min-h-11 items-center rounded-[11px] border border-border-control bg-surface px-4 text-[15px] font-medium hover:bg-surface-subtle">
            {t('evidence.verifyLocally')}
          </Link>
        }
      />
      {status.pendingIntents > 0 && (
        <Notice tone="info" className="mb-4">
          {t('evidence.pendingIntents', { count: status.pendingIntents })}
        </Notice>
      )}
      {status.blockedReason && (
        <Notice tone="danger" className="mb-4" role="alert">
          {t('evidence.blocked', { reason: status.blockedReason })}
        </Notice>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<FileCheck2 className="size-8" />} title={t('evidence.empty')} />
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-border-subtle bg-surface">
          <ul className="divide-y divide-border-subtle">
            {items.map((c) => (
              <li key={c.id}>
                <Link href={`/app/evidence/${c.id}`} className="grid gap-2 px-4 py-3.5 hover:bg-canvas-warm sm:grid-cols-[1fr_auto_auto_auto] sm:items-center sm:gap-4 sm:px-5">
                  <span>
                    <span className="block font-semibold">{t('evidence.checkpoint', { seq: c.seq })}</span>
                    <span className="block text-[14px] text-ink-secondary tabular">{time(c.createdAt)}</span>
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[12.5px] text-ink-secondary">{t('evidence.integrity')}</span>
                    <StatusBadge tone="neutral" label={t('evidence.serverSigned')} />
                  </span>
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[12.5px] text-ink-secondary">{t('evidence.timestamp')}</span>
                    <StatusBadge tone={anchorTone(c.anchor.state)} label={t(`status.anchor.${c.anchor.state}`)} />
                  </span>
                  <ChevronRight aria-hidden className="hidden size-5 text-ink-secondary sm:block" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
