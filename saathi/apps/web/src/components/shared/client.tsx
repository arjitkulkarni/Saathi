'use client';

import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useI18n } from '@/lib/i18n-client';
import { cn } from '@/lib/cn';

/** Full value accessible and copyable even when displayed truncated (frontend.md §8). */
export function CopyField({ value, label, className }: { value: string; label: string; className?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn('flex min-w-0 items-start gap-2', className)}>
      <code className="min-w-0 flex-1 rounded-[8px] bg-surface-subtle px-2 py-1.5 font-mono text-[12.5px] leading-relaxed text-ink [overflow-wrap:anywhere]" aria-label={label}>
        {value}
      </code>
      <button
        type="button"
        data-saathi-interactive=""
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-secondary hover:bg-surface-subtle hover:text-ink"
        aria-label={`${t('common.copy')}: ${label}`}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        <span className="sr-only" aria-live="polite">
          {copied ? t('common.copied') : ''}
        </span>
      </button>
    </div>
  );
}

/** Browser offline indicator — never presented as evidence about an endpoint. */
export function OfflineBanner() {
  const { t } = useI18n();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!offline) return null;
  return (
    <div role="status" className="border-b border-warning-ink/20 bg-warning-soft px-4 py-2 text-center text-[14px] text-ink">
      {t('states.offlineBrowser')}
    </div>
  );
}

export function Time({ iso, style = 'short' }: { iso: string | null | undefined; style?: 'short' | 'long' }) {
  const { time } = useI18n();
  return (
    <time dateTime={iso ?? undefined} className="tabular">
      {time(iso, style)}
    </time>
  );
}
