'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { PersonDetailDTO } from '@saathi/contracts';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { IncidentRow } from '@/components/incidents/incident-card';
import { ApiError, apiSend } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

export function PersonView({ person: p, canPreview }: { person: PersonDetailDTO; canPreview: boolean }) {
  const { t, time } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function preview(actionType: 'records.pause_session' | 'records.disable_account' | 'records.offboard_subject', targetType: 'session' | 'subject', targetId: string) {
    setBusy(true);
    setError(null);
    try {
      const { previewId } = await apiSend<{ previewId: string }>('/api/v1/access/previews', 'POST', { actionType, targetType, targetId });
      router.push(`/app/previews/${previewId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(false);
    }
  }

  return (
    <div>
      <Link href="/app/people" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('people.title')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-[28px] font-semibold">{p.name}</h1>
        {p.status === 'offboarded' && <StatusBadge tone="neutral" label={t('people.inactive')} />}
        {p.sharedAccount && <StatusBadge tone="warning" label={t('people.shared')} />}
      </div>
      {p.sharedAccount && (
        <Notice tone="warning" className="mt-4">
          {t('people.sharedWarning')}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}
      <p className="mt-4 max-w-3xl text-[15px] text-ink-secondary">{t('people.intro')}</p>

      <section className="mt-6" aria-labelledby="sess-h">
        <SectionTitle id="sess-h">{t('people.sessions')}</SectionTitle>
        <ul className="mt-3 space-y-2">
          {p.sessions.length === 0 && <li className="text-[15px] text-ink-secondary">{t('common.none')}</li>}
          {p.sessions.map((s) => {
            const restricted = s.restrictions.length > 0;
            return (
              <li key={s.id}>
                <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">{s.label}</p>
                    <p className="text-[14px] text-ink-secondary">
                      {s.integrationName} · {s.familiar ? t('people.familiar') : t('people.unfamiliar')} · {t('people.lastUsed', { time: time(s.lastUsedAt) })}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge tone={s.status === 'active' ? (restricted ? 'warning' : 'neutral') : 'neutral'} label={t(`people.session.${s.status}`)} />
                      {s.restrictions.map((r0) => (
                        <StatusBadge
                          key={r0.id}
                          tone="info"
                          label={
                            r0.kind === 'throttle' ? `${t('incidents.limited')} · ${time(r0.expiresAt)}` : r0.kind === 'pause' ? t('people.session.paused') : t('preview.title.disable_account').replace('?', '')
                          }
                        />
                      ))}
                    </div>
                  </div>
                  {canPreview && s.status === 'active' && p.status === 'active' && (
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => preview('records.pause_session', 'session', s.id)}>
                      {t('people.previewPause')}
                    </Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>

      {canPreview && p.status === 'active' && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => preview('records.disable_account', 'subject', p.id)}>
            {t('people.previewDisable')}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => preview('records.offboard_subject', 'subject', p.id)}>
            {t('people.previewOffboard')}
          </Button>
        </div>
      )}

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        <Card>
          <SectionTitle>{t('people.grants')}</SectionTitle>
          <ul className="mt-2 space-y-1 text-[15px]">
            {p.grants.map((g, i) => (
              <li key={i}>
                {g.integrationName}: <span className="font-mono text-[13px]">{g.capability}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionTitle>{t('people.deviceAccounts')}</SectionTitle>
          <ul className="mt-2 space-y-1 text-[15px]">
            {p.deviceAccounts.length === 0 && <li className="text-ink-secondary">{t('common.none')}</li>}
            {p.deviceAccounts.map((a, i) => (
              <li key={i}>
                {a.deviceName}: {a.username}
                {a.isAdmin ? ` (${t('devices.admin')})` : ''}
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionTitle>{t('people.dependencies')}</SectionTitle>
          <ul className="mt-2 space-y-2 text-[15px]">
            {p.dependencies.length === 0 && <li className="text-ink-secondary">{t('common.none')}</li>}
            {p.dependencies.map((d0) => (
              <li key={d0.id}>
                {d0.description}
                <span className="block text-[13px] text-ink-secondary">
                  {t(`onboarding.confidence.${d0.confidence}`)} · <Time iso={d0.declaredAt} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {p.incidents.length > 0 && (
        <section className="mt-8 space-y-2">
          <SectionTitle>{t('nav.incidents')}</SectionTitle>
          {p.incidents.map((i) => (
            <IncidentRow key={i.id} inc={i} compact />
          ))}
        </section>
      )}
    </div>
  );
}
