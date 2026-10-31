'use client';

import { useState } from 'react';
import { AlertTriangle, KeyRound, ShieldAlert, ShieldOff } from 'lucide-react';
import { Button, Card, SectionTitle } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { ApiError, apiSend } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type Scenario = 'malware_detected' | 'protection_disabled' | 'password_guessing';
const SCENARIOS: { key: Scenario; icon: typeof ShieldAlert }[] = [
  { key: 'malware_detected', icon: ShieldAlert },
  { key: 'protection_disabled', icon: ShieldOff },
  { key: 'password_guessing', icon: KeyRound },
];

export function PreviewPanel({ code }: { code: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<Scenario | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Scenario[]>([]);

  async function run(scenario: Scenario) {
    setBusy(scenario);
    setError(null);
    try {
      await apiSend(`/api/v1/connect/${code}`, 'POST', { scenario });
      setDone((d) => [...d, scenario]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="w-full max-w-[560px]">
      <SectionTitle className="flex items-center gap-2">
        <AlertTriangle aria-hidden className="size-5 text-warning-ink" />
        {t('connect.title')}
      </SectionTitle>
      <Notice tone="warning" className="mt-3">
        {t('connect.simulatedNotice')}
      </Notice>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-secondary">{t('connect.body')}</p>
      <div className="mt-5 space-y-2">
        {SCENARIOS.map(({ key, icon: Icon }) => (
          <Button key={key} variant="secondary" className="w-full justify-start" disabled={!!busy || done.includes(key)} onClick={() => run(key)}>
            <Icon aria-hidden />
            {done.includes(key) ? t('connect.done', { scenario: t(`connect.scenario.${key}`) }) : busy === key ? t('common.loading') : t(`connect.scenario.${key}`)}
          </Button>
        ))}
      </div>
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}
      {done.length > 0 && <Notice className="mt-4">{t('connect.checkDashboard')}</Notice>}
    </Card>
  );
}
