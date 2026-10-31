'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ChevronRight, Download, Monitor, Plus, X } from 'lucide-react';
import type { DeviceCardDTO } from '@saathi/contracts';
import { Button, FieldError, Hint, Input, Label } from '@/components/ui/primitives';
import { EmptyState, Notice } from '@/components/shared/states';
import { StatusBadge, freshnessTone } from '@/components/shared/status';
import { CopyField, Time } from '@/components/shared/client';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

// Standalone Windows executable (no Node.js install needed); built with
// scripts/build-agent-exe.mjs and published as a GitHub release asset — see docs/agent.md.
const AGENT_DOWNLOAD_URL = 'https://github.com/arjitkulkarni/Saathi/releases/download/agent-v0.1.0/saathi-agent-windows-x64.exe';

export function AddDeviceDialog({ onDone }: { onDone?: () => void }) {
  const { t, time } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setCode(null);
          setName('');
          onDone?.();
        }
      }}
    >
      <Dialog.Trigger asChild>
        <Button>
          <Plus aria-hidden />
          {t('devices.add')}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <Dialog.Content className="saathi-fade fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[min(94vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[18px] bg-surface p-6 shadow-[var(--shadow-raised)]">
          <div className="flex items-start justify-between gap-3">
            <Dialog.Title className="text-[20px] font-semibold">{t('devices.addTitle')}</Dialog.Title>
            <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-[10px] hover:bg-surface-subtle" aria-label={t('common.close')}>
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{t('devices.addBody')}</Dialog.Description>
          {!code ? (
            <form
              className="mt-5"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError(null);
                try {
                  setCode(await apiSend('/api/v1/enrollment-codes', 'POST', { deviceName: name }));
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : t('states.errorBody'));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Label htmlFor="dev-name">{t('devices.deviceName')}</Label>
              <Input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Front desk PC" required minLength={2} aria-invalid={!!error} aria-describedby={error ? 'dev-err' : undefined} />
              <FieldError id="dev-err">{error}</FieldError>
              <Button type="submit" className="mt-4" disabled={busy || name.trim().length < 2}>
                {t('devices.generate')}
              </Button>
            </form>
          ) : (
            <div className="mt-5 space-y-3">
              <Notice tone="warning" title={t('devices.codeShown', { time: time(code.expiresAt) })}>
                <p className="mt-1 font-mono text-[22px] font-semibold tracking-[0.12em]">{code.code}</p>
              </Notice>
              <a href={AGENT_DOWNLOAD_URL} className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-border-control bg-surface px-3 text-[15px] font-medium hover:bg-canvas-warm" download>
                <Download aria-hidden className="size-5" />
                {t('devices.downloadAgent')}
              </a>
              <Hint>{t('devices.smartScreenNote')}</Hint>
              <Hint>{t('devices.installSteps')}</Hint>
              <CopyField label="command" value={`.\\saathi-agent-windows-x64.exe --server ${typeof window !== 'undefined' ? window.location.origin : ''} --code ${code.code} --observe-only`} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function DevicesView({ initial, canEnroll }: { initial: DeviceCardDTO[]; canEnroll: boolean }) {
  const { t, r } = useI18n();
  const { data, mutate } = usePolling<DeviceCardDTO[]>('/api/v1/devices', initial, () => true, { refreshInterval: 10_000 });
  const devices = data ?? initial;
  void r;
  return (
    <div>
      {canEnroll && (
        <div className="mb-5">
          <AddDeviceDialog onDone={() => mutate()} />
        </div>
      )}
      {devices.length === 0 ? (
        <EmptyState icon={<Monitor className="size-8" />} title={t('devices.empty')} body={t('overview.noSourcesBody')} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {devices.map((d) => (
            <li key={d.id}>
              <Link href={`/app/devices/${d.id}`} data-saathi-interactive="" className="flex items-start gap-3 rounded-[14px] border border-border-subtle bg-surface p-4 hover:border-border-control">
                <Monitor aria-hidden className="mt-0.5 size-6 shrink-0 text-ink-secondary" />
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold">{d.name}</p>
                  <p className="text-[14px] text-ink-secondary">{d.hostname ?? t('devices.waiting')}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.status === 'waiting' ? (
                      <StatusBadge tone="neutral" label={t('devices.waiting')} />
                    ) : (
                      <StatusBadge tone={freshnessTone(d.freshness)} label={t(`status.freshness.${d.freshness}`)} />
                    )}
                    {d.simulated && <StatusBadge tone="warning" label={t('common.simulatedBadge')} />}
                    {d.status === 'connected' && (d.incompleteChecks > 0 ? <StatusBadge tone="warning" label={t('devices.checksIncomplete')} /> : d.supportedActionCount === 0 ? <StatusBadge tone="neutral" label={t('integrations.readOnly')} /> : <StatusBadge tone="neutral" label={t('devices.ready')} />)}
                  </div>
                  <p className="mt-2 text-[14px] text-ink-secondary">
                    {t('devices.lastSeen', { time: '' })}
                    <Time iso={d.lastSeenAt} /> · {t('devices.supportedActions')}: {d.supportedActionCount}
                    {d.healthEarned !== null && ` · ${t('health.score', { earned: d.healthEarned })}`}
                  </p>
                </div>
                <ChevronRight aria-hidden className="size-5 text-ink-secondary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
