'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ExternalLink, Play, Repeat, Zap } from 'lucide-react';
import { VOCABULARIES, type Vocabulary } from '@saathi/contracts';
import { Button, Card, Select, Label } from '@/components/ui/primitives';
import { Notice, PageHeader } from '@/components/shared/states';
import { CopyField } from '@/components/shared/client';
import { ApiError, apiSend } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

type Sess = { token: string; label: string };
type Scenario = { orgId: string; person: string; office: Sess; laptop: Sess };
type Log = { at: string; text: string; tone: 'ok' | 'bad' | 'warn' };

async function tryDownload(token: string): Promise<{ status: number; reason?: string }> {
  const list = await fetch('/api/v1/records', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const lb = await list.json().catch(() => ({}));
  const rec = lb?.data?.records?.[0];
  if (!list.ok || !rec) return { status: list.status, reason: lb?.error?.details?.reason ?? lb?.error?.code };
  const res = await fetch(`/api/v1/records/${rec.id}/download`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const b = await res.json().catch(() => ({}));
  return { status: res.status, reason: b?.error?.details?.reason };
}

export function DemoControls({ orgName, vocabulary, orgId }: { orgName: string; vocabulary: Vocabulary; orgId: string }) {
  const { t } = useI18n();
  const [sc, setSc] = useState<Scenario | null>(null);
  const [logs, setLogs] = useState<Record<'office' | 'laptop', Log[]>>({ office: [], laptop: [] });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [vocab, setVocab] = useState<Vocabulary>(vocabulary);

  const log = (k: 'office' | 'laptop', text: string, tone: Log['tone']) => setLogs((l) => ({ ...l, [k]: [{ at: new Date().toLocaleTimeString(), text, tone }, ...l[k]].slice(0, 12) }));
  const describe = (r: { status: number; reason?: string }) => (r.status === 200 ? t('status.decision.allow') : r.status === 429 ? t('workspace.limited') : t('workspace.denied', { reason: r.reason ? t(`workspace.reason.${r.reason}`) : String(r.status) }));
  const tone = (s: number): Log['tone'] => (s === 200 ? 'ok' : s === 429 ? 'warn' : 'bad');

  async function run(name: string, fn: () => Promise<void>) {
    setBusy(name);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const panel = (k: 'office' | 'laptop') => {
    const s = sc?.[k];
    return (
      <Card className="min-w-0">
        <h3 className="text-[16px] font-semibold">{k === 'office' ? t('demo.sessionB') : t('demo.sessionA')}</h3>
        <p className="text-[14px] text-ink-secondary">
          {sc?.person} · {s?.label}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!s || !!busy}
            onClick={() =>
              run(`try-${k}`, async () => {
                const r = await tryDownload(s!.token);
                log(k, describe(r), tone(r.status));
              })
            }
          >
            {t('demo.tryBoth')}
          </Button>
          {k === 'laptop' && (
            <Button
              size="sm"
              disabled={!s || !!busy}
              onClick={() =>
                run('burst', async () => {
                  for (let i = 0; i < 25; i++) {
                    const r = await tryDownload(s!.token);
                    if (i % 5 === 4 || r.status !== 200) log('laptop', `#${i + 1}: ${describe(r)}`, tone(r.status));
                  }
                })
              }
            >
              <Zap aria-hidden />
              {t('demo.burst')}
            </Button>
          )}
          {s && (
            <a
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-3 text-[14px] font-medium text-brand-action-hover hover:bg-brand-soft"
              href={`/workspace/records?org=${orgId}#token=${encodeURIComponent(s.token)}&label=${encodeURIComponent(s.label)}&name=${encodeURIComponent(sc!.person)}`}
              target="_blank"
              rel="noopener"
            >
              <ExternalLink aria-hidden className="size-4" />
              {t('workspace.title')}
            </a>
          )}
        </div>
        <ul aria-live="polite" className="mt-3 space-y-1 text-[14px]">
          {logs[k].map((l, i) => (
            <li key={i} className={cn('tabular', l.tone === 'ok' ? 'text-success-ink' : l.tone === 'warn' ? 'text-warning-ink' : 'text-danger-ink')}>
              {l.at} · {l.text}
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  return (
    <div>
      <PageHeader title={t('demo.title')} description={`${orgName} — ${t('demo.warning')}`} actions={<Link className="inline-flex min-h-11 items-center px-3 font-medium text-brand-action-hover" href="/app/overview">{t('nav.overview')} →</Link>} />
      {msg && (
        <Notice tone="danger" className="mb-4" role="alert">
          {msg}
        </Notice>
      )}
      <Card>
        <h2 className="text-[18px] font-semibold">{t('demo.startScenario')}</h2>
        <p className="mt-1 text-[15px] text-ink-secondary">{t('demo.scenarioBody')}</p>
        <Button className="mt-3" disabled={!!busy} onClick={() => run('scenario', async () => setSc(await apiSend<Scenario>('/api/v1/demo/scenario', 'POST')))}>
          <Play aria-hidden />
          {t('demo.startScenario')}
        </Button>
      </Card>
      {sc && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {panel('laptop')}
          {panel('office')}
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="text-[17px] font-semibold">{t('common.replayBadge')}</h2>
          <div className="mt-3 flex flex-col gap-2">
            {(['normal_day', 'device_warning', 'slow_extraction'] as const).map((k) => (
              <Button
                key={k}
                variant="secondary"
                disabled={!!busy}
                onClick={() =>
                  run(k, async () => {
                    const r = await apiSend<{ events: number }>('/api/v1/demo/replays', 'POST', { kind: k });
                    setMsg(null);
                    log('office', t('demo.replayResult', { count: r.events }), 'warn');
                  })
                }
              >
                <Repeat aria-hidden />
                {t(k === 'normal_day' ? 'demo.replayNormal' : k === 'device_warning' ? 'demo.replayDevice' : 'demo.replaySlow')}
              </Button>
            ))}
          </div>
        </Card>
        <Card>
          <h2 className="text-[17px] font-semibold">{t('demo.simulatedDevice')}</h2>
          <p className="mt-1 text-[15px] text-ink-secondary">{t('common.simulatedBadge')}</p>
          <Button className="mt-3" variant="secondary" disabled={!!busy} onClick={() => run('code', async () => setCode((await apiSend<{ code: string }>('/api/v1/enrollment-codes', 'POST', { deviceName: 'Simulated front desk PC' })).code))}>
            {t('devices.generate')}
          </Button>
          {code && <CopyField className="mt-3" label="command" value={`pnpm dev:agent -- --simulate --server http://localhost:3000 --code ${code}`} />}
          <div className="mt-5">
            <Label htmlFor="vocab">{t('demo.vocabulary')}</Label>
            <Select
              id="vocab"
              value={vocab}
              onChange={(e) =>
                run('vocab', async () => {
                  const v = e.target.value as Vocabulary;
                  await apiSend(`/api/v1/organizations/${orgId}`, 'PATCH', { vocabulary: v });
                  setVocab(v);
                })
              }
            >
              {VOCABULARIES.map((v) => (
                <option key={v} value={v}>
                  {t(`settings.vocab.${v}`)}
                </option>
              ))}
            </Select>
            <p className="mt-1.5 text-[14px] text-ink-secondary">{t('settings.vocabularyNote')}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
