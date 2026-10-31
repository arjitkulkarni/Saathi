'use client';

import Link from 'next/link';
import { ChevronRight, Hourglass } from 'lucide-react';
import type { IncidentCardDTO } from '@saathi/contracts';
import { StatusBadge, containmentTone, incidentTone, urgencyTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

export function IncidentRow({ inc, compact }: { inc: IncidentCardDTO; compact?: boolean }) {
  const { t, r } = useI18n();
  return (
    <Link
      href={`/app/incidents/${inc.id}`}
      data-saathi-interactive=""
      className={cn('group flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface px-4 py-3.5 hover:border-border-control hover:bg-canvas-warm sm:px-5', compact && 'py-3')}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={urgencyTone(inc.urgency)} label={t(`status.urgency.${inc.urgency}`)} />
          <StatusBadge tone={incidentTone(inc.state)} label={t(`status.incident.${inc.state}`)} />
          {inc.containment === 'partially_contained' && <StatusBadge tone={containmentTone(inc.containment)} label={t(`status.containment.${inc.containment}`)} />}
          {inc.isReplay && <StatusBadge tone="neutral" label={t('common.replayBadge')} />}
        </div>
        <p className="mt-2 text-[17px] font-semibold leading-snug text-ink">{r(inc.title)}</p>
        <p className="mt-1 text-[14.5px] text-ink-secondary">
          {r(inc.source)} · <Time iso={inc.observedAt} /> · {t('incidents.findings', { count: inc.findingCount })}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[15px] text-ink">
          <span>{t('incidents.nextStep', { step: r(inc.nextStep) })}</span>
          {inc.hasActiveLimit && (
            <span className="inline-flex items-center gap-1 text-warning-ink">
              <Hourglass aria-hidden className="size-4" />
              {t('incidents.limited')}
            </span>
          )}
        </p>
      </div>
      <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-ink-secondary group-hover:text-ink" />
    </Link>
  );
}
