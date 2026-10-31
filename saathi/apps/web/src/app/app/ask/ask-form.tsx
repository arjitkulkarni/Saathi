'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { ImageUp, ShieldQuestion } from 'lucide-react';
import { suggestRedactions } from '@saathi/domain/scam';
import type { ScamVerdict } from '@saathi/contracts';
import { Button, Card, FieldError, Hint, Label, Textarea } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { StatusBadge, verdictTone } from '@/components/shared/status';
import { Time } from '@/components/shared/client';
import { ApiError, apiSend } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type Hist = { id: string; verdict: string; createdAt: string; reported: boolean; inputKind: string };

export function AskForm({ history, aiConfigured }: { history: Hist[]; aiConfigured: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const ids = { text: useId(), file: useId(), err: useId() };
  const [text, setText] = useState('');
  const [consent, setConsent] = useState(false);
  const [attachmentRef, setAttachmentRef] = useState<string | null>(null);
  const [extractNote, setExtractNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setExtractNote(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('consent', String(consent && aiConfigured));
    try {
      const res = await fetch('/api/v1/scam-checks/extract', { method: 'POST', body: fd });
      const body = await res.json();
      if (!res.ok) throw new ApiError(body.error.code, body.error.message, res.status);
      setAttachmentRef(body.data.attachmentRef);
      if (body.data.text) {
        // Extracted text is shown for review and redaction before anything is assessed.
        setText(body.data.text);
        setExtractNote(body.data.legible === false ? t('ask.extractNote') : t('ask.extractNote'));
      } else setExtractNote(t('ask.extractUnavailable'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <Notice tone="neutral" className="mb-5">
          {t('ask.processed', { hours: 24 })}
        </Notice>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await apiSend<{ id: string }>('/api/v1/scam-checks', 'POST', { text, inputKind: attachmentRef ? 'image' : 'text', attachmentRef, externalProcessingConsent: consent && aiConfigured });
              router.push(`/app/ask/${r.id}`);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : t('states.errorBody'));
              setBusy(false);
            }
          }}
        >
          <Label htmlFor={ids.text}>{t('ask.textLabel')}</Label>
          <Textarea id={ids.text} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('ask.textPlaceholder')} maxLength={5000} className="min-h-44" aria-describedby={error ? ids.err : undefined} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="quiet" onClick={() => setText(suggestRedactions(text))} disabled={!text}>
              {t('ask.redact')}
            </Button>
          </div>

          <div className="mt-5">
            <Label htmlFor={ids.file} className="flex items-center gap-2">
              <ImageUp aria-hidden className="size-5 text-ink-secondary" />
              {t('ask.screenshot')}
            </Label>
            <input id={ids.file} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onFile(e.target.files?.[0])} className="mt-2 block min-h-11 text-[15px] file:mr-3 file:min-h-11 file:rounded-[10px] file:border file:border-border-control file:bg-surface file:px-3 file:text-[15px]" />
            <Hint>{t('ask.extractNote')}</Hint>
            {extractNote && <Notice tone="info" className="mt-2">{extractNote}</Notice>}
          </div>

          <label className="mt-5 flex items-start gap-3 text-[15px]">
            <input type="checkbox" className="mt-1 size-4" checked={consent} disabled={!aiConfigured} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              {t('ask.externalConsent')}
              {!aiConfigured && <span className="block text-[14px] text-ink-secondary">{t('ask.externalUnavailable')}</span>}
            </span>
          </label>
          <FieldError id={ids.err}>{error}</FieldError>
          <Button type="submit" size="lg" className="mt-5" disabled={busy || text.trim().length === 0}>
            <ShieldQuestion aria-hidden />
            {busy ? t('ask.checking') : t('ask.check')}
          </Button>
        </form>
      </Card>
      <aside>
        <h2 className="text-[16px] font-semibold">{t('ask.history')}</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-[15px] text-ink-secondary">{t('ask.noHistory')}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {history.map((h) => (
              <li key={h.id}>
                <Link href={`/app/ask/${h.id}`} className="flex min-h-11 flex-col gap-1 rounded-[12px] border border-border-subtle bg-surface px-3 py-2 hover:bg-canvas-warm">
                  <StatusBadge tone={verdictTone(h.verdict as ScamVerdict)} label={t(`status.verdict.${h.verdict}`)} />
                  <span className="text-[13.5px] text-ink-secondary">
                    <Time iso={h.createdAt} />
                    {h.reported ? ` · ${t('ask.reported')}` : ''}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
