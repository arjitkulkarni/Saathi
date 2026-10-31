'use client';

import { useState } from 'react';
import { Link2, Loader2, X } from 'lucide-react';
import type { CheckpointGraphDTO } from '@saathi/contracts';
import { apiGet, ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';
import { Card } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

type Entry = CheckpointGraphDTO['entries'][number];

export function ChainGraph({ checkpointId }: { checkpointId: string }) {
  const { t, r, time } = useI18n();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CheckpointGraphDTO | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Entry | null>(null);

  async function load() {
    setOpen(true);
    if (data || loading) return;
    setLoading(true);
    setError(null);
    try {
      setData(await apiGet<CheckpointGraphDTO>(`/api/v1/checkpoints/${checkpointId}/graph`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('evidence.graph.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={load} className="inline-flex min-h-11 items-center gap-1.5 rounded-[11px] border border-border-control bg-surface px-4 text-[15px] font-medium hover:bg-surface-subtle">
        <Link2 aria-hidden className="size-4" />
        {t('evidence.graph.view')}
      </button>
      {open && (
        <Card className="mt-4">
          <h2 className="text-[16px] font-semibold">{t('evidence.graph.title')}</h2>
          <p className="mt-1 text-[14px] text-ink-secondary">{t('evidence.graph.intro')}</p>
          {loading && (
            <p className="mt-4 flex items-center gap-2 text-[14px] text-ink-secondary">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              {t('common.loading')}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-4 text-[14px] text-danger-ink">
              {error}
            </p>
          )}
          {data && data.entries.length === 0 && <p className="mt-4 text-[14px] text-ink-secondary">{t('evidence.graph.empty')}</p>}
          {data && data.entries.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <div className="flex min-w-max items-center gap-1 pb-2">
                {data.entries.map((e, i) => (
                  <div key={e.id} className="flex items-center gap-1">
                    {i > 0 && <span aria-hidden className="h-px w-4 bg-border-control" />}
                    <button
                      type="button"
                      onClick={() => setSelected(e)}
                      className={cn(
                        'flex size-14 shrink-0 items-center justify-center rounded-[10px] border text-[12px] font-medium tabular transition-colors',
                        selected?.id === e.id ? 'border-ink bg-ink text-surface' : 'border-border-control bg-canvas-warm hover:bg-surface-subtle',
                      )}
                      title={t('evidence.graph.node', { seq: e.seq })}
                    >
                      #{e.seq}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {selected && (
            <div role="dialog" aria-label={t('evidence.graph.node', { seq: selected.seq })} className="mt-4 rounded-[12px] border border-border-subtle bg-canvas-warm p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] text-ink-secondary">{t('evidence.graph.node', { seq: selected.seq })}</p>
                  <p className="mt-1 text-[15px] tabular text-ink-secondary">{time(selected.occurredAt, 'long')}</p>
                  <p className="mt-2 text-[16px]">{r(selected.summary)}</p>
                </div>
                <button type="button" onClick={() => setSelected(null)} aria-label={t('evidence.graph.close')} className="rounded-full p-1 hover:bg-surface-subtle">
                  <X aria-hidden className="size-4" />
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
