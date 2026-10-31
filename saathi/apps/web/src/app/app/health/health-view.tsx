'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { ActionType, HealthDTO } from '@saathi/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { EmptyState, Notice } from '@/components/shared/states';
import { StatusBadge, checkTone } from '@/components/shared/status';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

const FIX_PARAMS: Partial<Record<ActionType, Record<string, string | number>>> = {
  'device.enable_av': { component: 'realtime' },
  'device.enable_firewall': { profile: 'All' },
  'device.set_lockout_policy': { threshold: 5, durationMinutes: 15 },
};

// A score describes checked posture, not the chance of a breach (frontend.md §7).
export function HealthView({ initial, canPreview }: { initial: HealthDTO; canPreview: boolean }) {
  const { t, r, time } = useI18n();
  const router = useRouter();
  const { data } = usePolling<HealthDTO>('/api/v1/health', initial, () => true, { refreshInterval: 20_000 });
  const h = data ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function fix(deviceId: string, actionType: ActionType) {
    setBusy(true);
    try {
      const { previewId } = await apiSend<{ previewId: string }>(`/api/v1/devices/${deviceId}/previews`, 'POST', { actionType, params: FIX_PARAMS[actionType] ?? {} });
      router.push(`/app/previews/${previewId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(false);
    }
  }

  if (h.earned === null) return <EmptyState title={t('health.noDevices')} body={t('overview.noSourcesBody')} action={<Link href="/app/devices" className="font-medium text-brand-action-hover underline underline-offset-4">{t('devices.add')}</Link>} />;
  const unknownPct = (h.unknownPoints / 100) * 100;
  return (
    <div>
      {error && (
        <Notice tone="danger" className="mb-4" role="alert">
          {error}
        </Notice>
      )}
      <Card>
        <p className="text-[32px] font-semibold tabular">{t('health.score', { earned: h.earned })}</p>
        <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-surface-subtle" role="img" aria-label={`${t('health.score', { earned: h.earned })}, ${t('health.unknownPoints', { unknown: h.unknownPoints })}`}>
          <div className="h-full bg-ink" style={{ width: `${h.earned}%` }} />
          <div className="h-full bg-[repeating-linear-gradient(45deg,#d9d5ce_0_6px,#ece9e3_6px_12px)]" style={{ width: `${unknownPct}%` }} />
        </div>
        <p className="mt-2 text-[15px] text-ink-secondary tabular">
          {t('health.unknownPoints', { unknown: h.unknownPoints })} · {t('health.devicesCounted', { count: h.devicesCounted })} · v{h.weightsVersion} · {time(h.computedAt)}
        </p>
        {h.devicesExcluded.length > 0 && (
          <p className="mt-1 text-[14px] text-ink-secondary">
            {t('health.excludedLabel')}: {h.devicesExcluded.map((d) => `${d.name} (${r(d.reason)})`).join(', ')}
          </p>
        )}
      </Card>
      <ul className="mt-5 space-y-3">
        {h.checks.map((c) => (
          <li key={c.key}>
            <Card className="p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[17px] font-semibold">{t(`health.check.${c.key}`)}</h2>
                <span className="flex items-center gap-2 text-[14px] text-ink-secondary tabular">
                  {c.earned}/{c.weight}
                  {c.unknownPoints > 0 && ` · ${c.unknownPoints} ?`}
                  <StatusBadge tone={checkTone(c.result)} label={t(`status.check.${c.result}`)} />
                </span>
              </div>
              <ul className="mt-3 divide-y divide-border-subtle">
                {c.devices.map((d) => (
                  <li key={d.deviceId} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0 text-[15px]">
                      <Link href={`/app/devices/${d.deviceId}`} className="font-medium underline-offset-4 hover:underline">
                        {d.deviceName}
                      </Link>
                      <span className="text-ink-secondary">
                        {' '}
                        · {d.value ?? '—'}
                        {d.stale && ` · ${t('health.stale')}`}
                      </span>
                      {d.guidance && <span className="block text-[14px] text-ink-secondary">{r(d.guidance)}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge tone={checkTone(d.result)} label={t(`status.check.${d.result}`)} />
                      {canPreview && d.fixAction && (
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => fix(d.deviceId, d.fixAction!)}>
                          {t('health.reviewFix')}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
