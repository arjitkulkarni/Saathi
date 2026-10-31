'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { CheckCircle2, CircleDashed, Clock, KeyRound, XCircle } from 'lucide-react';
import { Button, Card, Hint, Input, Label } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

type Row = { id: string; status: 'pass' | 'fail' | 'not_checked' | 'pending'; message: string; details?: string[] };
type Key = { keyId: string; publicKeyHex: string };

const ICON = { pass: CheckCircle2, fail: XCircle, not_checked: CircleDashed, pending: Clock } as const;
const TONE = { pass: 'text-success-ink', fail: 'text-danger-ink', not_checked: 'text-neutral-ink', pending: 'text-focus' } as const;

async function readJson(f: File | null | undefined): Promise<unknown> {
  if (!f || f.size === 0) return undefined;
  if (f.size > 20 * 1024 * 1024) throw new Error('file too large');
  return JSON.parse(await f.text());
}

/**
 * Local integrity verification (build.md Ph15.6, flow.md §11.3). Files are read in this
 * browser only; nothing is uploaded. Trusted keys come from this verifier, never from the
 * bundle. Bitcoin is checked only against a block header the user supplies from a source
 * they trust; otherwise it is reported as not checked offline.
 */
export function LocalVerifier() {
  const { t } = useI18n();
  const ids = { bundle: useId(), retained: useId(), height: useId(), merkle: useId() };
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [keysError, setKeysError] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [integrityOk, setIntegrityOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/v1/verifier/keys')
      .then((r) => r.json())
      .then((b) => setKeys(b.keys))
      .catch(() => setKeysError(true));
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const f = new FormData(e.currentTarget);
      const bundle = await readJson(f.get('bundle') as File);
      if (!bundle) throw new Error(t('verify.bundle'));
      const retained = await readJson(f.get('retained') as File);
      const height = Number(f.get('height') || 0);
      const merkle = String(f.get('merkle') || '').trim().toLowerCase();
      const chainContext = height > 0 && /^[0-9a-f]{64}$/.test(merkle) ? { height, blockHash: '', merkleRootHex: merkle, time: 0 } : null;
      // Loaded only when needed so the verifier code does not slow other pages.
      const { verifyBundle } = await import('@saathi/evidence');
      const res = verifyBundle({ bundle, retained, trustedKeys: keys ?? [], chainContext });
      setRows(res.rows as Row[]);
      setIntegrityOk(res.integrityOk);
    } catch (err) {
      setRows(null);
      setIntegrityOk(null);
      setError(`${t('states.errorTitle')}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const blockchain = rows?.find((r) => r.id === 'blockchain');

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="min-w-0 space-y-6">
        <Card>
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <Label htmlFor={ids.bundle}>{t('verify.bundle')}</Label>
              <Input id={ids.bundle} name="bundle" type="file" accept="application/json,.json" required className="py-2" />
            </div>
            <div>
              <Label htmlFor={ids.retained}>{t('verify.retained')}</Label>
              <Input id={ids.retained} name="retained" type="file" accept="application/json,.json" className="py-2" />
            </div>
            <fieldset className="rounded-[12px] border border-border-subtle p-4">
              <legend className="px-1 text-[15px] font-medium">{t('verify.chain')}</legend>
              <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                <div>
                  <Label htmlFor={ids.height}>{t('verify.chainHeight')}</Label>
                  <Input id={ids.height} name="height" inputMode="numeric" pattern="\d*" />
                </div>
                <div>
                  <Label htmlFor={ids.merkle}>{t('verify.chainMerkle')}</Label>
                  <Input id={ids.merkle} name="merkle" spellCheck={false} className="font-mono text-[14px]" />
                </div>
              </div>
              <Hint>{t('verify.timestampHelp')}</Hint>
            </fieldset>
            <Button type="submit" size="lg" disabled={busy || keys === null}>
              {busy ? t('common.loading') : t('verify.run')}
            </Button>
          </form>
        </Card>

        <div aria-live="polite" className="space-y-4">
          {error && (
            <Notice tone="danger" role="alert">
              {error}
            </Notice>
          )}
          {rows && (
            <>
              <Notice tone={integrityOk ? 'success' : 'danger'} title={integrityOk ? t('verify.integrityPassed') : t('verify.integrityFailed')} role={integrityOk ? 'status' : 'alert'} />
              {blockchain && blockchain.status !== 'pass' && <Notice tone="neutral">{t('verify.offline')}</Notice>}
              <ol className="divide-y divide-border-subtle rounded-[16px] border border-border-subtle bg-surface" data-testid="verify-rows">
                {rows.map((r) => {
                  const Icon = ICON[r.status];
                  return (
                    <li key={r.id} data-check={r.id} data-status={r.status} className="px-4 py-3.5 sm:px-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[16px] font-semibold">{t(`verify.rows.${r.id}`)}</span>
                        <span className={cn('inline-flex items-center gap-1.5 text-[14px] font-medium', TONE[r.status])}>
                          <Icon aria-hidden className="size-4" />
                          {t(`verify.result.${r.status}`)}
                        </span>
                      </div>
                      <p className="mt-1 text-[15px] text-ink">{r.message}</p>
                      {r.details && r.details.length > 0 && (
                        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[14px] text-ink-secondary">
                          {r.details.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      </div>

      <aside className="min-w-0 space-y-4">
        <Card>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <KeyRound aria-hidden className="size-5 text-ink-secondary" />
            {t('verify.keys')}
          </h2>
          <p className="mt-1 text-[14px] text-ink-secondary">{t('verify.keysNote')}</p>
          {keysError && <p className="mt-2 text-[14px] text-danger-ink">{t('states.errorBody')}</p>}
          <ul className="mt-3 space-y-2">
            {(keys ?? []).map((k) => (
              <li key={k.keyId} className="text-[13px]">
                <span className="font-medium">{k.keyId}</span>
                <code className="mt-0.5 block rounded-[8px] bg-surface-subtle px-2 py-1 font-mono text-[12px] [overflow-wrap:anywhere]">{k.publicKeyHex}</code>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <a href="/verify/standalone" download className="inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover underline underline-offset-4">
            {t('verify.standalone')}
          </a>
          <p className="mt-1 text-[14px] text-ink-secondary">{t('verify.standaloneNote')}</p>
        </Card>
      </aside>
    </div>
  );
}
