'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { Lock, ShieldCheck } from 'lucide-react';
import type { ActionType, DeviceDetailDTO } from '@saathi/contracts';
import { Button, Card, Input, Label, SectionTitle } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, actionTone, checkTone, freshnessTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { IncidentRow } from '@/components/incidents/incident-card';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

const DEFAULT_PARAMS: Partial<Record<ActionType, Record<string, string | number>>> = {
  'device.lock_session': {},
  'device.restrict_removable_storage': { scope: 'new_removable_disks' },
  'device.enable_firewall': { profile: 'All' },
  'device.set_lockout_policy': { threshold: 5, durationMinutes: 15 },
  'device.enable_av': { component: 'realtime' },
  'device.request_av_scan': { scanType: 'quick' },
};

export function DeviceDetailView({ initial, canPreview, canRetire }: { initial: DeviceDetailDTO; canPreview: boolean; canRetire: boolean }) {
  const { t, r, time } = useI18n();
  const router = useRouter();
  const { data } = usePolling<DeviceDetailDTO>(`/api/v1/devices/${initial.id}`, initial, () => true, { refreshInterval: 10_000 });
  const d = data ?? initial;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ip, setIp] = useState('');
  const offline = d.freshness !== 'fresh';

  async function preview(actionType: ActionType, params: Record<string, string | number>) {
    setBusy(true);
    setError(null);
    try {
      const { previewId } = await apiSend<{ previewId: string }>(`/api/v1/devices/${d.id}/previews`, 'POST', { actionType, params });
      router.push(`/app/previews/${previewId}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
      setBusy(false);
    }
  }

  return (
    <div>
      <Link href="/app/devices" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('devices.title')}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="text-[28px] font-semibold">{d.name}</h1>
        <StatusBadge tone={freshnessTone(d.freshness)} label={t(`status.freshness.${d.freshness}`)} />
        {d.simulated && <StatusBadge tone="warning" label={t('common.simulatedBadge')} />}
      </div>
      <p className="mt-1 text-[15px] text-ink-secondary tabular">
        {d.hostname} · {d.osVersion} · agent {d.agentVersion} · {t('devices.lastSeen', { time: time(d.lastSeenAt) })}
      </p>
      {offline && d.status === 'connected' && (
        <Notice tone="warning" className="mt-4">
          {t('approve.blocked.device_offline', { lastSeen: time(d.lastSeenAt) })}
        </Notice>
      )}
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle>{t('devices.posture')}</SectionTitle>
          <ul className="mt-3 divide-y divide-border-subtle">
            {d.posture.map((p) => (
              <li key={p.key} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-start sm:justify-between">
                <span>
                  <span className="block font-medium">{t(`health.check.${p.key}`)}</span>
                  <span className="block text-[13.5px] text-ink-secondary">
                    {p.value ?? '—'} · {p.source}
                    {p.stale && p.observedAt ? ` · ${t('health.stale')}` : ''}
                  </span>
                </span>
                <StatusBadge tone={checkTone(p.result)} label={t(`status.check.${p.result}`)} />
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle>{t('devices.supportedActions')}</SectionTitle>
          <ul className="mt-3 space-y-2">
            {d.capabilities.length === 0 && <li className="text-[15px] text-ink-secondary">{t('devices.waiting')}</li>}
            {d.capabilities.map((c) => {
              const params = DEFAULT_PARAMS[c.action as ActionType];
              return (
                <li key={c.action} className="flex flex-col gap-2 rounded-[12px] border border-border-subtle px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="block font-medium">{t(`devices.actionNames.${c.action.replace('.', '_')}`)}</span>
                    {!c.supported && <span className="block text-[13.5px] text-ink-secondary">{t('devices.unsupported')}: {c.reason}</span>}
                  </span>
                  {canPreview && c.supported && params && (
                    <Button size="sm" variant="secondary" disabled={busy || offline} onClick={() => preview(c.action as ActionType, params)} title={offline ? t('approve.blocked.device_offline', { lastSeen: time(d.lastSeenAt) }) : undefined}>
                      {t('devices.previewFix')}
                    </Button>
                  )}
                  {canPreview && c.supported && c.action === 'device.block_source_ip' && (
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        preview('device.block_source_ip', { address: ip, direction: 'inbound' });
                      }}
                    >
                      <Label htmlFor="ip" className="sr-only">
                        IP
                      </Label>
                      <Input id="ip" value={ip} onChange={(e) => setIp(e.target.value)} placeholder="203.0.113.7" className="mt-0 w-36" pattern="\d{1,3}(\.\d{1,3}){3}" />
                      <Button size="sm" variant="secondary" disabled={busy || offline || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)}>
                        {t('devices.previewFix')}
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>

        {d.prerequisites.length > 0 && (
          <Card>
            <SectionTitle>{t('devices.prerequisites')}</SectionTitle>
            <ul className="mt-3 space-y-2 text-[15px]">
              {d.prerequisites.map((p) => (
                <li key={p.key} className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block font-medium">{t(`devices.prereq.${p.key}`) === `devices.prereq.${p.key}` ? p.key.replace(/_/g, ' ') : t(`devices.prereq.${p.key}`)}</span>
                    {p.detail && <span className="block text-[13.5px] text-ink-secondary">{p.detail}</span>}
                  </span>
                  <StatusBadge tone={p.met ? 'success' : 'warning'} label={p.met ? t('status.check.pass') : t('devices.checksIncomplete')} />
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[14px] text-ink-secondary">{t('devices.queue', { depth: d.spoolDepth, dropped: d.droppedEvents })}</p>
          </Card>
        )}

        <Card>
          <SectionTitle>{t('devices.accounts')}</SectionTitle>
          <ul className="mt-3 space-y-2">
            {d.accounts.length === 0 && <li className="text-[15px] text-ink-secondary">{t('common.none')}</li>}
            {d.accounts.map((a) => (
              <li key={a.sid} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="block font-medium">{a.username}</span>
                  <span className="flex flex-wrap gap-1.5 pt-1">
                    {a.isAdmin && <StatusBadge tone="info" icon={ShieldCheck} label={t('devices.admin')} />}
                    {!a.enabled && <StatusBadge tone="neutral" label={t('devices.disabled')} />}
                    {a.protected && <StatusBadge tone="neutral" icon={Lock} label={t('devices.protectedAccount')} />}
                  </span>
                </span>
                {canPreview && a.enabled && !a.protected && d.capabilities.some((c) => c.action === 'device.disable_local_account' && c.supported) && (
                  <Button size="sm" variant="secondary" disabled={busy || offline} onClick={() => preview('device.disable_local_account', { sid: a.sid })}>
                    {t('devices.previewFix')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <SectionTitle>{t('devices.history')}</SectionTitle>
          <ul className="mt-3 space-y-2">
            {d.actions.length === 0 && <li className="text-[15px] text-ink-secondary">{t('overview.nothingHandled')}</li>}
            {d.actions.map((a) => (
              <li key={a.id}>
                <Link href={`/app/actions/${a.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-[10px] px-2 hover:bg-surface-subtle">
                  <span className="font-medium">{r(a.title)}</span>
                  <StatusBadge tone={actionTone(a.state)} label={t(`status.action.${a.state}`)} />
                </Link>
              </li>
            ))}
          </ul>
          {d.changes.filter((c) => c.status === 'active').length > 0 && (
            <div className="mt-4 border-t border-border-subtle pt-3">
              {d.changes
                .filter((c) => c.status === 'active')
                .map((c) => (
                  <div key={c.id} className="flex items-center justify-between gap-2 py-1">
                    <span className="text-[14px]">{t(`action.title.${c.actionType.replace('.', '_')}`)}</span>
                    {canPreview && d.capabilities.some((x) => x.action === 'device.undo_change' && x.supported) && (
                      <Button size="sm" variant="secondary" disabled={busy || offline} onClick={() => preview('device.undo_change', { changeId: c.actionId })}>
                        {t('preview.approveAction.device_undo_change')}
                      </Button>
                    )}
                  </div>
                ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle>{t('devices.observations')}</SectionTitle>
          {d.recentObservations.length === 0 ? (
            <p className="mt-2 text-[15px] text-ink-secondary">{t('common.none')}</p>
          ) : (
            <div className="mt-3 overflow-x-auto" role="region" aria-label={t('devices.observations')} tabIndex={0}>
              <table className="w-full min-w-[520px] text-left text-[14px]">
                <thead className="text-ink-secondary">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Type</th>
                    <th className="py-1.5 pr-3 font-medium">{t('common.observedAt', { time: '' })}</th>
                    <th className="py-1.5 font-medium">Disposition</th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentObservations.map((o, i) => (
                    <tr key={i} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-3 font-mono text-[13px]">{o.type}</td>
                      <td className="py-1.5 pr-3 tabular">{t('devices.observedReceived', { observed: time(o.observedAt), received: time(o.receivedAt) })}</td>
                      <td className="py-1.5">{o.disposition ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {d.incidents.length > 0 && (
          <div className="space-y-2 lg:col-span-2">
            <SectionTitle>{t('nav.incidents')}</SectionTitle>
            {d.incidents.map((i) => (
              <IncidentRow key={i.id} inc={i} compact />
            ))}
          </div>
        )}
      </div>

      {canRetire && d.status === 'connected' && <RetireDialog deviceId={d.id} />}
    </div>
  );
}

function RetireDialog({ deviceId }: { deviceId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="ghost" className="mt-8 text-danger-ink">
          {t('devices.retire')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="saathi-fade fixed left-1/2 top-1/2 z-50 w-[min(92vw,480px)] -translate-x-1/2 -translate-y-1/2 rounded-[18px] bg-surface p-6 shadow-[var(--shadow-raised)]">
          <Dialog.Title className="text-[20px] font-semibold">{t('devices.retire')}</Dialog.Title>
          <Dialog.Description className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{t('devices.retireBody')}</Dialog.Description>
          {error && (
            <Notice tone="danger" className="mt-3" role="alert">
              {error}
            </Notice>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="secondary">{t('common.cancel')}</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  await apiSend(`/api/v1/devices/${deviceId}/retire`, 'POST');
                  router.push('/app/devices');
                } catch (e) {
                  if (e instanceof ApiError && e.details?.reauth) window.location.assign(`/login?reauth=1&next=/app/devices/${deviceId}`);
                  else setError(e instanceof ApiError ? e.message : t('states.errorBody'));
                }
              }}
            >
              {t('devices.retireConfirm')}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
