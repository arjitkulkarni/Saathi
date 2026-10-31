'use client';

import Link from 'next/link';
import { Ban, Check, CheckCircle2, CircleDashed, Monitor, ShieldCheck, XCircle } from 'lucide-react';
import type { ActionDetailDTO, ActionState, ProbeDTO } from '@saathi/contracts';
import { Button, Card, buttonVariants } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, actionPending, actionTone, checkTone, containmentTone, evidenceTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { usePolling } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

const STEPS = ['accepted', 'applying', 'checking', 'outcome'] as const;
function stepIndex(s: ActionState): number {
  if (s === 'requested') return 0;
  if (s === 'queued') return 1;
  if (s === 'executing') return 2;
  return 3;
}

function SessionCard({ probe, kind }: { probe: ProbeDTO | undefined; kind: 'target' | 'other' }) {
  const { t, r } = useI18n();
  const title = kind === 'target' ? t('action.selectedSession') : t('action.otherSession');
  if (!probe) {
    return (
      <div className="rounded-[16px] border border-border-subtle bg-surface p-5">
        <p className="text-[14px] font-medium text-ink-secondary">{title}</p>
        <p className="mt-2 flex items-center gap-2 text-[18px] font-semibold text-neutral-ink">
          <CircleDashed aria-hidden className="size-5" />
          {t('action.notChecked')}
        </p>
      </div>
    );
  }
  const pass = probe.result === 'pass';
  const stoppedText = probe.observed === 'deny' ? t('action.accessStopped') : probe.observed === 'throttle' ? t('action.accessLimited') : t('action.accessRemains');
  return (
    <div className={cn('rounded-[16px] border bg-surface p-5', pass ? 'border-success-ink/30' : 'border-danger-ink/30')}>
      <p className="text-[14px] font-medium text-ink-secondary">{title}</p>
      <p className={cn('mt-2 flex items-center gap-2 text-[19px] font-semibold', pass ? 'text-success-ink' : 'text-danger-ink')}>
        {pass ? kind === 'target' ? <Ban aria-hidden className="saathi-check size-5" /> : <CheckCircle2 aria-hidden className="saathi-check size-5" /> : <XCircle aria-hidden className="size-5" />}
        {stoppedText}
      </p>
      <p className="mt-1 text-[15px] text-ink">{r(probe.label)}</p>
      <p className="mt-2 text-[14px] text-ink-secondary">
        {t('action.expected')}: {t(`status.decision.${probe.expected}`)} · {t('action.observed')}: {t(`status.decision.${probe.observed}`)} · {t('action.checkedAt', { time: '' })}
        <Time iso={probe.checkedAt} />
      </p>
    </div>
  );
}

export function ActionView({ initial }: { initial: ActionDetailDTO }) {
  const { t, r, time } = useI18n();
  const { data, mutate, isValidating } = usePolling<ActionDetailDTO>(`/api/v1/actions/${initial.id}`, initial, (d) => !!d && (actionPending(d.state) || d.state === 'unknown'));
  const a = data ?? initial;
  const idx = stepIndex(a.state);
  const terminal = !actionPending(a.state);
  const target = a.probes.find((p) => p.kind === 'target_denied');
  const others = a.probes.filter((p) => p.kind === 'unaffected_permitted');
  const deviceProbes = a.probes.filter((p) => p.kind !== 'target_denied' && p.kind !== 'unaffected_permitted');
  const isRecords = a.actionType.startsWith('records.');

  return (
    <div className="mx-auto max-w-[920px]">
      {a.incidentId && (
        <Link href={`/app/incidents/${a.incidentId}`} className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
          ← {t('action.returnIncident')}
        </Link>
      )}
      <h1 className="mt-2 text-[28px] font-semibold leading-tight">{r(a.title)}</h1>
      <p className="mt-1 text-[16px] text-ink-secondary">{r(a.targetLabel)}</p>

      {/* Progress rail mapped to persisted action states — never a timed animation. */}
      <ol className="mt-6 grid grid-cols-4 gap-2" aria-label={t('action.progressOutcome')}>
        {STEPS.map((s, i) => {
          const done = i < idx || (i === idx && terminal);
          const current = i === idx && !terminal;
          return (
            <li key={s} className="min-w-0">
              <div className={cn('h-1.5 rounded-full', done ? 'bg-ink' : current ? 'saathi-pending bg-ink-secondary' : 'bg-border-subtle')} />
              <p className={cn('mt-2 text-[13px] leading-snug sm:text-[14px]', done || current ? 'font-medium text-ink' : 'text-ink-secondary')} aria-current={current ? 'step' : undefined}>
                {t(`action.progress${s === 'accepted' ? 'Accepted' : s === 'applying' ? 'Applying' : s === 'checking' ? 'Checking' : 'Outcome'}`)}
              </p>
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="mt-6">
        <Card className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <StatusBadge tone={actionTone(a.state)} pending={actionPending(a.state)} label={t(`status.action.${a.state}`)} className="text-[14px]" />
            <p className="mt-2 text-[17px] leading-relaxed">{r(a.outcome)}</p>
            {a.device?.simulated && <p className="mt-2 text-[14px] font-medium text-warning-ink">{t('action.simulatedNote')}</p>}
          </div>
          {!terminal || a.state === 'unknown' ? (
            <Button variant="secondary" onClick={() => mutate()} disabled={isValidating}>
              {t('action.checkStatus')}
            </Button>
          ) : null}
        </Card>
      </div>

      {a.device && (
        <Notice tone={a.device.freshness === 'fresh' ? 'neutral' : 'warning'} className="mt-4">
          <span className="inline-flex items-center gap-2">
            <Monitor aria-hidden className="size-4" />
            {a.device.name} · {t(`status.freshness.${a.device.freshness}`)} · {t('devices.lastSeen', { time: time(a.device.lastSeenAt) })}
          </span>
          {a.command?.expiresAt && actionPending(a.state) && <p className="mt-1 tabular">{t('action.commandExpires', { time: time(a.command.expiresAt) })}</p>}
        </Notice>
      )}

      {isRecords && (
        <section className="mt-6 grid gap-4 md:grid-cols-2" aria-label={t('action.checks')}>
          <SessionCard probe={target} kind="target" />
          {others.length === 0 ? <SessionCard probe={undefined} kind="other" /> : others.map((o, i) => <SessionCard key={i} probe={o} kind="other" />)}
        </section>
      )}

      {deviceProbes.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-[16px] font-semibold">{t('action.checks')}</h2>
          <ul className="mt-3 divide-y divide-border-subtle">
            {deviceProbes.map((p, i) => (
              <li key={i} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[15px]">{r(p.label)}</span>
                <span className="flex items-center gap-2 text-[14px] text-ink-secondary">
                  {p.observed} <StatusBadge tone={checkTone(p.result)} label={t(`status.check.${p.result}`)} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Action confirmed and incident contained are separate claims. */}
      {a.containment && (
        <Card className="mt-6">
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <ShieldCheck aria-hidden className="size-5 text-ink-secondary" />
            {t('action.incidentContainment')}
          </h2>
          <div className="mt-2">
            <StatusBadge tone={containmentTone(a.containment.status)} label={t(`status.containment.${a.containment.status}`)} />
          </div>
          <ul className="mt-2 space-y-1 text-[15px] text-ink-secondary">
            {a.containment.reasons.map((x, i) => (
              <li key={i}>{r(x)}</li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <h2 className="text-[16px] font-semibold">{t('action.remaining')}</h2>
        {a.remainingFindings.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-[15px] text-ink-secondary">
            <Check aria-hidden className="size-4" />
            {t('action.noRemaining')}
          </p>
        ) : (
          <ul className="mt-2 space-y-2 text-[15px]">
            {a.remainingFindings.map((f) => (
              <li key={f.id}>
                <span className="font-medium">{t(`rules.${f.ruleId}`)}</span>
                {f.boundaries.length > 0 && <span className="text-ink-secondary"> — {f.boundaries.map(r).join(' ')}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {a.boundaries.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-[16px] font-semibold">{t('action.boundaries')}</h2>
          <ul className="mt-2 space-y-1.5 text-[15px]">
            {a.boundaries.map((b, i) => (
              <li key={i}>{r(b)}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        {a.nextSteps.includes('start_recovery') && a.incidentId && (
          <Link className={buttonVariants()} href={`/app/incidents/${a.incidentId}`}>
            {t('action.startRecovery')}
          </Link>
        )}
        {(a.nextSteps.includes('review_next_step') || a.nextSteps.includes('fresh_preview')) && a.incidentId && (
          <Link className={buttonVariants({ variant: 'secondary' })} href={`/app/incidents/${a.incidentId}`}>
            {a.nextSteps.includes('fresh_preview') ? t('action.freshPreview') : t('action.reviewNext')}
          </Link>
        )}
        {a.nextSteps.includes('return_to_incident') && a.incidentId && (
          <Link className={buttonVariants({ variant: 'ghost' })} href={`/app/incidents/${a.incidentId}`}>
            {t('action.returnIncident')}
          </Link>
        )}
        <span className="ml-auto">
          <StatusBadge tone={evidenceTone(a.evidenceState)} label={t('action.evidence', { state: t(`status.evidence.${a.evidenceState}`) })} />
        </span>
      </div>
    </div>
  );
}
