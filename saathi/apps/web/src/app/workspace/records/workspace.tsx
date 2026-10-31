'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Database, Download, FileText, LogOut, ShieldAlert, Zap } from 'lucide-react';
import { Button, Card, FieldError, Input, Label } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { useI18n } from '@/lib/i18n-client';
import { cn } from '@/lib/cn';

const KEY = 'saathi_records_session';
type Rec = { id: string; title: string; category: string };
type SessionInfo = { token: string; staffName: string; deviceLabel: string };
type Outcome = { recordId: string; kind: 'ok' | 'denied' | 'limited' | 'unavailable' | 'signed_out'; text: string; body?: string };

/** Per-tab session (sessionStorage) so two tabs can hold two sessions (decision D-014). */
function loadSession(): SessionInfo | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function RecordsWorkspace({ orgId }: { orgId: string | null }) {
  const { t } = useI18n();
  const ids = { code: useId(), pin: useId(), device: useId(), err: useId() };
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [records, setRecords] = useState<Rec[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // A demo tab may arrive with #token=…&label=…&name=…; keep it in this tab only.
    const h = new URLSearchParams(window.location.hash.slice(1));
    if (h.get('token')) {
      const s = { token: h.get('token')!, deviceLabel: h.get('label') ?? '', staffName: h.get('name') ?? '' };
      sessionStorage.setItem(KEY, JSON.stringify(s));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // Deferred so the first client render matches the server render (no session yet).
    const t0 = setTimeout(() => setSession(loadSession()), 0);
    return () => clearTimeout(t0);
  }, []);

  const fetchRecords = useCallback(async (s: SessionInfo): Promise<{ records: Rec[]; error: string | null }> => {
    try {
      const res = await fetch('/api/v1/records', { headers: { Authorization: `Bearer ${s.token}` }, cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) return { records: [], error: res.status === 503 ? t('workspace.unavailable') : t('workspace.denied', { reason: reasonText(body?.error?.details?.reason) }) };
      return { records: body.data.records, error: null };
    } catch {
      return { records: [], error: t('workspace.unavailable') };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    fetchRecords(session).then((r) => {
      if (!alive) return;
      setRecords(r.records);
      setListError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [session, fetchRecords]);

  function reasonText(reason?: string) {
    return reason ? t(`workspace.reason.${reason}`) : '';
  }

  async function download(rec: Rec, s: SessionInfo): Promise<Outcome> {
    try {
      const res = await fetch(`/api/v1/records/${rec.id}/download`, { headers: { Authorization: `Bearer ${s.token}` }, cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { recordId: rec.id, kind: 'ok', text: rec.title, body: body.data.record.body };
      if (res.status === 429) return { recordId: rec.id, kind: 'limited', text: t('workspace.limited') };
      if (res.status === 503) return { recordId: rec.id, kind: 'unavailable', text: t('workspace.unavailable') };
      if (res.status === 401) return { recordId: rec.id, kind: 'signed_out', text: t('workspace.denied', { reason: reasonText('session_unknown') }) };
      return { recordId: rec.id, kind: 'denied', text: t('workspace.denied', { reason: reasonText(body?.error?.details?.reason) }) };
    } catch {
      return { recordId: rec.id, kind: 'unavailable', text: t('workspace.unavailable') };
    }
  }

  async function signIn(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const res = await fetch('/api/v1/records/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, employeeCode: f.get('code'), pin: f.get('pin'), deviceLabel: f.get('device'), familiar: f.get('familiar') === 'on' }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? 'Sign-in failed');
      const s = { token: body.data.token, staffName: body.data.staffName, deviceLabel: body.data.deviceLabel };
      sessionStorage.setItem(KEY, JSON.stringify(s));
      setSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-[#f4f6f8]">
      <header className="border-b border-[#d9dee5] bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2 text-[17px] font-semibold text-[#1f2a37]">
            <Database aria-hidden className="size-5" />
            {t('workspace.title')}
          </div>
          <span className="rounded-full bg-[#fff4d8] px-3 py-1 text-[13px] font-medium text-[#8a5000]">{t('common.synthetic')}</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Notice tone="neutral" className="mb-5">
          {t('workspace.label')} {t('workspace.tabNote')}
        </Notice>
        {!orgId ? (
          <Notice tone="warning">{t('states.notFoundBody')}</Notice>
        ) : !session ? (
          <Card className="mx-auto max-w-md">
            <h1 className="text-[20px] font-semibold">{t('workspace.signIn')}</h1>
            <form onSubmit={signIn} className="mt-4 space-y-4">
              <div>
                <Label htmlFor={ids.code}>{t('workspace.employeeCode')}</Label>
                <Input id={ids.code} name="code" autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor={ids.pin}>{t('workspace.pin')}</Label>
                <Input id={ids.pin} name="pin" type="password" inputMode="numeric" autoComplete="current-password" required />
              </div>
              <div>
                <Label htmlFor={ids.device}>{t('workspace.deviceLabel')}</Label>
                <Input id={ids.device} name="device" defaultValue="Office PC" required />
              </div>
              <label className="flex min-h-11 items-center gap-3 text-[15px]">
                <input type="checkbox" name="familiar" defaultChecked className="size-4" />
                {t('workspace.familiar')}
              </label>
              <FieldError id={ids.err}>{error}</FieldError>
              <Button type="submit" className="w-full" disabled={busy}>
                {t('workspace.signIn')}
              </Button>
            </form>
          </Card>
        ) : (
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[16px] font-medium">{t('workspace.signedInAs', { name: session.staffName, device: session.deviceLabel })}</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || records.length === 0}
                  onClick={async () => {
                    setBusy(true);
                    const out: Outcome[] = [];
                    for (const rec of records.slice(0, 25)) out.push(await download(rec, session));
                    setOutcomes(out.reverse());
                    setBusy(false);
                  }}
                >
                  <Zap aria-hidden />
                  {t('workspace.burst')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    sessionStorage.removeItem(KEY);
                    setSession(null);
                    setOutcomes([]);
                  }}
                >
                  <LogOut aria-hidden />
                  {t('workspace.signOut')}
                </Button>
              </div>
            </div>
            {listError && (
              <Notice tone="danger" className="mb-4" role="alert">
                {listError}
              </Notice>
            )}
            {outcomes.length > 0 && (
              <section aria-live="polite" className="mb-5 rounded-[14px] border border-[#d9dee5] bg-white p-4">
                <ul className="max-h-56 space-y-1.5 overflow-y-auto text-[14px]">
                  {outcomes.map((o, i) => (
                    <li key={i} className={cn('flex items-center gap-2', o.kind === 'ok' ? 'text-success-ink' : o.kind === 'limited' ? 'text-warning-ink' : 'text-danger-ink')}>
                      {o.kind === 'ok' ? <FileText aria-hidden className="size-4" /> : <ShieldAlert aria-hidden className="size-4" />}
                      {o.kind === 'ok' ? `${t('workspace.download')}: ${o.text}` : o.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <ul className="divide-y divide-[#e5e9ef] rounded-[14px] border border-[#d9dee5] bg-white">
              {records.map((rec) => (
                <li key={rec.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{rec.title}</span>
                    <span className="block text-[13px] text-ink-secondary">{rec.category}</span>
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={async () => {
                      const o = await download(rec, session);
                      setOutcomes((x) => [o, ...x].slice(0, 30));
                    }}
                  >
                    <Download aria-hidden />
                    {t('workspace.download')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
