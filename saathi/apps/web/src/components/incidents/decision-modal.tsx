'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, CircleDashed, Loader2 } from 'lucide-react';
import type { ScenarioOption, ScenarioPrompt } from '@saathi/domain';
import type { ActionDetailDTO, Msg, Urgency } from '@saathi/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, actionPending, actionTone, urgencyTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { ApiError, apiSend, newIdempotencyKey, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type QueuedIncident = { id: string; title: Msg; urgency: Urgency; openedAt: string };
type PromptResponse = { incidentId: string; title: Msg; urgency: Urgency; observedAt: string; facts: Msg[]; uncertain: Msg[]; simulated: boolean; prompt: ScenarioPrompt };
type DecisionResult = { recorded: boolean; alreadyDecided: boolean; responseKey: string; actionResults: { actionType: string; actionId: string | null; duplicate: boolean; error: string | null }[]; simulationResult?: { state: 'confirmed'; outcome: Msg } };

const isRepair = (option: ScenarioOption) => ['device_action', 'device_action_combo', 'simulation_action'].includes(option.kind) && option.availability === 'available';

// Four checkpoints shown while a fix request is in flight, so the person sees real progress
// rather than a single frozen line (frontend spec: decision modal). Each tick is purely a
// "this is what is happening now" label — it never claims a step passed or failed; only the
// final result (from the server) ever says the issue is resolved.
const REPAIR_STAGES = ['decisionModal.repair.stage.contact', 'decisionModal.repair.stage.apply', 'decisionModal.repair.stage.check', 'decisionModal.repair.stage.finish'] as const;
// ~15s per checkpoint, ~1 minute total — paced like a real device round trip (poll, apply,
// re-check), not an arbitrary animation. A real device/agent genuinely takes this long; a
// browser-practice fix (decision.ts repairBrowserPreview) is bounded and instant server-side,
// so for that one case the reveal of the already-known result is held to this same pace
// (see withMinDelay below) rather than resolving faster than a real device ever could.
const REPAIR_STAGE_MS = 15_000;

function RepairStages({ t }: { t: (k: string) => string }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = REPAIR_STAGES.slice(1).map((_, i) => setTimeout(() => setStage(i + 1), (i + 1) * REPAIR_STAGE_MS));
    return () => timers.forEach(clearTimeout);
  }, []);
  return (
    <ul className="mt-4 space-y-2" aria-live="polite">
      {REPAIR_STAGES.map((key, i) => {
        const done = i < stage;
        const current = i === stage;
        return (
          <li key={key} className="flex items-center gap-2 text-[15px]">
            {done ? (
              <CheckCircle2 aria-hidden className="size-4 shrink-0 text-success-ink" />
            ) : current ? (
              <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-ink-secondary" />
            ) : (
              <CircleDashed aria-hidden className="size-4 shrink-0 text-ink-secondary" />
            )}
            <span className={done || current ? 'text-ink' : 'text-ink-secondary'}>{t(key)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Waits for both the real response and a minimum elapsed time, so a fast server response
 * is never revealed faster than a real device round trip would be. Never fabricates a
 * different result — it is the same server response, just not shown before its time. */
async function withMinDelay<T>(p: Promise<T>, minMs: number): Promise<T> {
  const [res] = await Promise.all([p, new Promise((resolve) => setTimeout(resolve, minMs))]);
  return res;
}

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
  const [activeId, setActiveId] = useState<string | null>(null);
  const { data: queue, mutate: refreshQueue } = usePolling<QueuedIncident[]>('/api/v1/incidents/needing-decision', [], () => true, {
    // Hold the current dialogue through submission and result display, even after
    // the server removes it from the decision queue. A keyed child resets state.
    onSuccess: items => setActiveId(current => current ?? items[0]?.id ?? null),
  });
  if (!activeId) return null;
  const closeAndAdvance = async () => {
    const latest = await refreshQueue();
    setActiveId(latest?.find(x => x.id !== activeId)?.id ?? null);
  };
  return <DecisionDialog key={activeId} activeId={activeId} remaining={(queue ?? []).filter(x => x.id !== activeId).length} onClose={closeAndAdvance} />;
}

function DecisionDialog({ activeId, remaining, onClose }: { activeId: string; remaining: number; onClose: () => Promise<void> }) {
  const { t, r } = useI18n();
  const { data: prompt, error: loadError, mutate: refreshPrompt } = usePolling<PromptResponse>(`/api/v1/incidents/${activeId}/decision-prompt`, undefined, () => false);
  const [selected, setSelected] = useState<ScenarioOption | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [idempotencyKey] = useState(newIdempotencyKey);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0 });
  }, [selected, result]);

  async function submit(responseKey: string) {
    if (!activeId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const call = apiSend<DecisionResult>(`/api/v1/incidents/${activeId}/decisions`, 'POST', { responseKey, idempotencyKey });
      // A browser-practice fix (simulation_action) resolves instantly server-side — it is a
      // bounded simulator, not a real device. Pace its reveal to the same checkpoints a real
      // device round trip would take, rather than showing "resolved" faster than any real fix
      // ever could. An error still surfaces immediately — Promise.all rejects without waiting.
      const res = selected?.kind === 'simulation_action' ? await withMinDelay(call, REPAIR_STAGE_MS * REPAIR_STAGES.length) : await call;
      setResult(res);
    } catch (e) {
      setSubmitError(e instanceof ApiError ? e.message : t('states.errorBody'));
    } finally {
      setSubmitting(false);
    }
  }

  async function closeAndAdvance() {
    // Refresh before advancing: a successful decision has already left the server queue.
    // Keep its outcome visible until the user has had a chance to read it.
    try {
      await onClose();
    } catch {
      setSubmitError(t('decisionModal.submitError'));
    }
  }

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
                <Button className="mt-4" onClick={() => refreshPrompt()}>
                  {t('decisionModal.retry')}
                </Button>
              </>
            ) : (
              <><Dialog.Title className="sr-only">{t('decisionModal.title')}</Dialog.Title><p className="py-10 text-center text-[15px] text-ink-secondary" role="status">{t('common.loading')}</p></>
            )
          ) : result ? (
            <ResultView result={result} onClose={closeAndAdvance} remaining={remaining} t={t} r={r} error={submitError} />
          ) : (
            <>
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                <Dialog.Title className="flex items-start gap-3 text-[22px] font-semibold leading-tight sm:text-[26px]">
                  <AlertTriangle aria-hidden className="mt-1 size-6 shrink-0 text-warning-ink" />
                  {prompt.prompt.scenarioKey === 'generic' ? r(prompt.title) : t(`decisionModal.story.${prompt.prompt.scenarioKey}.title`)}
                </Dialog.Title>
                <StatusBadge className="shrink-0" tone={urgencyTone(prompt.urgency)} label={t(`status.urgency.${prompt.urgency}`)} />
              </div>
              <p className="mt-2 text-[13px] text-ink-secondary">
                <Time iso={prompt.observedAt} />
              </p>

              {selected ? (
                <OptionDetail option={selected} onBack={() => setSelected(null)} onSubmit={submit} submitting={submitting} error={submitError} t={t} r={r} onChooseRepair={() => setSelected(prompt.prompt.options.find(isRepair) ?? null)} hasRepair={prompt.prompt.options.some(isRepair)} />
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
  onChooseRepair,
  hasRepair,
}: {
  option: ScenarioOption;
  onBack: () => void;
  onSubmit: (responseKey: string) => void;
  submitting: boolean;
  error: string | null;
  t: (k: string, p?: Record<string, unknown>) => string;
  r: (m: Msg) => string;
  onChooseRepair: () => void;
  hasRepair: boolean;
}) {
  const isDevice = isRepair(option);
  const isMonitor = option.kind === 'monitor';
  const guidanceOnly = option.kind === 'manual' || option.kind === 'review' || option.availability === 'unavailable';
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
        {submitting && (isDevice ? <RepairStages t={t} /> : <p role="status" aria-live="polite" className="mt-4 text-[15px]">{t('decisionModal.acknowledging')}</p>)}
        {error && (
          <Notice tone="danger" className="mt-3" role="alert">
            {error} <Button size="sm" variant="secondary" className="ml-2" onClick={() => onSubmit(option.key)} disabled={submitting}>{t('decisionModal.retry')}</Button>
          </Notice>
        )}
        {guidanceOnly ? (
          <Button className="mt-4" onClick={onChooseRepair}>{t(hasRepair ? 'decisionModal.repair.reviewFix' : 'decisionModal.backToOptions')}</Button>
        ) : !error && (
          <Button className="mt-4" disabled={submitting || option.availability === 'unavailable'} onClick={() => onSubmit(option.key)}>
            {submitting
              ? isDevice
                ? t('decisionModal.approving')
                : t('decisionModal.acknowledging')
              : isDevice
                ? t(option.key === 'scan' ? 'decisionModal.repair.startCheck' : 'decisionModal.repair.fixNow')
                : t('decisionModal.confirmMonitoring')}
          </Button>
        )}
      </Card>
    </div>
  );
}

function ResultView({ result, onClose, remaining, t, r, error }: { result: DecisionResult; onClose: () => void; remaining: number; t: (k: string, p?: Record<string, unknown>) => string; r: (m: Msg) => string; error: string | null }) {
  const partialFailure = result.actionResults.some((a) => a.error);
  const actionIds = [...new Set(result.actionResults.flatMap(a => a.actionId ? [a.actionId] : []))];
  return (
    <div>
      <Dialog.Title className="text-[20px] font-semibold">{t(result.simulationResult ? 'decisionModal.repair.practiceDone' : actionIds.length ? 'decisionModal.repair.progress' : 'decisionModal.recordedTitle')}</Dialog.Title>
      {result.simulationResult ? <Notice tone="success" className="mt-4">{r(result.simulationResult.outcome)}</Notice> : actionIds.length ? actionIds.map(id => <RepairActionStatus key={id} actionId={id} />) : <Notice tone="neutral" className="mt-3">{t('decisionModal.monitoringNote')}</Notice>}
      {partialFailure && <Notice tone="warning" className="mt-3">{t('decisionModal.partialResultNote')}</Notice>}
      {error && <Notice tone="danger" role="alert" className="mt-3">{error}</Notice>}
      {remaining > 0 && <p className="mt-3 text-[13px] text-ink-secondary">{t('decisionModal.queueCount', { count: remaining })}</p>}
      <Button className="mt-5" onClick={onClose}>
        {t('decisionModal.close')}
      </Button>
    </div>
  );
}

function RepairActionStatus({ actionId }: { actionId: string }) {
  const { t, r } = useI18n();
  const { data, error, mutate } = usePolling<ActionDetailDTO>(`/api/v1/actions/${actionId}`, undefined, d => !d || actionPending(d.state) || d.state === 'unknown');
  return <Card className="mt-4" aria-live="polite">
    {data ? <>
      <p className="font-semibold">{r(data.title)}</p>
      <StatusBadge className="mt-2" tone={actionTone(data.state)} pending={actionPending(data.state)} label={t(`status.action.${data.state}`)} />
      <p className="mt-3 text-[15px]">{t(`decisionModal.repair.result.${data.state}`)}</p>
      {data.actionType === 'device.request_av_scan' && <p className="mt-2 text-[14px]">{t('decisionModal.repair.scanBoundary')}</p>}
      <details className="mt-3 text-[14px]"><summary className="cursor-pointer">{t('decisionModal.showDetails')}</summary><p className="mt-2">{r(data.outcome)}</p></details>
      {data.remainingFindings.length > 0 && <p className="mt-2 text-[14px] text-warning-ink">{t('decisionModal.repair.remaining')}</p>}
    </> : <p>{t('decisionModal.repair.checking')}</p>}
    {error && <p role="alert" className="mt-2">{t('decisionModal.repair.statusUnknown')}</p>}
    <Button variant="secondary" className="mt-3" onClick={() => mutate()}>{t('action.checkStatus')}</Button>
  </Card>;
}
