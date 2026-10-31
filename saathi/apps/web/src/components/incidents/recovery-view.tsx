'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Circle, Lock, UserCheck, Cpu, XCircle } from 'lucide-react';
import type { Msg } from '@saathi/contracts';
import { Button, Card, FieldError, Input, Label, Textarea } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { CopyField, Time } from '@/components/shared/client';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

type Step = { key: string; kind: 'attested' | 'verified'; status: 'pending' | 'done' | 'failed' | 'blocked'; title: Msg; help: Msg; result: Msg | null; at: string | null };
export type RecoveryCase = { id: string; incidentId: string; status: 'in_progress' | 'blocked' | 'completed'; kind: string; steps: Step[]; blockedReason: Msg | null; completedAt: string | null };

export function RecoveryView({ initial, canManage }: { initial: RecoveryCase; canManage: boolean }) {
  const { t, r } = useI18n();
  const { data, mutate } = usePolling<RecoveryCase>(`/api/v1/recovery/${initial.id}`, initial, () => false);
  const rc = data ?? initial;
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ step: string; message: string } | null>(null);
  const [note, setNote] = useState('');
  const [pin, setPin] = useState('');
  const nextKey = rc.steps.find((s) => s.status !== 'done')?.key;

  async function run(step: string, body: Record<string, unknown> = {}) {
    setBusy(step);
    setError(null);
    try {
      const res = await apiSend<{ freshSessionToken: string | null }>(`/api/v1/recovery/${rc.id}/steps`, 'POST', { step, ...body });
      if (res.freshSessionToken) setToken(res.freshSessionToken);
      await mutate();
    } catch (e) {
      if (e instanceof ApiError && e.details?.reauth) window.location.assign(`/login?reauth=1&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      else setError({ step, message: e instanceof ApiError ? e.message : t('states.errorBody') });
      await mutate();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <Link href={`/app/incidents/${rc.incidentId}`} className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('preview.backToIncident')}
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold">{t('recovery.title')}</h1>
      <p className="mt-2 text-[16px] text-ink-secondary">{t('recovery.intro')}</p>
      <div aria-live="polite" className="mt-4 space-y-3">
        {rc.status === 'completed' && (
          <Notice tone="success" title={t('recovery.completed')}>
            <Time iso={rc.completedAt} />
          </Notice>
        )}
        {rc.status === 'blocked' && (
          <Notice tone="danger" title={t('recovery.blocked.title')} role="alert">
            {r(rc.blockedReason)}
          </Notice>
        )}
        {token && (
          <Notice tone="warning" title={t('recovery.freshToken')}>
            <CopyField value={token} label="token" className="mt-2" />
          </Notice>
        )}
      </div>
      <ol className="mt-6 space-y-3">
        {rc.steps.map((s, i) => {
          const isNext = s.key === nextKey && rc.status !== 'completed';
          const Icon = s.status === 'done' ? CheckCircle2 : s.status === 'failed' ? XCircle : isNext ? Circle : Lock;
          return (
            <li key={s.key}>
              <Card className={cn('p-4 sm:p-5', isNext && 'border-ink/30', s.status === 'failed' && 'border-danger-ink/30')}>
                <div className="flex items-start gap-3">
                  <Icon aria-hidden className={cn('mt-0.5 size-6 shrink-0', s.status === 'done' ? 'text-success-ink' : s.status === 'failed' ? 'text-danger-ink' : 'text-ink-secondary')} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[17px] font-semibold">
                        {i + 1}. {r(s.title)}
                      </h2>
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[12.5px] font-medium text-ink-secondary">
                        {s.kind === 'attested' ? <UserCheck aria-hidden className="size-3.5" /> : <Cpu aria-hidden className="size-3.5" />}
                        {s.kind === 'attested' ? t('recovery.attested') : t('recovery.verified')}
                      </span>
                    </div>
                    <p className="mt-1 text-[15px] text-ink-secondary">{r(s.help)}</p>
                    {s.result && <p className={cn('mt-2 text-[15px]', s.status === 'failed' ? 'text-danger-ink' : 'text-ink')}>{r(s.result)}</p>}
                    {canManage && isNext && (
                      <div className="mt-4">
                        {s.key === 'verify_person' && (
                          <div className="mb-3">
                            <Label htmlFor="rv-note">{t('recovery.notePlaceholder')}</Label>
                            <Textarea id="rv-note" className="min-h-20" value={note} onChange={(e) => setNote(e.target.value)} />
                          </div>
                        )}
                        {s.key === 'address_credentials' && (
                          <div className="mb-3">
                            <Label htmlFor="rv-pin">{t('recovery.newPin')}</Label>
                            <Input id="rv-pin" inputMode="numeric" pattern="\d{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} className="max-w-[12rem]" />
                          </div>
                        )}
                        <Button
                          disabled={!!busy || (s.key === 'verify_person' && note.trim().length < 5) || (s.key === 'address_credentials' && pin.length > 0 && pin.length !== 6)}
                          onClick={() =>
                            run(s.key, s.key === 'verify_person' ? { confirm: true, note } : s.key === 'address_credentials' ? { confirm: true, ...(pin ? { newPin: pin } : {}) } : {})
                          }
                        >
                          {busy === s.key ? t('common.loading') : s.kind === 'attested' ? t('recovery.confirm') : t('recovery.run')}
                        </Button>
                        <FieldError id={`err-${s.key}`}>{error?.step === s.key ? error.message : null}</FieldError>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
