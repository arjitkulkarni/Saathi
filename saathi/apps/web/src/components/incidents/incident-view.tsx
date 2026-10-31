'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog } from 'radix-ui';
import { ArrowRight, Clock3, Eye, HelpCircle, Hourglass, Info, ListChecks, ShieldOff, Sparkles, Volume2, VolumeX } from 'lucide-react';
import type { ActionOption, IncidentDetailDTO } from '@saathi/contracts';
import { Button, Card, FieldError, Label, Textarea, buttonVariants } from '@/components/ui/primitives';
import { Notice, TechnicalDetails } from '@/components/shared/states';
import { StatusBadge, actionTone, containmentTone, incidentTone, urgencyTone, actionPending } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

const ACTIVE = ['open', 'investigating', 'contained', 'recovering'];

export function IncidentView({ initial }: { initial: IncidentDetailDTO }) {
  const { t, r, time } = useI18n();
  const router = useRouter();
  const { data } = usePolling<IncidentDetailDTO>(`/api/v1/incidents/${initial.id}`, initial, (d) => !!d && ACTIVE.includes(d.state));
  const inc = data ?? initial;
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recommended = inc.options.find((o) => o.recommended) ?? null;
  const alternatives = inc.options.filter((o) => o !== recommended);
  const throttle = inc.activeRestrictions.find((x) => x.kind === 'throttle');
  const pause = inc.activeRestrictions.find((x) => x.kind === 'pause' || x.kind === 'disable_account');

  async function preview(o: ActionOption) {
    setBusy(`${o.actionType}:${o.targetId}`);
    setError(null);
    try {
      const { previewId } = await apiSend<{ previewId: string }>(`/api/v1/incidents/${inc.id}/previews`, 'POST', { actionType: o.actionType, targetType: o.targetType, targetId: o.targetId, params: o.params });
      router.push(`/app/incidents/${inc.id}/preview/${previewId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(null);
    }
  }

  async function startRecovery() {
    setBusy('recovery');
    try {
      const r0 = await apiSend<{ caseId: string }>(`/api/v1/incidents/${inc.id}/recovery`, 'POST');
      router.push(`/app/incidents/${inc.id}/recovery?case=${r0.caseId}`);
    } catch (e) {
      if (e instanceof ApiError && e.details?.reauth) window.location.assign(`/login?reauth=1&next=${encodeURIComponent(`/app/incidents/${inc.id}`)}`);
      else setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(null);
    }
  }

  async function createReport() {
    setBusy('report');
    try {
      const { reportId } = await apiSend<{ reportId: string }>(`/api/v1/incidents/${inc.id}/report`, 'POST');
      router.push(`/app/reports/${reportId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(null);
    }
  }

  const speechText = useMemo(() => [r(inc.title), ...inc.facts.map(r), ...inc.uncertain.map(r), r(inc.nextStep)].join('. '), [inc, r]);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,740px)_1fr]">
      <article className="min-w-0" aria-labelledby="incident-title">
        <Link href="/app/incidents" className="mb-4 inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
          ← {t('nav.incidents')}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={incidentTone(inc.state)} label={t(`status.incident.${inc.state}`)} />
          <StatusBadge tone={urgencyTone(inc.urgency)} label={t(`status.urgency.${inc.urgency}`)} />
          {inc.isReplay && <StatusBadge tone="neutral" label={t('common.replayBadge')} />}
        </div>
        <h1 id="incident-title" className="mt-3 text-[26px] font-semibold leading-tight text-ink sm:text-[30px]">
          {r(inc.title)}
        </h1>

        {/* 2. Scope and freshness */}
        <section aria-label={t('incident.scope')} className="mt-4 rounded-[14px] border border-border-subtle bg-surface px-4 py-3 text-[15px]">
          <p className="text-ink">
            <Eye aria-hidden className="mr-2 inline size-4 align-[-2px] text-ink-secondary" />
            {t('incident.scopeObserved', { sources: inc.scope.sources.map(r).join(', ') || '—', time: time(inc.scope.observedAt) })}
          </p>
          {inc.scope.freshness !== 'fresh' && <p className="mt-1 text-warning-ink">{t('states.staleBody', { time: time(inc.scope.observedAt) })}</p>}
          {inc.scope.excluded.length > 0 && (
            <p className="mt-1 text-ink-secondary">
              {t('incident.scopeExcluded')}: {inc.scope.excluded.map(r).join(', ')}
            </p>
          )}
        </section>

        {/* 3. What happened */}
        <section className="mt-8" aria-labelledby="facts-h">
          <h2 id="facts-h" className="flex items-center gap-2 text-[18px] font-semibold">
            <ListChecks aria-hidden className="size-5 text-ink-secondary" />
            {t('incident.whatHappened')}
          </h2>
          <ul className="mt-3 space-y-2.5 text-[18px] leading-[1.6]">
            {inc.facts.map((f, i) => (
              <li key={i} className="flex gap-3">
                <span aria-hidden className="mt-[11px] size-1.5 shrink-0 rounded-full bg-ink" />
                <span>{r(f)}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* 4. What is uncertain — visible without expansion */}
        {inc.uncertain.length > 0 && (
          <section className="mt-6 rounded-[14px] border border-warning-ink/20 bg-warning-soft px-4 py-3" aria-labelledby="unc-h">
            <h2 id="unc-h" className="flex items-center gap-2 text-[16px] font-semibold text-warning-ink">
              <HelpCircle aria-hidden className="size-5" />
              {t('incident.whatUncertain')}
            </h2>
            <ul className="mt-2 space-y-1.5 text-[17px] leading-relaxed text-ink">
              {inc.uncertain.map((u, i) => (
                <li key={i}>{r(u)}</li>
              ))}
            </ul>
          </section>
        )}

        {/* 5. Already limited — only when a real restriction exists */}
        {(throttle || pause) && (
          <section className="mt-6 rounded-[14px] border border-border-subtle bg-canvas-warm px-4 py-3" aria-labelledby="lim-h">
            <h2 id="lim-h" className="flex items-center gap-2 text-[16px] font-semibold">
              <Hourglass aria-hidden className="size-5 text-ink-secondary" />
              {t('incident.alreadyLimited')}
            </h2>
            {throttle && <p className="mt-1.5 text-[16px] tabular">{t('incident.limitEnds', { target: throttle.targetLabel, rate: throttle.ratePerMinute ?? 1, time: time(throttle.expiresAt) })}</p>}
            {pause && <p className="mt-1.5 text-[16px]">{t('incident.pausedBy', { target: pause.targetLabel })}</p>}
          </section>
        )}

        {error && (
          <Notice tone="danger" className="mt-6" role="alert">
            {error}
          </Notice>
        )}

        {/* 6–7. Recommended next step + primary CTA */}
        {inc.permissions.canPreview && (
          <section className="mt-8" aria-labelledby="rec-h">
            <h2 id="rec-h" className="text-[18px] font-semibold">
              {t('incident.recommended')}
            </h2>
            {recommended ? (
              <Card className="mt-3 border-brand-art/30">
                <p className="text-[17px] font-semibold">{t(`action.title.${recommended.actionType.replace('.', '_')}`)}</p>
                <p className="mt-1 text-[16px] leading-relaxed text-ink-secondary">{r(recommended.reason)}</p>
                <Button size="lg" className="mt-4 w-full sm:w-auto" onClick={() => preview(recommended)} disabled={!!busy}>
                  {busy === `${recommended.actionType}:${recommended.targetId}` ? t('preview.updating') : t('incident.reviewWho')}
                  <ArrowRight aria-hidden />
                </Button>
              </Card>
            ) : (
              <Notice tone="neutral" className="mt-3" title={t('incident.noRecommendation')}>
                {r(inc.noSupportedOption)}
              </Notice>
            )}
          </section>
        )}

        {/* 8. Alternatives */}
        {inc.permissions.canPreview && (alternatives.length > 0 || inc.state !== 'recovered') && (
          <section className="mt-8" aria-labelledby="alt-h">
            <h2 id="alt-h" className="text-[16px] font-semibold">
              {t('incident.alternatives')}
            </h2>
            <ul className="mt-3 divide-y divide-border-subtle rounded-[14px] border border-border-subtle bg-surface">
              {alternatives.map((o) => (
                <li key={`${o.actionType}:${o.targetId}:${JSON.stringify(o.params)}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{t(`action.title.${o.actionType.replace('.', '_')}`)}</p>
                    <p className="text-[15px] text-ink-secondary">{r(o.reason)}</p>
                  </div>
                  <Button variant="secondary" onClick={() => preview(o)} disabled={!!busy}>
                    {t('incident.reviewWho')}
                  </Button>
                </li>
              ))}
              <li className="px-4 py-3">
                <p className="font-medium">{t('incident.continueInvestigating')}</p>
                <p className="text-[15px] text-ink-secondary">{t('incident.continueInvestigatingBody')}</p>
              </li>
            </ul>
          </section>
        )}

        {inc.boundaries.length > 0 && (
          <section className="mt-8" aria-labelledby="bnd-h">
            <h2 id="bnd-h" className="flex items-center gap-2 text-[16px] font-semibold">
              <ShieldOff aria-hidden className="size-5 text-ink-secondary" />
              {t('incident.boundaries')}
            </h2>
            <ul className="mt-2 space-y-1.5 text-[16px] text-ink">
              {inc.boundaries.map((b, i) => (
                <li key={i}>{r(b)}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-8 flex flex-wrap gap-2">
          {inc.permissions.canRecover && (
            <Button onClick={startRecovery} disabled={!!busy}>
              {inc.recoveryCaseId ? t('incident.openRecovery') : t('incident.startRecovery')}
            </Button>
          )}
          {inc.recoveryCaseId && !inc.permissions.canRecover && (
            <Link className={buttonVariants({ variant: 'secondary' })} href={`/app/incidents/${inc.id}/recovery?case=${inc.recoveryCaseId}`}>
              {t('incident.openRecovery')}
            </Link>
          )}
          {inc.permissions.canExport &&
            (inc.reportId ? (
              <Link className={buttonVariants({ variant: 'secondary' })} href={`/app/reports/${inc.reportId}`}>
                {t('incident.openReport')}
              </Link>
            ) : (
              <Button variant="secondary" onClick={createReport} disabled={!!busy}>
                {t('incident.createReport')}
              </Button>
            ))}
          {inc.permissions.canDismiss && <DismissDialog incidentId={inc.id} />}
        </div>
      </article>

      {/* Context rail: containment, responses, explain/read aloud, findings, history */}
      <aside className="min-w-0 space-y-5 xl:pt-14">
        <Card>
          <h2 className="text-[15px] font-semibold text-ink-secondary">{t('incident.containment')}</h2>
          <div className="mt-2">
            <StatusBadge tone={containmentTone(inc.containmentAssessment.status)} label={t(`status.containment.${inc.containmentAssessment.status}`)} />
          </div>
          <ul className="mt-3 space-y-1 text-[14px] text-ink-secondary">
            {inc.containmentAssessment.reasons.map((x, i) => (
              <li key={i}>{r(x)}</li>
            ))}
          </ul>
        </Card>
        {inc.actions.length > 0 && (
          <Card>
            <h2 className="text-[15px] font-semibold text-ink-secondary">{t('incident.actionsTitle')}</h2>
            <ul className="mt-2 space-y-2">
              {inc.actions.map((a) => (
                <li key={a.id}>
                  <Link href={`/app/actions/${a.id}`} className="flex min-h-11 flex-col justify-center rounded-[10px] px-2 hover:bg-surface-subtle">
                    <span className="text-[15px] font-medium">{r(a.title)}</span>
                    <span className="mt-0.5">
                      <StatusBadge tone={actionTone(a.state)} pending={actionPending(a.state)} label={t(`status.action.${a.state}`)} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Assist incidentId={inc.id} canExplain={inc.permissions.canExplain} speechText={speechText} />
        <Card>
          <h2 className="text-[15px] font-semibold text-ink-secondary">{t('incident.findingsTitle')}</h2>
          <ul className="mt-2 space-y-3 text-[15px]">
            {inc.findings.map((f) => (
              <li key={f.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t(`rules.${f.ruleId}`)}</span>
                  <StatusBadge tone={f.status === 'open' ? 'warning' : 'success'} label={t(`incident.findingStatus.${f.status}`)} />
                </div>
                {f.facts[0] && <p className="mt-1 text-[14px] text-ink-secondary">{r(f.facts[0])}</p>}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="text-[15px] font-semibold text-ink-secondary">{t('incident.history')}</h2>
          <ol className="mt-3 space-y-3 border-l border-border-subtle pl-4">
            {inc.timeline.map((h, i) => (
              <li key={i} className="relative text-[14px]">
                <span aria-hidden className="absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface bg-border-control" />
                <p className="text-ink">{r(h.text)}</p>
                <p className="text-ink-secondary">
                  <Clock3 aria-hidden className="mr-1 inline size-3.5 align-[-2px]" />
                  <Time iso={h.at} />
                </p>
              </li>
            ))}
          </ol>
        </Card>
        <TechnicalDetails summary={t('incident.sourceDetails')}>
          <dl className="space-y-1 text-[13px]">
            <div>
              <dt className="text-ink-secondary">ID</dt>
              <dd className="font-mono [overflow-wrap:anywhere]">{inc.id}</dd>
            </div>
            {inc.findings.map((f) => (
              <div key={f.id}>
                <dt className="text-ink-secondary">
                  {f.ruleId} v{f.ruleVersion}
                </dt>
                <dd className="font-mono [overflow-wrap:anywhere]">
                  {f.target.type}:{f.target.id} · {f.harmfulCapability}
                </dd>
              </div>
            ))}
          </dl>
        </TechnicalDetails>
      </aside>
    </div>
  );
}

function Assist({ incidentId, canExplain, speechText }: { incidentId: string; canExplain: boolean; speechText: string }) {
  const { t, locale } = useI18n();
  const [explain, setExplain] = useState<{ status: string; summary: string | null; checks: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<'unknown' | 'available' | 'unavailable'>('unknown');
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      const t0 = setTimeout(() => setVoiceState('unavailable'), 0);
      return () => clearTimeout(t0);
    }
    const pick = () => {
      const want = locale === 'en' ? 'en' : locale === 'kn' ? 'kn' : 'hi';
      const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(want));
      voiceRef.current = v ?? null;
      setVoiceState(v ? 'available' : window.speechSynthesis.getVoices().length ? 'unavailable' : 'unknown');
    };
    const first = setTimeout(pick, 0);
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    const timer = setTimeout(() => setVoiceState((s) => (s === 'unknown' ? 'unavailable' : s)), 1500);
    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', pick);
      window.speechSynthesis.cancel();
      clearTimeout(timer);
      clearTimeout(first);
    };
  }, [locale]);

  const toggleSpeech = () => {
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const u = new SpeechSynthesisUtterance(speechText);
    if (voiceRef.current) u.voice = voiceRef.current;
    u.onend = () => setSpeaking(false);
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  };

  return (
    <Card>
      <div className="flex flex-wrap gap-2">
        {canExplain && (
          <Button
            variant="secondary"
            size="sm"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                setExplain(await apiSend(`/api/v1/incidents/${incidentId}/explain?locale=${locale}`, 'POST'));
              } catch {
                setExplain({ status: 'failed', summary: null, checks: [] });
              } finally {
                setLoading(false);
              }
            }}
          >
            <Sparkles aria-hidden />
            {loading ? t('incident.explainPending') : t('incident.explainMore')}
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={toggleSpeech} disabled={voiceState !== 'available'} aria-pressed={speaking}>
          {speaking ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
          {speaking ? t('incident.stopReading') : t('incident.readAloud')}
        </Button>
      </div>
      {voiceState === 'unavailable' && <p className="mt-2 text-[14px] text-ink-secondary">{t('incident.readAloudUnavailable')}</p>}
      <div aria-live="polite">
        {explain && explain.status !== 'used' && (
          <p className="mt-3 flex gap-2 text-[14px] text-ink-secondary">
            <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
            {t('incident.explainUnavailable')}
          </p>
        )}
        {explain?.status === 'used' && explain.summary && (
          <div className="mt-3 rounded-[12px] bg-canvas-warm px-3 py-2.5 text-[15px]">
            <p className="text-[13px] font-medium text-ink-secondary">{t('incident.explainLabel')}</p>
            {/* Rendered strictly as text. */}
            <p className="mt-1 whitespace-pre-line">{explain.summary}</p>
            {explain.checks.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {explain.checks.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

function DismissDialog({ incidentId }: { incidentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost">{t('incident.dismiss')}</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="saathi-fade fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-surface p-6 shadow-[var(--shadow-raised)]">
          <Dialog.Title className="text-[20px] font-semibold">{t('incident.dismissTitle')}</Dialog.Title>
          <Dialog.Description className="mt-1 text-[15px] text-ink-secondary">{t('incident.dismissNote')}</Dialog.Description>
          <form
            className="mt-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await apiSend(`/api/v1/incidents/${incidentId}/dismiss`, 'POST', { reason });
                setOpen(false);
                router.refresh();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : t('states.errorBody'));
              } finally {
                setBusy(false);
              }
            }}
          >
            <Label htmlFor="dismiss-reason">{t('incident.dismissReason')}</Label>
            <Textarea id="dismiss-reason" value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required aria-invalid={!!error} aria-describedby={error ? 'dismiss-err' : undefined} />
            <FieldError id="dismiss-err">{error}</FieldError>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" type="button">
                  {t('common.cancel')}
                </Button>
              </Dialog.Close>
              <Button type="submit" disabled={busy || reason.trim().length < 5}>
                {t('incident.dismissConfirm')}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { cn };
