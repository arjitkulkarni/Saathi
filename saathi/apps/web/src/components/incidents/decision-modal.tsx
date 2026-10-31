'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { AlertTriangle, ArrowLeft, Eye } from 'lucide-react';
import type { ScenarioAvailability, ScenarioOption, ScenarioPrompt } from '@saathi/domain';
import type { Msg, Urgency } from '@saathi/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, urgencyTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { ApiError, apiGet, apiSend, newIdempotencyKey, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type QueuedIncident = { id: string; title: Msg; urgency: Urgency; openedAt: string };
type PromptResponse = { incidentId: string; title: Msg; urgency: Urgency; observedAt: string; facts: Msg[]; uncertain: Msg[]; simulated: boolean; prompt: ScenarioPrompt };
type DecisionResult = { recorded: boolean; alreadyDecided: boolean; responseKey: string; actionResults: { actionType: string; actionId: string | null; duplicate: boolean; error: string | null }[] };

const AVAILABILITY_LABEL_KEY: Record<ScenarioAvailability, string> = { available: 'decisionModal.statusAvailable', manual: 'decisionModal.statusManual', unavailable: 'decisionModal.statusUnavailable' };

/**
 * Scenario-based incident popup (frontend spec). Mounted once for the whole authenticated
 * app (see app/layout.tsx), shown only when the signed-in role can decide (owner/approver —
 * the needing-decision endpoint itself rejects anyone else, so a read-only viewer never has a
 * reason for this to render). Polls for actionable incidents; while one is queued it shows a
 * non-dismissible modal for exactly one at a time, prioritized server-side by urgency and age.
 */
export function IncidentDecisionModal() {
  const { t, r, time } = useI18n();
  const { data: queue } = usePolling<QueuedIncident[]>('/api/v1/incidents/needing-decision', [], () => true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptResponse | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<ScenarioOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const idempotencyKeys = useRef(new Map<string, string>());

  const list = queue ?? [];

  // Pick the next incident to show only when nothing is currently active, or the active one
  // left the queue (decided elsewhere, e.g. another tab) — never swap away from an incident
  // the user is actively looking at just because the poll reordered the queue.
  useEffect(() => {
    if (activeId && list.some((x) => x.id === activeId)) return;
    setActiveId(list[0]?.id ?? null);
  }, [list, activeId]);

  useEffect(() => {
    if (!activeId) {
      setPrompt(null);
      setSelected(null);
      setResult(null);
      return;
    }
    let cancelled = false;
    setPrompt(null);
    setLoadError(false);
    setSelected(null);
    setSubmitError(null);
    setResult(null);
    if (!idempotencyKeys.current.has(activeId)) idempotencyKeys.current.set(activeId, newIdempotencyKey());
    apiGet<PromptResponse>(`/api/v1/incidents/${activeId}/decision-prompt`)
      .then((p) => {
        if (!cancelled) setPrompt(p);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, reloadTick]);

  async function submit(responseKey: string) {
    if (!activeId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const idempotencyKey = idempotencyKeys.current.get(activeId)!;
      const res = await apiSend<DecisionResult>(`/api/v1/incidents/${activeId}/decisions`, 'POST', { responseKey, idempotencyKey });
      setResult(res);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('states.errorBody'));
    } finally {
      setSubmitting(false);
    }
  }

  function closeAndAdvance() {
    idempotencyKeys.current.delete(activeId!);
    setActiveId(null); // the effect above immediately picks the next queued incident, if any
  }

  if (!activeId) return null;
  const remaining = list.length - 1;

  return (
    <Dialog.Root open modal>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40" />
        <Dialog.Content
          className="saathi-fade fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(94vw,640px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-[18px] bg-surface p-6 shadow-[var(--shadow-raised)]"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          aria-describedby={undefined}
        >
          {!prompt ? (
            loadError ? (
              <>
                <Dialog.Title className="text-[18px] font-semibold">{t('states.errorTitle')}</Dialog.Title>
                <Notice tone="danger" className="mt-3" role="alert">
                  {t('states.errorBody')}
                </Notice>
                <Button className="mt-4" onClick={() => setReloadTick((n) => n + 1)}>
                  {t('decisionModal.retry')}
                </Button>
              </>
            ) : (
              <p className="py-10 text-center text-[15px] text-ink-secondary" role="status">
                {t('common.loading')}
              </p>
            )
          ) : result ? (
            <ResultView result={result} onClose={closeAndAdvance} remaining={remaining} t={t} />
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <Dialog.Title className="flex items-center gap-2 text-[20px] font-semibold">
                  <AlertTriangle aria-hidden className="size-5 text-warning-ink" />
                  {r(prompt.title)}
                </Dialog.Title>
                <StatusBadge tone={urgencyTone(prompt.urgency)} label={t(`status.urgency.${prompt.urgency}`)} />
              </div>
              {prompt.simulated && (
                <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-semibold tracking-wide text-warning-ink">
                  <Eye aria-hidden className="size-3.5" />
                  {t('decisionModal.simulatedBadge')}
                </span>
              )}
              <p className="mt-2 text-[14px] text-ink-secondary">
                <Time iso={prompt.observedAt} />
              </p>
              {prompt.simulated && <Notice tone="neutral" className="mt-3">{t('decisionModal.simulatedNote')}</Notice>}

              {selected ? (
                <OptionDetail option={selected} onBack={() => setSelected(null)} onSubmit={submit} submitting={submitting} error={submitError} t={t} r={r} />
              ) : (
                <>
                  <Notice tone="warning" className="mt-3">{r(prompt.prompt.message)}</Notice>
                  {prompt.facts.length > 0 && (
                    <section className="mt-4">
                      <h2 className="text-[14px] font-semibold text-ink-secondary">{t('decisionModal.whatWasObserved')}</h2>
                      <ul className="mt-1.5 space-y-1 text-[15px]">
                        {prompt.facts.map((f, i) => (
                          <li key={i}>{r(f)}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {prompt.uncertain.length > 0 && (
                    <section className="mt-3">
                      <h2 className="text-[14px] font-semibold text-ink-secondary">{t('decisionModal.whatIsUncertain')}</h2>
                      <ul className="mt-1.5 space-y-1 text-[15px] text-ink-secondary">
                        {prompt.uncertain.map((f, i) => (
                          <li key={i}>{r(f)}</li>
                        ))}
                      </ul>
                    </section>
                  )}
                  <OptionList prompt={prompt.prompt} onSelect={setSelected} t={t} r={r} />
                </>
              )}
              {remaining > 0 && <p className="mt-4 text-[13px] text-ink-secondary">{t('decisionModal.queueCount', { count: remaining })}</p>}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OptionList({ prompt, onSelect, t, r }: { prompt: ScenarioPrompt; onSelect: (o: ScenarioOption) => void; t: (k: string, p?: Record<string, unknown>) => string; r: (m: Msg) => string }) {
  const recommended = prompt.options.find((o) => o.recommended) ?? null;
  const others = prompt.options.filter((o) => o !== recommended);
  const row = (o: ScenarioOption) => (
    <li key={o.key}>
      <button type="button" onClick={() => onSelect(o)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[12px] border border-border-subtle bg-surface px-3 py-2.5 text-left hover:bg-canvas-warm">
        <span className="text-[15px] font-medium">{r(o.label)}</span>
        <StatusBadge tone={o.availability === 'available' ? 'success' : o.availability === 'manual' ? 'neutral' : 'danger'} label={t(AVAILABILITY_LABEL_KEY[o.availability])} />
      </button>
    </li>
  );
  return (
    <div className="mt-4 space-y-4">
      {recommended && (
        <section>
          <h2 className="text-[14px] font-semibold text-ink-secondary">{t('decisionModal.recommended')}</h2>
          <ul className="mt-1.5">{row(recommended)}</ul>
        </section>
      )}
      {others.length > 0 && (
        <section>
          <h2 className="text-[14px] font-semibold text-ink-secondary">{t('decisionModal.otherResponses')}</h2>
          <ul className="mt-1.5 space-y-1.5">{others.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function OptionDetail({
  option,
  onBack,
  onSubmit,
  submitting,
  error,
  t,
  r,
}: {
  option: ScenarioOption;
  onBack: () => void;
  onSubmit: (responseKey: string) => void;
  submitting: boolean;
  error: string | null;
  t: (k: string, p?: Record<string, unknown>) => string;
  r: (m: Msg) => string;
}) {
  const isDevice = option.kind === 'device_action' || option.kind === 'device_action_combo';
  const isMonitor = option.kind === 'monitor';
  return (
    <div className="mt-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-brand-action-hover hover:underline">
        <ArrowLeft aria-hidden className="size-4" />
        {t('decisionModal.backToOptions')}
      </button>
      <Card className="mt-3">
        <h2 className="text-[18px] font-semibold">{r(option.label)}</h2>
        <div className="mt-2">
          <StatusBadge tone={option.availability === 'available' ? 'success' : option.availability === 'manual' ? 'neutral' : 'danger'} label={t(AVAILABILITY_LABEL_KEY[option.availability])} />
        </div>
        {option.unavailableReason && (
          <Notice tone="danger" className="mt-3">
            {r(option.unavailableReason)}
          </Notice>
        )}
        {option.benefit && (
          <section className="mt-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{t('decisionModal.benefit')}</h3>
            <p className="mt-1 text-[15px]">{r(option.benefit)}</p>
          </section>
        )}
        {option.consequences.length > 0 && (
          <section className="mt-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{t('decisionModal.consequences')}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[15px]">
              {option.consequences.map((c, i) => (
                <li key={i}>{r(c)}</li>
              ))}
            </ul>
          </section>
        )}
        {option.scope && (
          <section className="mt-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{t('decisionModal.scope')}</h3>
            <p className="mt-1 text-[15px]">{r(option.scope)}</p>
          </section>
        )}
        {option.reversible !== null && (
          <section className="mt-3">
            <h3 className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{t('decisionModal.reversible')}</h3>
            <p className="mt-1 text-[15px]">{option.reversible ? t('decisionModal.reversibleYes') : t('decisionModal.reversibleNo')}</p>
          </section>
        )}
        {isMonitor && <Notice tone="neutral" className="mt-3">{t('decisionModal.monitoringNote')}</Notice>}
        {error && (
          <Notice tone="danger" className="mt-3" role="alert">
            {error} <Button size="sm" variant="secondary" className="ml-2" onClick={() => onSubmit(option.key)} disabled={submitting}>{t('decisionModal.retry')}</Button>
          </Notice>
        )}
        {!error && (
          <Button className="mt-4" disabled={submitting || option.availability === 'unavailable'} onClick={() => onSubmit(option.key)}>
            {submitting
              ? isDevice
                ? t('decisionModal.approving')
                : t('decisionModal.acknowledging')
              : isDevice
                ? t('decisionModal.approve')
                : isMonitor
                  ? t('decisionModal.confirmMonitoring')
                  : t('decisionModal.manualAcknowledge')}
          </Button>
        )}
      </Card>
    </div>
  );
}

function ResultView({ result, onClose, remaining, t }: { result: DecisionResult; onClose: () => void; remaining: number; t: (k: string, p?: Record<string, unknown>) => string }) {
  const partialFailure = result.actionResults.some((a) => a.error);
  return (
    <div>
      <Dialog.Title className="text-[20px] font-semibold">{t('decisionModal.recordedTitle')}</Dialog.Title>
      <Notice tone="success" className="mt-3">
        {t('decisionModal.recordedBody')}
      </Notice>
      {partialFailure && <Notice tone="warning" className="mt-3">{t('decisionModal.partialResultNote')}</Notice>}
      {remaining > 0 && <p className="mt-3 text-[13px] text-ink-secondary">{t('decisionModal.queueCount', { count: remaining })}</p>}
      <Button className="mt-5" onClick={onClose}>
        {t('decisionModal.close')}
      </Button>
    </div>
  );
}
