'use client';

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Card, FieldError, Label, Select, Textarea } from '@/components/ui/primitives';
import { apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

// Owner-declared dependencies (flow.md §4.2). Declarations, never discovered facts.

const CONFIDENCE = ['high', 'medium', 'low', 'unknown'] as const;
type Confidence = (typeof CONFIDENCE)[number];
type Kind = 'workstation_runs' | 'shared_account' | 'app_status' | 'other';

// Each example fills an editable sentence and the dependency kind the API records.
const EXAMPLES: { key: string; kind: Kind }[] = [
  { key: 'workstation_runs', kind: 'workstation_runs' },
  { key: 'shared_account', kind: 'shared_account' },
  { key: 'secret', kind: 'workstation_runs' },
  { key: 'app_status', kind: 'app_status' },
  { key: 'backup', kind: 'workstation_runs' },
];

type Draft = { id: number; text: string; kind: Kind; confidence: Confidence };
type Saved = { id: string; description: string; confidence: string };
export type DependencyCardHandle = { saveDrafts: () => Promise<void> };

const emptyDraft = (id: number): Draft => ({ id, text: '', kind: 'other', confidence: 'unknown' });

export function DependencyCard({ busy, run, handle }: { busy: boolean; run: (fn: () => Promise<void>) => Promise<void>; handle?: Ref<DependencyCardHandle> }) {
  const { t } = useI18n();
  // Box ids start at 1 on both server and client so hydration matches.
  const nextId = useRef(2);
  const newDraft = () => emptyDraft(nextId.current++);
  const [drafts, setDrafts] = useState<Draft[]>(() => [emptyDraft(1)]);
  const [tooShort, setTooShort] = useState<number[]>([]);
  const areas = useRef(new Map<number, HTMLTextAreaElement>());
  const focusNext = useRef<number | null>(null);

  // Every declared dependency, including ones saved in earlier visits.
  const { data: saved, error: loadError, mutate: reload } = usePolling<Saved[]>('/api/v1/dependencies', undefined, () => false);
  useEffect(() => {
    if (focusNext.current !== null) {
      areas.current.get(focusNext.current)?.focus();
      focusNext.current = null;
    }
  }, [drafts]);

  const update = (id: number, patch: Partial<Draft>) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const addRow = (seed?: Partial<Draft>) => {
    const d = { ...newDraft(), ...seed };
    focusNext.current = d.id;
    setDrafts((ds) => [...ds, d]);
  };
  const applyExample = (ex: (typeof EXAMPLES)[number]) => {
    const text = t(`onboarding.dependencyExamples.${ex.key}.text`);
    const empty = drafts.find((d) => !d.text.trim());
    if (empty) {
      focusNext.current = empty.id;
      update(empty.id, { text, kind: ex.kind });
    } else addRow({ text, kind: ex.kind });
  };

  /** Saves every filled box; empty boxes are ignored. Throws nothing on success. */
  const saveDrafts = async () => {
    const filled = drafts.filter((d) => d.text.trim());
    const short = filled.filter((d) => d.text.trim().length < 5).map((d) => d.id);
    setTooShort(short);
    if (short.length) throw new Error(t('onboarding.dependencyTooShort'));
    for (const d of filled) {
      await apiSend('/api/v1/dependencies', 'POST', { kind: d.kind, description: d.text.trim(), confidence: d.confidence });
      setDrafts((ds) => ds.filter((x) => x.id !== d.id));
    }
    if (filled.length) {
      setDrafts((ds) => (ds.length ? ds : [newDraft()]));
      await reload();
    }
  };
  useImperativeHandle(handle, () => ({ saveDrafts }));
  const hasFilled = drafts.some((d) => d.text.trim());

  return (
    <Card>
      <h2 className="text-[17px] font-semibold">{t('onboarding.dependencyTitle')}</h2>
      <p className="mt-1 text-[15px] text-ink-secondary">{t('onboarding.dependencyBody')}</p>
      <p className="mt-2 text-[15px] text-ink-secondary">{t('onboarding.dependencyHint')}</p>

      <section className="mt-5" aria-labelledby="dep-saved">
        <h3 id="dep-saved" className="text-[15px] font-semibold">
          {t('onboarding.dependencySavedTitle', { count: saved?.length ?? 0 })}
        </h3>
        {loadError ? (
          <p className="mt-2 text-[15px] text-danger-ink">{t('states.errorBody')}</p>
        ) : !saved ? (
          <p className="mt-2 text-[15px] text-ink-secondary">{t('common.loading')}</p>
        ) : saved.length === 0 ? (
          <p className="mt-2 text-[15px] text-ink-secondary">{t('onboarding.dependencyNone')}</p>
        ) : (
          <ul className="mt-2 space-y-2" aria-live="polite">
            {saved.map((d) => (
              <li key={d.id} className="rounded-[12px] border border-border-subtle bg-canvas-warm px-3 py-2.5 text-[15px] break-words">
                {d.description} <span className="text-ink-secondary">· {t(`onboarding.confidence.${d.confidence}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5" role="group" aria-labelledby="dep-examples">
        <p id="dep-examples" className="text-[14px] font-medium text-ink-secondary">
          {t('onboarding.dependencyExamplesLabel')}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.key}
              type="button"
              data-saathi-interactive
              title={t(`onboarding.dependencyExamples.${ex.key}.text`)}
              onClick={() => applyExample(ex)}
              className="min-h-11 rounded-full border border-border-subtle bg-canvas-warm px-4 text-[14px] text-ink hover:border-border-control"
            >
              {t(`onboarding.dependencyExamples.${ex.key}.label`)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {drafts.map((d, i) => (
          <div key={d.id} className="rounded-[14px] border border-border-subtle p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={`dep-${d.id}`}>{t('onboarding.dependencyRow', { n: i + 1 })}</Label>
              {drafts.length > 1 && (
                <button
                  type="button"
                  data-saathi-interactive
                  onClick={() => setDrafts((ds) => ds.filter((x) => x.id !== d.id))}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-ink-secondary hover:bg-surface-subtle hover:text-ink"
                  aria-label={t('onboarding.dependencyRemoveRow', { n: i + 1 })}
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </div>
            <Textarea
              id={`dep-${d.id}`}
              ref={(el) => {
                if (el) areas.current.set(d.id, el);
                else areas.current.delete(d.id);
              }}
              className="min-h-20"
              maxLength={300}
              value={d.text}
              aria-invalid={tooShort.includes(d.id) || undefined}
              aria-describedby={tooShort.includes(d.id) ? `dep-${d.id}-err` : undefined}
              onChange={(e) => update(d.id, { text: e.target.value })}
            />
            {tooShort.includes(d.id) && <FieldError id={`dep-${d.id}-err`}>{t('onboarding.dependencyTooShort')}</FieldError>}
            <div className="mt-3 sm:max-w-xs">
              <Label htmlFor={`conf-${d.id}`}>{t('onboarding.dependencyConfidence')}</Label>
              <Select id={`conf-${d.id}`} value={d.confidence} onChange={(e) => update(d.id, { confidence: e.target.value as Confidence })}>
                {CONFIDENCE.map((c) => (
                  <option key={c} value={c}>
                    {t(`onboarding.confidence.${c}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" disabled={busy} onClick={() => addRow()}>
          <Plus className="size-4" aria-hidden />
          {t('onboarding.dependencyAdd')}
        </Button>
        <Button type="button" variant="secondary" disabled={busy || !hasFilled} onClick={() => run(saveDrafts)}>
          {t('onboarding.dependencySave')}
        </Button>
      </div>
      <p className="mt-2 text-[14px] text-ink-secondary">{t('onboarding.dependencyContinueSaves')}</p>
    </Card>
  );
}
