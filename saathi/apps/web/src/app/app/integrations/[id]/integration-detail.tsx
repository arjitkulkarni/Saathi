'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { IntegrationDTO, Msg } from '@saathi/contracts';
import { Button, Card } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { CopyField } from '@/components/shared/client';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';
import { CapabilityBadges } from '../integrations-view';

export function IntegrationDetail({ initial, canManage }: { initial: IntegrationDTO; canManage: boolean }) {
  const { t, r, time } = useI18n();
  const { data, mutate } = usePolling<IntegrationDTO>(`/api/v1/integrations/${initial.id}`, initial, () => false);
  const i = data ?? initial;
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  async function patch(action: 'test' | 'revoke' | 'rotate_connector_key') {
    setMsg(null);
    try {
      const r0 = await apiSend<{ connectorKey: string | null; test: { ok: boolean; message: Msg } | null }>(`/api/v1/integrations/${i.id}`, 'PATCH', { action });
      if (r0.test) setMsg({ tone: r0.test.ok ? 'success' : 'warning', text: r(r0.test.message) });
      if (r0.connectorKey) setKey(r0.connectorKey);
      await mutate();
    } catch (e) {
      if (e instanceof ApiError && e.details?.reauth) window.location.assign(`/login?reauth=1&next=/app/integrations/${i.id}`);
      else setMsg({ tone: 'danger', text: e instanceof ApiError ? e.message : t('states.errorBody') });
    }
  }

  return (
    <div className="mx-auto max-w-[820px]">
      <Link href="/app/integrations" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('integrations.title')}
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold">{i.name}</h1>
      <div className="mt-3">
        <CapabilityBadges i={i} />
      </div>
      <p className="mt-2 text-[15px] text-ink-secondary">{i.lastEventAt ? t('integrations.lastEvent', { time: time(i.lastEventAt) }) : t('integrations.noEvents')}</p>
      {msg && (
        <Notice tone={msg.tone} className="mt-4" role="status">
          {msg.text}
        </Notice>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-[16px] font-semibold">{t('integrations.capabilities')}</h2>
          <ul className="mt-2 space-y-1.5 text-[15px]">
            {i.capabilities.length === 0 && <li className="text-ink-secondary">{t('common.none')}</li>}
            {i.capabilities.map((c, k) => (
              <li key={k}>{r(c)}</li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="text-[16px] font-semibold">{t('integrations.limits')}</h2>
          <ul className="mt-2 space-y-1.5 text-[15px]">
            {i.limits.map((c, k) => (
              <li key={k}>{r(c)}</li>
            ))}
          </ul>
        </Card>
      </div>
      {i.isReference && (
        <p className="mt-4 text-[15px]">
          <Link className="font-medium text-brand-action-hover underline underline-offset-4" href="/workspace/records">
            {t('workspace.title')} →
          </Link>
        </p>
      )}
      {canManage && i.status !== 'revoked' && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => patch('test')}>
            {t('integrations.test')}
          </Button>
          {i.kind === 'read_only' && (
            <Button variant="secondary" onClick={() => patch('rotate_connector_key')}>
              {t('integrations.rotateKey')}
            </Button>
          )}
          {i.kind !== 'device_agent' && !confirmRevoke && (
            <Button variant="ghost" className="text-danger-ink" onClick={() => setConfirmRevoke(true)}>
              {t('integrations.revoke')}
            </Button>
          )}
        </div>
      )}
      {confirmRevoke && (
        <Notice tone="warning" className="mt-4" title={t('integrations.revoke')}>
          <p>{t('integrations.revokeBody')}</p>
          <div className="mt-3 flex gap-2">
            <Button variant="danger" onClick={() => patch('revoke').then(() => setConfirmRevoke(false))}>
              {t('integrations.revoke')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirmRevoke(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Notice>
      )}
      {key && (
        <Notice tone="warning" className="mt-4" title={t('integrations.keyShown')}>
          <CopyField className="mt-2" label="connector key" value={key} />
        </Notice>
      )}
    </div>
  );
}
