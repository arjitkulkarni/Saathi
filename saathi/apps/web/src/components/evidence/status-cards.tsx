'use client';

import { FileCheck2, Timer } from 'lucide-react';
import type { AnchorStatusDTO, EvidenceState } from '@saathi/contracts';
import { StatusBadge, anchorTone, evidenceTone } from '@/components/shared/status';
import { useI18n } from '@/lib/i18n-client';

/** Receipt integrity and independent timestamp are always two separate claims (frontend.md §8). */
export function IntegrityCard({ state, note }: { state: EvidenceState; note?: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-[16px] border border-border-subtle bg-surface p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <FileCheck2 aria-hidden className="size-5 text-ink-secondary" />
        {t('evidence.integrity')}
      </h2>
      <div className="mt-2">
        <StatusBadge tone={evidenceTone(state)} label={state === 'signed' ? t('evidence.serverSigned') : t(`status.evidence.${state}`)} />
      </div>
      {note && <p className="mt-2 text-[14px] text-ink-secondary">{note}</p>}
    </div>
  );
}

export function TimestampCard({ anchor }: { anchor: AnchorStatusDTO }) {
  const { t, time } = useI18n();
  const meaning = {
    not_requested: t('evidence.notRequestedMeaning'),
    pending: t('evidence.pendingMeaning'),
    submitted: t('evidence.pendingMeaning'),
    confirmed: t('evidence.confirmedMeaning'),
    retrying: t('evidence.failedMeaning'),
    failed: t('evidence.failedMeaning'),
    invalid: t('evidence.invalidMeaning'),
  }[anchor.state];
  const pending = anchor.state === 'pending' || anchor.state === 'submitted';
  return (
    <div className="rounded-[16px] border border-border-subtle bg-surface p-5">
      <h2 className="flex items-center gap-2 text-[16px] font-semibold">
        <Timer aria-hidden className="size-5 text-ink-secondary" />
        {t('evidence.timestamp')}
      </h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusBadge tone={anchorTone(anchor.state)} pending={pending} label={t(`status.anchor.${anchor.state}`)} />
        {anchor.isSample && <StatusBadge tone="neutral" label={t('common.sampleBadge')} />}
      </div>
      <p className="mt-2 text-[14px] text-ink-secondary">{meaning}</p>
      {anchor.state === 'confirmed' && (
        <p className="mt-1 text-[14px]">
          {t('evidence.method', { method: anchor.method ?? '—' })} · {t('evidence.block', { height: anchor.bitcoinHeight ?? '—' })} · {time(anchor.checkedAt)}
        </p>
      )}
      {anchor.calendars.length > 0 && anchor.state !== 'confirmed' && <p className="mt-1 text-[14px] text-ink-secondary">{t('evidence.calendars', { count: anchor.calendars.length })}</p>}
      {anchor.state !== 'confirmed' && anchor.bitcoinHeight && <p className="mt-1 text-[14px] text-warning-ink">{t('evidence.noVerifier')}</p>}
      {anchor.lastError && (anchor.state === 'failed' || anchor.state === 'retrying' || anchor.state === 'invalid') && <p className="mt-1 text-[13px] text-ink-secondary">{anchor.lastError}</p>}
    </div>
  );
}
