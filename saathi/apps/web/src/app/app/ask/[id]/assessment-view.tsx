'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AlertTriangle, CircleHelp, Footprints, Globe, Megaphone, Search } from 'lucide-react';
import type { CampaignDTO, ScamCheckDTO } from '@saathi/contracts';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, verdictTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

export function AssessmentView({ initial, campaign, canWarn }: { initial: ScamCheckDTO; campaign: CampaignDTO | null; canWarn: boolean }) {
  const { t, r, time } = useI18n();
  const router = useRouter();
  const { data, mutate } = usePolling<ScamCheckDTO>(`/api/v1/scam-checks/${initial.id}`, initial, (d) => d?.aiStatus === 'pending');
  const c = data ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <div className="mx-auto max-w-[820px]">
      <Link href="/app/ask" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('ask.title')}
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold">{t('ask.resultTitle')}</h1>
      <div className="mt-3">
        <StatusBadge tone={verdictTone(c.verdict)} label={t(`status.verdict.${c.verdict}`)} className="px-3 py-1 text-[16px]" />
      </div>
      <p className="mt-2 text-[14px] text-ink-secondary">
        <Time iso={c.createdAt} />
      </p>
      {c.verdict === 'no_known_indicators' && (
        <Notice tone="neutral" className="mt-4">
          {t('ask.noIndicatorsNote')}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}

      <Card className="mt-5">
        <SectionTitle className="flex items-center gap-2">
          <Search aria-hidden className="size-5 text-ink-secondary" />
          {t('ask.found')}
        </SectionTitle>
        <ul className="mt-3 space-y-2 text-[16px] leading-relaxed">
          {c.reasons.length === 0 && <li className="text-ink-secondary">{t('common.none')}</li>}
          {c.reasons.map((m, i) => (
            <li key={i}>{r(m)}</li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4 border-warning-ink/20 bg-warning-soft">
        <SectionTitle className="flex items-center gap-2 text-warning-ink">
          <CircleHelp aria-hidden className="size-5" />
          {t('ask.uncertainty')}
        </SectionTitle>
        <ul className="mt-3 space-y-2 text-[16px] leading-relaxed">
          {c.uncertainty.map((m, i) => (
            <li key={i}>{r(m)}</li>
          ))}
        </ul>
      </Card>

      <Card className="mt-4">
        <SectionTitle className="flex items-center gap-2">
          <Footprints aria-hidden className="size-5 text-ink-secondary" />
          {t('ask.nextSteps')}
        </SectionTitle>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-[16px] leading-relaxed">
          {c.nextSteps.map((m, i) => (
            <li key={i}>{r(m)}</li>
          ))}
        </ol>
        {c.isOwn && !c.reported && (
          <Button
            className="mt-4"
            onClick={async () => {
              try {
                await apiSend(`/api/v1/scam-checks/${c.id}/report`, 'POST');
                await mutate();
                router.refresh();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : t('states.errorBody'));
              }
            }}
          >
            <Megaphone aria-hidden />
            {t('ask.report')}
          </Button>
        )}
        {c.reported && <p className="mt-4 text-[15px] text-success-ink">{t('ask.reported')}</p>}
      </Card>

      {c.domains.length > 0 && (
        <Card className="mt-4">
          <SectionTitle className="flex items-center gap-2">
            <Globe aria-hidden className="size-5 text-ink-secondary" />
            {t('ask.domains')}
          </SectionTitle>
          <ul className="mt-3 space-y-2">
            {c.domains.map((d) => (
              <li key={d.ascii} className="text-[15px]">
                {/* Shown as text only; never a clickable link. */}
                <span className="font-mono [overflow-wrap:anywhere]">{d.display}</span>
                {d.ascii !== d.display.toLowerCase() && <span className="ml-2 font-mono text-[13px] text-ink-secondary">({d.ascii})</span>}
                {d.flags.length > 0 && <span className="ml-2 text-[13px] text-warning-ink">{d.flags.join(', ')}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {c.missingChecks.length > 0 && (
        <Notice tone="neutral" className="mt-4" title={t('ask.missing')}>
          <ul>
            {c.missingChecks.map((m, i) => (
              <li key={i}>{r(m)}</li>
            ))}
          </ul>
        </Notice>
      )}

      <Card className="mt-4">
        <SectionTitle>{t('ask.aiExplanation')}</SectionTitle>
        {c.aiStatus === 'used' && c.aiExplanation ? (
          <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">{c.aiExplanation}</p>
        ) : c.aiStatus === 'pending' ? (
          <p className="saathi-pending mt-2 text-[15px] text-ink-secondary">{t('incident.explainPending')}</p>
        ) : (
          <p className="mt-2 text-[15px] text-ink-secondary">{c.aiStatus === 'not_requested' ? t('common.notChecked') : t('ask.aiUnavailable')}</p>
        )}
      </Card>

      {c.textPreview ? (
        <details className="mt-4 rounded-[14px] border border-border-subtle bg-surface px-4 py-3">
          <summary className="min-h-8 font-medium">{t('ask.textLabel')}</summary>
          <p className="mt-2 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{c.textPreview}</p>
        </details>
      ) : (
        !c.isOwn && <p className="mt-4 text-[14px] text-ink-secondary">{t('ask.textHidden')}</p>
      )}

      {campaign && (
        <Card className="mt-6 border-warning-ink/30">
          <SectionTitle className="flex items-center gap-2">
            <AlertTriangle aria-hidden className="size-5 text-warning-ink" />
            {t('ask.campaign.title')}
          </SectionTitle>
          <p className="mt-2 text-[15px]">{t('ask.campaign.reporters', { count: campaign.reporterCount })}</p>
          <p className="mt-1 font-mono text-[13px] text-ink-secondary">{campaign.domains.join(', ')}</p>
          {campaign.warnedAt ? (
            <p className="mt-3 text-[15px] text-success-ink">{t('ask.campaign.warned', { time: time(campaign.warnedAt) })}</p>
          ) : (
            canWarn && (
              <form
                className="mt-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await apiSend(`/api/v1/campaigns/${campaign.id}/warn`, 'POST', { recipientUserIds: selected });
                    router.refresh();
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : t('states.errorBody'));
                  }
                }}
              >
                <p className="text-[15px] text-ink-secondary">{t('ask.campaign.warnBody')}</p>
                <fieldset className="mt-3">
                  <legend className="text-[15px] font-medium">{t('ask.campaign.recipients')}</legend>
                  <div className="mt-2 grid gap-1 sm:grid-cols-2">
                    {campaign.candidates.map((m) => (
                      <label key={m.userId} className="flex min-h-11 items-center gap-2 text-[15px]">
                        <input type="checkbox" className="size-4" checked={selected.includes(m.userId)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, m.userId] : s.filter((x) => x !== m.userId)))} />
                        {m.name} <span className="text-ink-secondary">({t(`settings.role.${m.role}`)})</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <Button className="mt-3" disabled={selected.length === 0}>
                  {t('ask.campaign.sendWarning')}
                </Button>
              </form>
            )
          )}
        </Card>
      )}
    </div>
  );
}
