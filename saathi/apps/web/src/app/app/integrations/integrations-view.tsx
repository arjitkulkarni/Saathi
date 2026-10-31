'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ChevronRight, Eye, EyeOff, ShieldCheck, ShieldOff } from 'lucide-react';
import type { IntegrationDTO } from '@saathi/contracts';
import { Button, Card, Input, Label, Select } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

export function CapabilityBadges({ i }: { i: IntegrationDTO }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap gap-1.5">
      <StatusBadge tone={i.canObserve ? 'info' : 'neutral'} icon={i.canObserve ? Eye : EyeOff} label={i.canObserve ? t('integrations.canObserve') : t('integrations.unconnected')} />
      <StatusBadge tone={i.canEnforce ? 'info' : 'neutral'} icon={i.canEnforce ? ShieldCheck : ShieldOff} label={i.canEnforce ? t('integrations.canEnforce') : i.canObserve ? t('integrations.readOnly') : t('integrations.unconnected')} />
      {i.isReference && <StatusBadge tone="warning" label={t('integrations.reference')} />}
      {i.status === 'revoked' && <StatusBadge tone="neutral" label={t('integrations.revoke')} />}
    </span>
  );
}

export function IntegrationsView({ initial, canManage }: { initial: IntegrationDTO[]; canManage: boolean }) {
  const { t, time } = useI18n();
  const { data, mutate } = usePolling<IntegrationDTO[]>('/api/v1/integrations', initial, () => false);
  const list = data ?? initial;
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'read_only' | 'unconnected'>('unconnected');
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <ul className="space-y-3">
        {list.map((i) => (
          <li key={i.id}>
            <Link href={`/app/integrations/${i.id}`} className="flex items-center gap-3 rounded-[14px] border border-border-subtle bg-surface px-4 py-3.5 hover:border-border-control sm:px-5">
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">{i.name}</span>
                <span className="mt-1.5 block">
                  <CapabilityBadges i={i} />
                </span>
                <span className="mt-1.5 block text-[14px] text-ink-secondary">{i.lastEventAt ? t('integrations.lastEvent', { time: time(i.lastEventAt) }) : t('integrations.noEvents')}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-secondary" />
            </Link>
          </li>
        ))}
      </ul>
      {canManage && (
        <Card className="mt-6">
          <h2 className="text-[16px] font-semibold">{t('integrations.add')}</h2>
          {error && (
            <Notice tone="danger" className="mt-3" role="alert">
              {error}
            </Notice>
          )}
          <form
            className="mt-3 grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiSend('/api/v1/integrations', 'POST', { name, kind });
                setName('');
                await mutate();
              } catch (err) {
                setError(err instanceof ApiError ? err.message : t('states.errorBody'));
              }
            }}
          >
            <div>
              <Label htmlFor="int-name">{t('integrations.addName')}</Label>
              <Input id="int-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="int-kind">{t('integrations.addKind')}</Label>
              <Select id="int-kind" value={kind} onChange={(e) => setKind(e.target.value as 'read_only' | 'unconnected')}>
                <option value="unconnected">{t('integrations.unconnected')}</option>
                <option value="read_only">{t('integrations.readOnly')}</option>
              </Select>
            </div>
            <Button disabled={name.trim().length < 2}>{t('integrations.add')}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}
