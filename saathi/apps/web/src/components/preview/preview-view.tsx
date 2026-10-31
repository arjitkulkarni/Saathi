'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Ban, CheckCircle2, CircleHelp, Gauge, LifeBuoy, Lock, RefreshCw } from 'lucide-react';
import type { ActionOption, Consequence, Msg, PreviewDTO } from '@saathi/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { ApiError, apiGet, apiSend, newIdempotencyKey } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

type Phase = 'idle' | 'approving' | 'checking' | 'stale' | 'updating' | 'error';

function Panel({ icon: Icon, title, items, empty, tone, r }: { icon: typeof Ban; title: string; items: Consequence[]; empty: string; tone: 'stop' | 'keep'; r: (m: Msg) => string }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby={`panel-${tone}`} className={cn('rounded-[16px] border bg-surface p-5 sm:p-6', tone === 'stop' ? 'border-danger-ink/25' : 'border-success-ink/25')}>
      <h2 id={`panel-${tone}`} className="flex items-center gap-2 text-[17px] font-semibold">
        <Icon aria-hidden className={cn('size-5', tone === 'stop' ? 'text-danger-ink' : 'text-success-ink')} />
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 text-[16px] text-ink-secondary">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-2.5 text-[16px] leading-relaxed">
          {items.map((c, i) => (
            <li key={i} className="flex gap-2.5">
              <span aria-hidden className={cn('mt-[10px] size-1.5 shrink-0 rounded-full', tone === 'stop' ? 'bg-danger-ink' : 'bg-success-ink')} />
              <span>
                {r(c.label)}
                {c.unchanged && tone === 'stop' && <span className="ml-1 text-ink-secondary">({t('preview.alreadyRestricted')})</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ icon: Icon, title, children }: { icon: typeof Ban; title: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border-subtle py-4 sm:grid-cols-[200px_1fr] sm:gap-6">
      <h3 className="flex items-start gap-2 text-[15px] font-semibold text-ink">
        <Icon aria-hidden className="mt-0.5 size-[18px] shrink-0 text-ink-secondary" />
        {title}
      </h3>
      <div className="text-[16px] leading-relaxed text-ink">{children}</div>
    </div>
  );
}

export function PreviewView({ initial, backHref }: { initial: PreviewDTO; backHref: string }) {
  const { t, r, time } = useI18n();
  const router = useRouter();
  const [p, setP] = useState(initial);
  const [phase, setPhase] = useState<Phase>(initial.status === 'stale' || initial.status === 'expired' ? 'stale' : 'idle');
  const [message, setMessage] = useState<string | null>(null);
  // One idempotency key per approval attempt on this page; retries reuse it.
  const keyRef = useRef<string>(newIdempotencyKey());
  const c = p.content;
  const sameOption = (o: ActionOption) => o.actionType === c.actionType && o.targetId === c.targetId && JSON.stringify(o.params) === JSON.stringify(c.params);

  async function freshPreview(o: { actionType: string; targetType: string; targetId: string; params: Record<string, unknown> }) {
    setPhase('updating');
    setMessage(null);
    try {
      const url = p.incidentId ? `/api/v1/incidents/${p.incidentId}/previews` : o.targetType === 'device' ? `/api/v1/devices/${o.targetId}/previews` : '/api/v1/access/previews';
      const body = p.incidentId ? o : o.targetType === 'device' ? { actionType: o.actionType, params: o.params } : { actionType: o.actionType, targetType: o.targetType, targetId: o.targetId };
      const { previewId } = await apiSend<{ previewId: string }>(url, 'POST', body);
      router.replace(p.incidentId ? `/app/incidents/${p.incidentId}/preview/${previewId}` : `/app/previews/${previewId}`);
      const next = await apiGet<PreviewDTO>(`/api/v1/previews/${previewId}`);
      keyRef.current = newIdempotencyKey();
      setP(next);
      setPhase('idle');
    } catch (e) {
      setPhase('error');
      setMessage(e instanceof ApiError ? e.message : t('states.errorBody'));
    }
  }

  async function approve() {
    setPhase('approving');
    setMessage(null);
    try {
      const res = await apiSend<{ actionId: string }>('/api/v1/actions', 'POST', { previewId: p.id, idempotencyKey: keyRef.current });
      router.push(`/app/actions/${res.actionId}`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'STALE_PREVIEW') {
          setPhase('stale');
          return;
        }
        if (e.code === 'UNAUTHENTICATED' && e.details?.reauth) {
          window.location.assign(`/login?reauth=1&next=${encodeURIComponent(window.location.pathname)}`);
          return;
        }
        if (e.code === 'NETWORK' || e.status >= 500) {
          // Never submit a new blind action: look up whether this approval already exists.
          setPhase('checking');
          for (let i = 0; i < 6; i++) {
            await new Promise((res) => setTimeout(res, 1500));
            try {
              const cur = await apiGet<PreviewDTO>(`/api/v1/previews/${p.id}`);
              if (cur.actionId) {
                router.push(`/app/actions/${cur.actionId}`);
                return;
              }
              if (cur.status === 'active') break;
            } catch {
              /* keep checking */
            }
          }
          setPhase('error');
          setMessage(t('preview.networkLost'));
          return;
        }
        setPhase('error');
        setMessage(e.message);
        return;
      }
      setPhase('error');
      setMessage(t('states.errorBody'));
    }
  }

  const titleKey = c.title.key;
  const approveLabel = t(`preview.approveAction.${c.actionType.replace('.', '_')}`);
  const blocked = !p.canApprove || phase === 'updating' || phase === 'stale' || phase === 'checking';

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="flex flex-wrap items-center justify-between gap-2 text-[15px]">
        <Link href={backHref} className="inline-flex min-h-11 items-center text-ink-secondary hover:text-ink">
          ← {p.incidentId ? t('preview.backToIncident') : t('common.back')}
        </Link>
        <span className="text-ink-secondary tabular">{t('preview.observedAt', { time: time(p.observedAt) })}</span>
      </div>
      <h1 className="mt-3 text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">{t(titleKey)}</h1>
      <p className="mt-2 text-[17px] text-ink-secondary">{t('preview.subtitle')}</p>
      <p className="mt-3 text-[16px]">
        <span className="text-ink-secondary">{t('preview.target')}: </span>
        <span className="font-semibold">{r(c.targetLabel)}</span>
      </p>

      <div aria-live="polite" className="mt-5 space-y-3">
        {phase === 'stale' && (
          <Notice tone="warning" title={p.status === 'expired' ? t('preview.expired') : t('preview.stale')} role="alert">
            <p>{t('preview.staleNoAction')}</p>
            <Button className="mt-3" variant="secondary" onClick={() => freshPreview(c)}>
              <RefreshCw aria-hidden />
              {t('preview.refresh')}
            </Button>
          </Notice>
        )}
        {phase === 'updating' && <Notice tone="info">{t('preview.updating')}</Notice>}
        {phase === 'checking' && <Notice tone="info">{t('preview.networkLost')}</Notice>}
        {phase === 'error' && message && (
          <Notice tone="danger" role="alert">
            {message}
          </Notice>
        )}
        {p.status === 'consumed' && p.actionId && (
          <Notice tone="neutral" title={t('preview.consumed')}>
            <Link className="font-medium underline underline-offset-4" href={`/app/actions/${p.actionId}`}>
              {t('preview.viewResult')}
            </Link>
          </Notice>
        )}
        {!c.objectiveMet && <Notice tone="warning">{t('preview.objectiveNotMet')}</Notice>}
      </div>

      <div className={cn('mt-6 grid gap-4 md:grid-cols-2', phase === 'updating' && 'opacity-60')} aria-busy={phase === 'updating'}>
        <Panel icon={Ban} title={t('preview.willStop')} items={c.stops} empty={t('preview.noneStop')} tone="stop" r={r} />
        <Panel icon={CheckCircle2} title={t('preview.keepsWorking')} items={c.keepsWorking} empty={t('preview.noneKeep')} tone="keep" r={r} />
      </div>

      <Card className="mt-4 py-1 sm:py-1">
        <Row icon={Gauge} title={t('preview.willLimit')}>
          {c.limits.length ? (
            <ul className="space-y-1.5">
              {c.limits.map((x, i) => (
                <li key={i}>
                  {r(x.label)}
                  {x.unchanged && <span className="text-ink-secondary"> ({t('preview.alreadyRestricted')})</span>}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-secondary">{t('preview.noneLimit')}</span>
          )}
        </Row>
        <Row icon={CircleHelp} title={t('preview.unknownEffects')}>
          {c.unknown.length ? (
            <ul className="space-y-1.5">
              {c.unknown.map((m, i) => (
                <li key={i}>{r(m)}</li>
              ))}
            </ul>
          ) : (
            <span className="text-ink-secondary">{t('preview.noneUnknown')}</span>
          )}
          {!c.coverage.completeForScope && <p className="mt-1.5 text-warning-ink">{t('preview.coverageIncomplete')}</p>}
        </Row>
        <Row icon={Lock} title={t('preview.cannotControl')}>
          <ul className="space-y-1.5">
            {c.cannotControl.map((m, i) => (
              <li key={i}>{r(m)}</li>
            ))}
          </ul>
        </Row>
        <Row icon={LifeBuoy} title={t('preview.recovery')}>
          <ul className="space-y-1.5">
            {c.undo.map((u, i) => (
              <li key={i}>{r(u.step)}</li>
            ))}
          </ul>
          <p className="mt-1.5 text-ink-secondary">{c.reversible ? t('preview.reversible') : t('preview.notReversible')}</p>
        </Row>
        <p className="border-t border-border-subtle py-3 text-[14px] text-ink-secondary">{c.predictionBasis === 'modeled_policy' ? t('preview.basisModeled') : t('preview.basisDevice')}</p>
      </Card>

      {p.alternatives.length > 1 && (
        <fieldset className="mt-6">
          <legend className="text-[16px] font-semibold">{t('preview.compare')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {p.alternatives.map((o) => {
              const id = `alt-${o.actionType}-${o.targetId}`;
              return (
                <label key={id} htmlFor={id} className={cn('flex min-h-12 cursor-pointer items-start gap-3 rounded-[12px] border px-3 py-2.5', sameOption(o) ? 'border-brand-action bg-brand-soft' : 'border-border-subtle bg-surface hover:bg-surface-subtle')}>
                  <input id={id} type="radio" name="alternative" className="mt-1 size-4 accent-[#be3e24]" checked={sameOption(o)} disabled={phase === 'updating' || phase === 'approving'} onChange={() => !sameOption(o) && freshPreview(o)} />
                  <span>
                    <span className="block font-medium">{t(`action.title.${o.actionType.replace('.', '_')}`)}</span>
                    <span className="block text-[14px] text-ink-secondary">{r(o.reason)}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* Approval sits in normal document flow so it never covers consequences or errors. */}
      <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border-subtle pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Link href={backHref} className="inline-flex min-h-11 items-center justify-center rounded-[11px] border border-border-control px-4 text-[15px] font-medium hover:bg-surface-subtle">
          {t('preview.chooseAnother')}
        </Link>
        <div className="flex flex-col items-stretch gap-2 sm:items-end">
          <Button size="lg" onClick={approve} disabled={blocked || phase === 'approving'} aria-describedby={!p.canApprove ? 'approve-blocked' : undefined}>
            {phase === 'approving' ? t('preview.approving') : approveLabel}
          </Button>
          {!p.canApprove && p.approveBlockedReason && (
            <p id="approve-blocked" className="max-w-md text-[14px] text-ink-secondary sm:text-right">
              {r(p.approveBlockedReason)}
            </p>
          )}
          {p.status === 'active' && <p className="text-[13px] text-ink-secondary tabular">{t('preview.expiresAt', { time: time(p.expiresAt) })}</p>}
        </div>
      </div>
    </div>
  );
}
