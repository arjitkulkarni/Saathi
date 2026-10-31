'use client';

import { Ban, CheckCircle2, CircleHelp, Hourglass, Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/shared/status';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

// Labelled illustrative product panels built from Saathi markup (frontend.md §4B–C).
// They are synthetic examples, never live data about the visitor's organization.

export function Illustrative({ className }: { className?: string }) {
  const { t } = useI18n();
  return <span className={cn('inline-flex rounded-full border border-border-subtle bg-surface px-2.5 py-0.5 text-[12.5px] font-medium text-ink-secondary', className)}>{t('landing.illustrative')}</span>;
}

export function Window({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[16px] border border-border-subtle bg-surface text-left shadow-[var(--shadow-raised)]', className)}>
      <div aria-hidden className="flex gap-1.5 border-b border-border-subtle bg-canvas-warm px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-border-subtle" />
        <span className="size-2.5 rounded-full bg-border-subtle" />
        <span className="size-2.5 rounded-full bg-border-subtle" />
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  );
}

export function HeroExample() {
  const { t } = useI18n();
  return (
    <Window className="mx-auto max-w-[640px]">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone="danger" label={t('status.urgency.needs_attention')} />
        <Illustrative />
      </div>
      <p className="mt-3 text-[19px] font-semibold leading-snug text-ink">{t('landing.stageTitle')}</p>
      <p className="mt-2 text-[16px] text-ink">{t('landing.stageFact')}</p>
      <p className="mt-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[15px] text-ink">{t('landing.stageUncertain')}</p>
      <p className="mt-2 flex items-center gap-2 text-[15px] text-ink-secondary">
        <Hourglass aria-hidden className="size-4" />
        {t('landing.stageLimited')}
      </p>
      <span aria-hidden className="mt-4 inline-flex min-h-11 items-center rounded-[11px] bg-brand-action px-4 text-[15px] font-medium text-white">
        {t('landing.stageCta')}
      </span>
    </Window>
  );
}

export function UnderstandExample() {
  const { t } = useI18n();
  return (
    <Window>
      <Illustrative />
      <p className="mt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{t('landing.exampleWhatHappened')}</p>
      <p className="mt-1 text-[16px]">{t('landing.stageFact')}</p>
      <p className="mt-4 text-[13px] font-semibold uppercase tracking-wide text-warning-ink">{t('landing.exampleUncertain')}</p>
      <p className="mt-1 text-[16px]">{t('landing.stageUncertain')}</p>
      <p className="mt-4 flex items-center gap-2 text-[15px] text-ink-secondary">
        <Hourglass aria-hidden className="size-4" />
        {t('landing.stageLimited')}
      </p>
    </Window>
  );
}

export function DecideExample() {
  const { t } = useI18n();
  const row = (Icon: typeof Ban, title: string, item: string, tone: string) => (
    <div className="rounded-[12px] border border-border-subtle p-3">
      <p className={cn('flex items-center gap-2 text-[14px] font-semibold', tone)}>
        <Icon aria-hidden className="size-4" />
        {title}
      </p>
      <p className="mt-1 text-[15px] text-ink">{item}</p>
    </div>
  );
  return (
    <Window>
      <Illustrative />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {row(Ban, t('landing.exampleStops'), t('landing.exampleStopsItem'), 'text-danger-ink')}
        {row(CheckCircle2, t('landing.exampleKeeps'), t('landing.exampleKeepsItem'), 'text-success-ink')}
        {row(CircleHelp, t('landing.exampleUnknown'), t('landing.exampleUnknownItem'), 'text-ink')}
        {row(Lock, t('landing.exampleCannot'), t('landing.exampleCannotItem'), 'text-ink')}
      </div>
    </Window>
  );
}

export function VerifyExample() {
  const { t } = useI18n();
  return (
    <Window>
      <Illustrative />
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-[12px] border border-success-ink/30 p-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-success-ink">
            <Ban aria-hidden className="size-4" />
            {t('landing.exampleSelected')}
          </p>
        </div>
        <div className="rounded-[12px] border border-success-ink/30 p-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold text-success-ink">
            <CheckCircle2 aria-hidden className="size-4" />
            {t('landing.exampleOther')}
          </p>
        </div>
      </div>
      <p className="mt-3 text-[14px] text-ink-secondary tabular">{t('landing.exampleChecked')}</p>
    </Window>
  );
}

export function ReceiptExample() {
  const { t } = useI18n();
  return (
    <Window>
      <Illustrative />
      <div className="mt-3 flex flex-col gap-2">
        <StatusBadge tone="success" label={t('landing.receiptIntegrity')} />
        <StatusBadge tone="info" pending label={t('landing.receiptTimestamp')} />
      </div>
    </Window>
  );
}
