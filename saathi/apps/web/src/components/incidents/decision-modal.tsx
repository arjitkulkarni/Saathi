'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { AlertTriangle, ArrowLeft, ArrowRight, Eye } from 'lucide-react';
import type { ScenarioOption, ScenarioPrompt } from '@saathi/domain';
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

function optionHelpKey(option: ScenarioOption) {
  if (option.availability === 'unavailable') return 'decisionModal.statusUnavailable';
  if (option.kind === 'review') return 'decisionModal.reviewHelp';
  if (option.kind === 'monitor') return 'decisionModal.monitorHelp';
  if (option.kind === 'manual') return 'decisionModal.statusManual';
  return 'decisionModal.statusAvailable';
}

// Substitute only structured source facts, never infer a device, count, or cause from prose.
function contextualFact(prompt: PromptResponse): Msg {
  const sourceKey = {
    unresolved_malware: 'fact.malware_unresolved',
    protection_disabled: 'fact.protection_disabled',
    password_guessing: 'fact.repeated_wrong_passwords',
    generic: '',
  }[prompt.prompt.scenarioKey];
  const fact = prompt.facts.find((f) => f.key === sourceKey);
  return fact ? { ...fact, key: `decisionModal.story.${prompt.prompt.scenarioKey}.observed` } : prompt.prompt.message;
}

/**
 * Scenario-based incident popup (frontend spec). Mounted once for the whole authenticated
 * app (see app/layout.tsx), shown only when the signed-in role can decide (owner/approver —
 * the needing-decision endpoint itself rejects anyone else, so a read-only viewer never has a
 * reason for this to render). Polls for actionable incidents; while one is queued it shows a
 * non-dismissible modal for exactly one at a time, prioritized server-side by urgency and age.
 */
export function IncidentDecisionModal() {
  const { t, r } = useI18n();
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0 });
  }, [selected, result]);

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
          ref={dialogRef}
          className="saathi-fade fixed left-1/2 top-1/2 z-50 flex max-h-[92dvh] w-[min(94vw,800px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain rounded-[20px] bg-surface p-5 shadow-[var(--shadow-raised)] sm:p-7"
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
              <><Dialog.Title className="sr-only">{t('decisionModal.title')}</Dialog.Title><p className="py-10 text-center text-[15px] text-ink-secondary" role="status">{t('common.loading')}</p></>
            )
          ) : result ? (
            <ResultView result={result} onClose={closeAndAdvance} remaining={remaining} t={t} />
          ) : (
            <>
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                <Dialog.Title className="flex items-start gap-3 text-[22px] font-semibold leading-tight sm:text-[26px]">
                  <AlertTriangle aria-hidden className="mt-1 size-6 shrink-0 text-warning-ink" />
                  {prompt.prompt.scenarioKey === 'generic' ? r(prompt.title) : t(`decisionModal.story.${prompt.prompt.scenarioKey}.title`)}
                </Dialog.Title>
                <StatusBadge className="shrink-0" tone={urgencyTone(prompt.urgency)} label={t(`status.urgency.${prompt.urgency}`)} />
              </div>
              {prompt.simulated && (
                <span className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[12px] font-semibold tracking-wide text-warning-ink">
                  <Eye aria-hidden className="size-3.5" />
                  {t('decisionModal.simulatedBadge')}
                </span>
              )}
              <p className="mt-2 text-[13px] text-ink-secondary">
                <Time iso={prompt.observedAt} />
              </p>
              {prompt.simulated && <p className="mt-2 text-[14px] text-ink-secondary">{t('decisionModal.simulatedNote')}</p>}

              {selected ? (
                <OptionDetail option={selected} onBack={() => setSelected(null)} onSubmit={submit} submitting={submitting} error={submitError} t={t} r={r} />
              ) : (
                <>
                  <section className="mt-5 rounded-[14px] border border-warning-ink/15 bg-warning-soft p-4 sm:p-5">
                    <h2 className="text-[15px] font-semibold">{t('decisionModal.whatWasObserved')}</h2>
                    <p className="mt-2 text-[16px] leading-relaxed">{r(contextualFact(prompt))}</p>
                    <h2 className="mt-4 text-[15px] font-semibold">{t('decisionModal.forYourWork')}</h2>
                    <p className="mt-1 text-[15px] leading-relaxed">{t(`decisionModal.story.${prompt.prompt.scenarioKey}.meaning`)}</p>
                  </section>
                  <OptionList prompt={prompt.prompt} onSelect={setSelected} t={t} r={r} />
                  <details className="mt-5 border-t border-border-subtle pt-3 text-[14px]">
                    <summary className="cursor-pointer rounded font-medium text-ink-secondary focus-visible:outline-3 focus-visible:outline-focus">{t('decisionModal.showDetails')}</summary>
                    <ul className="mt-3 space-y-2 break-words">{prompt.facts.map((f, i) => <li key={i}>{r(f)}</li>)}</ul>
                    {prompt.uncertain.length > 0 && <><h3 className="mt-3 font-semibold">{t('decisionModal.whatIsUncertain')}</h3><ul className="mt-1 space-y-2">{prompt.uncertain.map((f, i) => <li key={i}>{r(f)}</li>)}</ul></>}
                  </details>
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
      <button type="button" onClick={() => onSelect(o)} className={`flex h-full min-h-11 w-full flex-col items-start rounded-[14px] border p-4 text-left transition-colors hover:bg-canvas-warm focus-visible:outline-3 focus-visible:outline-focus ${o.recommended ? 'border-brand-action bg-canvas-warm' : 'border-border-subtle bg-surface'}`}>
        {o.recommended && <span className="mb-2 text-[12px] font-semibold text-brand-action-hover">{t('decisionModal.recommended')}</span>}
        <span className="text-[17px] font-semibold leading-snug">{r(o.label)}</span>
        <span className="mt-1 text-[12px] font-medium text-ink-secondary">{t(optionHelpKey(o))}</span>
        {o.benefit && <span className="mt-3 text-[14px] leading-relaxed">{r(o.benefit)}</span>}
        <span className="mt-3 text-[13px] font-semibold">{t('decisionModal.consequences')}</span>
        <span className="mt-1 space-y-1 text-[14px] leading-relaxed text-ink-secondary">
          {o.consequences.map((c, i) => <span className="block" key={i}>{r(c)}</span>)}
        </span>
        {o.unavailableReason && <span className="mt-3 text-[13px] text-warning-ink">{r(o.unavailableReason)}</span>}
        <span className="mt-auto flex items-center gap-2 pt-4 text-[13px] font-semibold text-brand-action-hover">{t(o.availability === 'unavailable' ? 'decisionModal.seeWhy' : 'decisionModal.reviewConsequences')}<ArrowRight aria-hidden className="size-4" /></span>
      </button>
    </li>
  );
  return (
    <div className="mt-6">
      <h2 className="text-[18px] font-semibold">{t('decisionModal.chooseNext')}</h2>
      <p className="mt-1 text-[14px] text-ink-secondary">{t('decisionModal.chooseHint')}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">{(recommended ? [recommended, ...others] : others).map(row)}</ul>
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
      <button type="button" disabled={submitting} onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-brand-action-hover hover:underline focus-visible:outline-3 focus-visible:outline-focus">
        <ArrowLeft aria-hidden className="size-4" />
        {t('decisionModal.backToOptions')}
      </button>
      <Card className="mt-3">
        <h2 className="text-[18px] font-semibold">{r(option.label)}</h2>
        <div className="mt-2">
          <p className="text-[14px] text-ink-secondary">{t(optionHelpKey(option))}</p>
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
        {(option.kind === 'manual' || option.kind === 'review' || option.key === 'verify_owner') && (
          <section className="mt-4 rounded-[12px] bg-canvas-warm p-4">
            <h3 className="text-[15px] font-semibold">{t('decisionModal.yourNextStep')}</h3>
            <p className="mt-2 text-[15px] leading-relaxed">{t(option.key === 'disconnect' ? 'decisionModal.disconnectSteps' : option.key === 'verify_owner' ? 'decisionModal.verifySteps' : 'decisionModal.reviewSteps')}</p>
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
