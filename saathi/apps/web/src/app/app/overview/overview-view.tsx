'use client';

import Link from 'next/link';
import { ArrowRight, HeartPulse, Hourglass, Monitor, Plug } from 'lucide-react';
import type { OverviewDTO } from '@saathi/contracts';
import { Card, SectionTitle, buttonVariants } from '@/components/ui/primitives';
import { MetricsStrip } from '@/components/overview/metrics-strip';
import { EmptyState, PageHeader } from '@/components/shared/states';
import { StatusBadge, actionTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { IncidentRow } from '@/components/incidents/incident-card';
import { usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

// Decisions before metrics (frontend.md §6.1): what needs me, what was handled, what is not
// visible, what to improve next. Every number comes from stored records.
export function OverviewView({ initial, canAddDevice }: { initial: OverviewDTO; canAddDevice: boolean }) {
  const { t, r, time } = useI18n();
  const { data } = usePolling<OverviewDTO>('/api/v1/overview', initial, () => true, { refreshInterval: 15_000 });
  const o = data ?? initial;
  const c = o.coverage;
  const d = o.funnel.dispositions;
  return (
    <div>
      <PageHeader title={t('overview.title')} meta={t('common.lastUpdated', { time: time(o.refreshedAt) })} />

      <MetricsStrip o={o} t={t} />

      {!c.hasAnySource && (
        <div className="mb-8">
          <EmptyState
            icon={<Plug className="size-8" />}
            title={t('overview.noSources')}
            body={t('overview.noSourcesBody')}
            action={
              canAddDevice ? (
                <Link href="/app/devices" className={buttonVariants()}>
                  {t('overview.connectSource')}
                </Link>
              ) : null
            }
          />
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="needs-h">
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle id="needs-h">{t('overview.needsAttention')}</SectionTitle>
              {o.needsAttentionTotal > o.needsAttention.length && (
                <Link className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-brand-action-hover" href="/app/incidents?tab=needs_attention">
                  {t('common.showAll')} ({o.needsAttentionTotal}) <ArrowRight aria-hidden className="size-4" />
                </Link>
              )}
            </div>
            {o.needsAttention.length === 0 ? (
              <EmptyState title={t('overview.noIncidents')} body={t('overview.noIncidentsBody')} />
            ) : (
              <ul className="space-y-3">
                {o.needsAttention.map((inc) => (
                  <li key={inc.id}>
                    <IncidentRow inc={inc} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="today-h">
            <div className="mb-3 flex items-center justify-between">
              <SectionTitle id="today-h">{t('overview.reviewToday')}</SectionTitle>
              {o.reviewTodayTotal > o.reviewToday.length && (
                <Link className="inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover" href="/app/incidents?tab=investigating">
                  {t('common.showAll')} ({o.reviewTodayTotal})
                </Link>
              )}
            </div>
            {o.reviewToday.length === 0 ? (
              <p className="text-[15px] text-ink-secondary">{t('incidents.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {o.reviewToday.map((inc) => (
                  <li key={inc.id}>
                    <IncidentRow inc={inc} compact />
                  </li>
                ))}
              </ul>
            )}
            {o.pendingRecovery > 0 && <p className="mt-3 text-[15px] text-ink">{t('overview.pendingRecovery', { count: o.pendingRecovery })}</p>}
          </section>

          <section aria-labelledby="handled-h">
            <SectionTitle id="handled-h" className="mb-3">
              {t('overview.recentlyHandled')}
            </SectionTitle>
            {o.recentlyHandled.length === 0 ? (
              <p className="text-[15px] text-ink-secondary">{t('overview.nothingHandled')}</p>
            ) : (
              <ul className="divide-y divide-border-subtle rounded-[14px] border border-border-subtle bg-surface">
                {o.recentlyHandled.map((a) => (
                  <li key={a.id}>
                    <Link href={`/app/actions/${a.id}`} className="flex flex-col gap-1 px-4 py-3 hover:bg-canvas-warm sm:flex-row sm:items-center sm:justify-between">
                      <span className="min-w-0">
                        <span className="block font-medium">{r(a.title)}</span>
                        <span className="block text-[14px] text-ink-secondary">{r(a.outcome)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 text-[14px] text-ink-secondary">
                        <StatusBadge tone={actionTone(a.state)} label={t(`status.action.${a.state}`)} />
                        <Time iso={a.updatedAt} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="rounded-[14px] border border-border-subtle bg-surface px-4 py-3 text-[15px]">
            <summary className="min-h-8 text-ink">
              {t('overview.funnel', { raw: o.funnel.rawEvents, aggregated: d.aggregated ?? 0, informational: d.informational ?? 0, digest: d.digest ?? 0, incidents: o.funnel.incidents })}
            </summary>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[14px] sm:grid-cols-5">
              {['correlated', 'aggregated', 'digest', 'informational', 'rejected'].map((k) => (
                <div key={k} className="rounded-[10px] bg-canvas-warm px-3 py-2">
                  <dt className="text-ink-secondary">{k}</dt>
                  <dd className="text-[17px] font-semibold tabular">{d[k] ?? 0}</dd>
                </div>
              ))}
            </dl>
            {o.funnel.replayIncluded && <p className="mt-2 text-[14px] text-warning-ink">{t('overview.funnelReplay')}</p>}
          </details>
        </div>

        <aside className="min-w-0 space-y-5">
          <Card>
            <SectionTitle as="h2" className="flex items-center gap-2 text-[16px]">
              <Monitor aria-hidden className="size-5 text-ink-secondary" />
              {t('overview.connectedSources')}
            </SectionTitle>
            <p className="mt-2 text-[15px] tabular">{t('overview.devicesLine', { fresh: c.devices.fresh, stale: c.devices.stale, offline: c.devices.offline, total: c.devices.total })}</p>
            <p className="mt-1 text-[15px] tabular">{t('overview.appsLine', { enforceable: c.applications.enforceable, readOnly: c.applications.readOnly, unconnected: c.applications.unconnected })}</p>
            {c.unknownDependencies > 0 && <p className="mt-1 text-[15px] text-warning-ink">{t('overview.unknownDeps', { count: c.unknownDependencies })}</p>}
            {c.devices.simulated > 0 && <p className="mt-1 text-[14px] text-ink-secondary">{t('overview.simulatedDevices', { count: c.devices.simulated })}</p>}
            {o.notificationFailures > 0 && <p className="mt-1 text-[14px] text-danger-ink">{t('overview.notificationFailures', { count: o.notificationFailures })}</p>}
            <Link href="/app/integrations" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover">
              {t('overview.viewCoverage')}
            </Link>
          </Card>
          <Card>
            <SectionTitle as="h2" className="flex items-center gap-2 text-[16px]">
              <HeartPulse aria-hidden className="size-5 text-ink-secondary" />
              {t('overview.protectionChecks')}
            </SectionTitle>
            <p className="mt-2 text-[15px] tabular">{o.health && o.health.earned !== null ? t('overview.healthLine', { earned: o.health.earned, unknown: o.health.unknownPoints }) : t('overview.healthNone')}</p>
            <Link href="/app/health" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover">
              {t('overview.viewHealth')}
            </Link>
          </Card>
          <Card>
            <SectionTitle as="h2" className="flex items-center gap-2 text-[16px]">
              <Hourglass aria-hidden className="size-5 text-ink-secondary" />
              {t('overview.temporaryLimits')}
            </SectionTitle>
            {o.temporaryLimits.length === 0 ? (
              <p className="mt-2 text-[15px] text-ink-secondary">{t('overview.noLimits')}</p>
            ) : (
              <ul className="mt-2 space-y-2 text-[15px]">
                {o.temporaryLimits.map((l) => (
                  <li key={l.id} className="tabular">
                    {l.incidentId ? (
                      <Link className="underline underline-offset-4" href={`/app/incidents/${l.incidentId}`}>
                        {t('overview.limitUntil', { target: l.targetLabel, rate: l.ratePerMinute ?? 1, time: time(l.expiresAt) })}
                      </Link>
                    ) : (
                      t('overview.limitUntil', { target: l.targetLabel, rate: l.ratePerMinute ?? 1, time: time(l.expiresAt) })
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
