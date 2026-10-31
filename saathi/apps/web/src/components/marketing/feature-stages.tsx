'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';
import { DecideExample, UnderstandExample, VerifyExample } from './examples';

const STAGES = [
  { key: 'understand', tab: 'landing.understandTab', heading: 'landing.understandHeading', body: 'landing.understandBody', Panel: UnderstandExample },
  { key: 'decide', tab: 'landing.decideTab', heading: 'landing.decideHeading', body: 'landing.decideBody', Panel: DecideExample },
  { key: 'verify', tab: 'landing.verifyTab', heading: 'landing.verifyHeading', body: 'landing.verifyBody', Panel: VerifyExample },
] as const;

// Explicit selectors; panels never auto-cycle (frontend.md §4C). Stable stage dimensions;
// a short crossfade that reduced-motion turns into an immediate change.
export function FeatureStages() {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' ? (i + 1) % STAGES.length : e.key === 'ArrowLeft' ? (i - 1 + STAGES.length) % STAGES.length : e.key === 'Home' ? 0 : e.key === 'End' ? STAGES.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };
  const s = STAGES[active];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
      <div>
        <div role="tablist" aria-label={t('landing.howTitle')} className="flex flex-wrap gap-2">
          {STAGES.map((st, i) => (
            <button
              key={st.key}
              ref={(el) => {
                tabs.current[i] = el;
              }}
              role="tab"
              id={`stage-tab-${st.key}`}
              aria-selected={i === active}
              aria-controls={`stage-panel-${st.key}`}
              tabIndex={i === active ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={(e) => onKey(e, i)}
              data-saathi-interactive=""
              className={cn('min-h-11 rounded-full border px-4 text-[15px] font-medium', i === active ? 'border-brand-action/40 bg-brand-soft text-brand-action-hover' : 'border-border-subtle bg-canvas text-ink hover:bg-surface-subtle')}
            >
              {t(st.tab)}
            </button>
          ))}
        </div>
        <div className="mt-6 min-h-[9.5rem]">
          <h3 className="font-[family-name:var(--font-display)] text-[28px] leading-[1.2] text-ink sm:text-[32px]">{t(s.heading)}</h3>
          <p className="mt-3 max-w-[34rem] text-[17px] leading-relaxed text-ink-secondary">{t(s.body)}</p>
        </div>
      </div>
      <div className="rounded-[22px] bg-canvas-warm p-4 sm:p-8">
        <div key={s.key} id={`stage-panel-${s.key}`} role="tabpanel" aria-labelledby={`stage-tab-${s.key}`} className="saathi-fade min-h-[16rem]">
          <s.Panel />
        </div>
      </div>
    </div>
  );
}
