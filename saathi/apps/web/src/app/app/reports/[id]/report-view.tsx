'use client';

import Link from 'next/link';
import { Download } from 'lucide-react';
import type { AnchorState, ContainmentAssessment, Msg } from '@saathi/contracts';
import { Card, buttonVariants } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, anchorTone, checkTone, containmentTone } from '@/components/shared/status';
import { usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type Manifest = {
  incident?: { id: string; title: Msg; state: string; isReplay: boolean };
  scope?: { sources: Msg[]; excluded: Msg[] };
  observedFacts?: Msg[];
  uncertainty?: Msg[];
  boundaries?: Msg[];
  containment?: ContainmentAssessment;
  actions?: { id: string; actionType: string; state: string; simulated: boolean; probes: { kind: string; expected: string; observed: string; result: 'pass' | 'fail' | 'unknown' }[] }[];
  recovery?: { status: string; steps: { key: string; kind: string; status: string }[] } | null;
  evidence?: { integrity: string; intents: number };
  incidents?: { id: string; title: Msg; state: string; isReplay: boolean }[];
  actionsByState?: Record<string, number>;
  remediatedDetections?: number;
  outstandingRecovery?: number;
  coverage?: { devices: { total: number; fresh: number; stale: number; offline: number }; applications: { enforceable: number; readOnly: number; unconnected: number } };
  disclaimer?: string;
};
export type ReportDetail = { id: string; kind: 'incident' | 'weekly'; status: 'queued' | 'ready' | 'failed'; incidentId: string | null; createdAt: string; manifest: Manifest | null; error: string | null; anchorState: AnchorState; hasPdf: boolean; hasBundle: boolean; expiresAt: string | null };

export function ReportView({ initial }: { initial: ReportDetail }) {
  const { t, r, time } = useI18n();
  const { data } = usePolling<ReportDetail>(`/api/v1/reports/${initial.id}`, initial, (d) => d?.status === 'queued');
  const rep = data ?? initial;
  const m = rep.manifest;
  return (
    <div className="mx-auto max-w-[860px]">
      <Link href="/app/reports" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('reports.title')}
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold">{t(`report.title.${rep.kind}`)}</h1>
      <p className="mt-1 text-[15px] text-ink-secondary tabular">{time(rep.createdAt, 'long')}</p>
      <div className="mt-4 flex flex-wrap gap-2" aria-live="polite">
        <StatusBadge tone={rep.status === 'ready' ? 'neutral' : rep.status === 'failed' ? 'danger' : 'info'} pending={rep.status === 'queued'} label={t(`reports.status.${rep.status}`)} />
        <StatusBadge tone={anchorTone(rep.anchorState)} label={`${t('reports.timestamp')}: ${t(`status.anchor.${rep.anchorState}`)}`} />
      </div>
      {rep.status === 'failed' && rep.error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {rep.error}
        </Notice>
      )}
      {rep.status === 'ready' && (
        <div className="mt-5 flex flex-wrap gap-2">
          {rep.hasPdf && (
            <a className={buttonVariants()} href={`/api/v1/reports/${rep.id}/download?artifact=pdf`}>
              <Download aria-hidden />
              {t('reports.downloadPdf')}
            </a>
          )}
          {rep.hasBundle && (
            <a className={buttonVariants({ variant: 'secondary' })} href={`/api/v1/reports/${rep.id}/download?artifact=bundle`}>
              {t('reports.downloadBundle')}
            </a>
          )}
          {rep.hasPdf && (
            <a className={buttonVariants({ variant: 'secondary' })} href={`/api/v1/reports/${rep.id}/download?artifact=manifest`}>
              {t('reports.downloadManifest')}
            </a>
          )}
          {rep.incidentId && (
            <Link className={buttonVariants({ variant: 'ghost' })} href={`/app/incidents/${rep.incidentId}`}>
              {t('preview.backToIncident')}
            </Link>
          )}
        </div>
      )}
      {m && rep.kind === 'incident' && m.incident && (
        <article className="mt-6 space-y-4">
          <Card>
            <h2 className="text-[20px] font-semibold">{r(m.incident.title)}</h2>
            <p className="mt-1 text-[15px] text-ink-secondary">
              {t(`status.incident.${m.incident.state}`)}
              {m.incident.isReplay ? ` · ${t('common.replayBadge')}` : ''}
            </p>
          </Card>
          <Section title={t('reports.scope')} items={[...(m.scope?.sources ?? []).map(r), ...(m.scope?.excluded ?? []).map((x) => `${t('incident.scopeExcluded')}: ${r(x)}`)]} />
          <Section title={t('reports.facts')} items={(m.observedFacts ?? []).map(r)} />
          <Section title={t('reports.uncertainty')} items={(m.uncertainty ?? []).map(r)} />
          {m.containment && (
            <Card>
              <h3 className="text-[16px] font-semibold">{t('incident.containment')}</h3>
              <div className="mt-2">
                <StatusBadge tone={containmentTone(m.containment.status)} label={t(`status.containment.${m.containment.status}`)} />
              </div>
            </Card>
          )}
          <Card>
            <h3 className="text-[16px] font-semibold">{t('reports.actions')}</h3>
            <ul className="mt-2 space-y-3 text-[15px]">
              {(m.actions ?? []).map((a) => (
                <li key={a.id}>
                  <span className="font-medium">{t(`action.title.${a.actionType.replace('.', '_')}`)}</span> — {t(`status.action.${a.state}`)}
                  {a.simulated && <span className="text-warning-ink"> · {t('common.simulatedBadge')}</span>}
                  <ul className="mt-1 space-y-1 pl-4">
                    {a.probes.map((p, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-[14px] text-ink-secondary">
                        {p.kind}: {p.expected} → {p.observed} <StatusBadge tone={checkTone(p.result)} label={t(`status.check.${p.result}`)} />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </Card>
          <Section title={t('reports.recoveryTitle')} items={m.recovery ? m.recovery.steps.map((s) => `${t(`recovery.step.${s.key}.title`)} (${s.kind === 'attested' ? t('recovery.attested') : t('recovery.verified')}): ${s.status}`) : [t('common.none')]} />
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <h3 className="text-[16px] font-semibold">{t('reports.integrity')}</h3>
              <p className="mt-2 text-[15px]">{t(`status.evidence.${m.evidence?.integrity ?? 'none'}`)}</p>
            </Card>
            <Card>
              <h3 className="text-[16px] font-semibold">{t('reports.timestamp')}</h3>
              <p className="mt-2 text-[15px]">{t(`status.anchor.${rep.anchorState}`)}</p>
            </Card>
          </div>
          <p className="text-[14px] text-ink-secondary">{t('reports.disclaimer')}</p>
        </article>
      )}
      {m && rep.kind === 'weekly' && (
        <article className="mt-6 space-y-4">
          <Section title={t('nav.incidents')} items={(m.incidents ?? []).map((i) => `${r(i.title)} — ${t(`status.incident.${i.state}`)}${i.isReplay ? ` (${t('common.replayBadge')})` : ''}`)} />
          <Section title={t('reports.actions')} items={Object.entries(m.actionsByState ?? {}).map(([k, v]) => `${t(`status.action.${k}`)}: ${v}`)} />
          {m.coverage && (
            <Section
              title={t('overview.connectedSources')}
              items={[
                t('overview.devicesLine', { fresh: m.coverage.devices.fresh, stale: m.coverage.devices.stale, offline: m.coverage.devices.offline, total: m.coverage.devices.total }),
                t('overview.appsLine', { enforceable: m.coverage.applications.enforceable, readOnly: m.coverage.applications.readOnly, unconnected: m.coverage.applications.unconnected }),
              ]}
            />
          )}
          <p className="text-[14px] text-ink-secondary">{t('reports.disclaimer')}</p>
        </article>
      )}
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <Card>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-[15px] leading-relaxed">
        {items.length === 0 ? <li className="text-ink-secondary">—</li> : items.map((x, i) => <li key={i}>{x}</li>)}
      </ul>
    </Card>
  );
}
