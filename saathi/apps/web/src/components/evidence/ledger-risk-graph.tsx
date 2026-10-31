import Link from 'next/link';
import type { CheckpointDTO } from '@saathi/contracts';
import { TONE, anchorTone, type Tone } from '@/components/shared/status';
import { cn } from '@/lib/cn';

// A simple left-to-right strip, oldest checkpoint first: one dot per checkpoint, colored by its
// independent-timestamp state. The connecting line stands for the hash link between checkpoints —
// it carries no state of its own, because checkpoint integrity is proven by signature verification
// (frontend.md §8), not by anything this graph computes. Reuses the app's existing status tones
// (components/shared/status.tsx) rather than inventing a new palette.
export function LedgerRiskGraph({ items, t }: { items: CheckpointDTO[]; t: (key: string, params?: Record<string, unknown>) => string }) {
  if (items.length === 0) return null;
  const chronological = [...items].reverse(); // listCheckpoints returns newest first

  const legend: { tone: Tone; label: string }[] = [
    { tone: 'success', label: t('evidence.ledgerGraph.legendConfirmed') },
    { tone: 'info', label: t('evidence.ledgerGraph.legendPending') },
    { tone: 'warning', label: t('evidence.ledgerGraph.legendRetrying') },
    { tone: 'danger', label: t('evidence.ledgerGraph.legendFailed') },
    { tone: 'neutral', label: t('evidence.ledgerGraph.legendNotRequested') },
  ];

  return (
    <div className="mb-4 rounded-[16px] border border-border-subtle bg-surface p-5">
      <h2 className="text-[16px] font-semibold">{t('evidence.ledgerGraph.title')}</h2>
      <p className="mt-1 text-[14px] text-ink-secondary">{t('evidence.ledgerGraph.intro')}</p>

      <div className="mt-4 overflow-x-auto">
        <div className="flex min-w-max items-center pb-1">
          {chronological.map((c, i) => (
            <div key={c.id} className="flex items-center">
              {i > 0 && <span aria-hidden className="h-px w-8 shrink-0 bg-border-control" />}
              <Link
                href={`/app/evidence/${c.id}`}
                title={t('evidence.checkpoint', { seq: c.seq })}
                className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border text-[12px] font-semibold tabular transition-colors hover:brightness-95', TONE[anchorTone(c.anchor.state)])}
              >
                {c.seq}
              </Link>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5">
        {legend.map((l) => (
          <span key={l.tone} className="flex items-center gap-1.5 text-[13px] text-ink-secondary">
            <span aria-hidden className={cn('size-2.5 rounded-full border', TONE[l.tone])} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
