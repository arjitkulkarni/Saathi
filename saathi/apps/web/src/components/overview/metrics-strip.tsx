import Link from 'next/link';
import { AlertTriangle, HeartPulse, Monitor, Plug } from 'lucide-react';
import type { OverviewDTO } from '@saathi/contracts';
import { TONE, type Tone } from '@/components/shared/status';
import { cn } from '@/lib/cn';

type Metric = { key: string; icon: typeof AlertTriangle; value: string; label: string; tone: Tone; href: string };

const toneText = (tone: Tone) => TONE[tone].split(' ').find((cls) => cls.startsWith('text-'));

// Four at-a-glance numbers above the fold (frontend.md §6.1 still puts decisions before metrics —
// this strip summarizes, it never replaces, the "needs attention" list below it). Every value and
// tone comes straight from CoverageSummaryDTO / HealthDTO fields already computed server-side; no
// new thresholds are invented here beyond "zero is good, nonzero of a bad thing is not."
export function MetricsStrip({ o, t }: { o: OverviewDTO; t: (key: string, params?: Record<string, unknown>) => string }) {
  const c = o.coverage;
  const online = c.devices.total - c.devices.offline;
  const h = o.health;

  const sourceStatus: { value: string; tone: Tone } = !c.hasAnySource
    ? { value: t('overview.metrics.sourceNotConnected'), tone: 'neutral' }
    : o.notificationFailures > 0
      ? { value: t('overview.metrics.sourceFailing'), tone: 'danger' }
      : c.unknownDependencies > 0 || c.incompleteChecks > 0
        ? { value: t('overview.metrics.sourceNeedsAttention'), tone: 'warning' }
        : { value: t('overview.metrics.sourceAllConnected'), tone: 'success' };

  const metrics: Metric[] = [
    {
      key: 'needsAttention',
      icon: AlertTriangle,
      value: String(o.needsAttentionTotal),
      label: t('overview.metrics.needsAttention'),
      tone: o.needsAttentionTotal > 0 ? 'danger' : 'success',
      href: '/app/incidents?tab=needs_attention',
    },
    {
      key: 'devicesOnline',
      icon: Monitor,
      value: c.devices.total > 0 ? `${online}/${c.devices.total}` : '—',
      label: t('overview.metrics.devicesOnline'),
      tone: c.devices.total === 0 ? 'neutral' : c.devices.offline > 0 ? 'warning' : 'success',
      href: '/app/devices',
    },
    {
      key: 'protectionChecks',
      icon: HeartPulse,
      value: h && h.earned !== null ? `${h.earned}%` : '—',
      label: t('overview.metrics.protectionChecks'),
      tone: !h || h.earned === null ? 'neutral' : h.unknownPoints > 0 ? 'warning' : 'success',
      href: '/app/health',
    },
    {
      key: 'sourceStatus',
      icon: Plug,
      value: sourceStatus.value,
      label: t('overview.metrics.sourceStatus'),
      tone: sourceStatus.tone,
      href: '/app/integrations',
    },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {metrics.map((m) => (
        <Link key={m.key} href={m.href} className="group rounded-[14px] border border-border-subtle bg-surface p-4 transition-colors hover:bg-canvas-warm">
          <span className={cn('inline-flex size-8 items-center justify-center rounded-full border', TONE[m.tone])}>
            <m.icon aria-hidden className="size-4" />
          </span>
          <p className={cn('mt-2.5 text-[20px] font-semibold leading-tight tabular', m.tone !== 'neutral' && toneText(m.tone))}>{m.value}</p>
          <p className="mt-0.5 text-[13px] text-ink-secondary">{m.label}</p>
        </Link>
      ))}
    </div>
  );
}
