'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Download } from 'lucide-react';
import type { AnchorStatusDTO } from '@saathi/contracts';
import { Button, Card, buttonVariants } from '@/components/ui/primitives';
import { KeyValue, Notice, TechnicalDetails } from '@/components/shared/states';
import { CopyField } from '@/components/shared/client';
import { IntegrityCard, TimestampCard } from '@/components/evidence/status-cards';
import { ChainGraph } from '@/components/evidence/chain-graph';
import { ApiError, apiSend, usePolling } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type Detail = {
  id: string;
  seq: number;
  createdAt: string;
  headHash: string;
  keyId: string;
  hash: string;
  signature: string;
  isSample: boolean;
  retained: boolean;
  entryTypes: { type: string; n: number }[];
  anchor: AnchorStatusDTO & { commitmentHex: string | null; path: { side: string; hash: string }[] | null; rootHex: string | null; merkleVersion: number | null };
  canRequestAnchor: boolean;
  canExport: boolean;
};

export function CheckpointView({ initial }: { initial: Detail }) {
  const { t, time } = useI18n();
  const { data, mutate } = usePolling<Detail>(`/api/v1/checkpoints/${initial.id}`, initial, (d) => !!d && ['pending', 'submitted'].includes(d.anchor.state), { refreshInterval: 30_000 });
  const c = data ?? initial;
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[900px]">
      <Link href="/app/evidence" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
        ← {t('nav.evidence')}
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold">{t('evidence.checkpoint', { seq: c.seq })}</h1>
      <p className="mt-1 text-[15px] text-ink-secondary tabular">{time(c.createdAt, 'long')}</p>
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <IntegrityCard state="signed" />
        <TimestampCard anchor={c.anchor} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {c.canExport && (
          <>
            <a className={buttonVariants()} href={`/api/v1/checkpoints/${c.id}/bundle`}>
              <Download aria-hidden />
              {t('evidence.downloadBundle')}
            </a>
            <a className={buttonVariants({ variant: 'secondary' })} href={`/api/v1/checkpoints/${c.id}/bundle?kind=retained`}>
              {t('evidence.downloadCheckpoint')}
            </a>
          </>
        )}
        <Link className={buttonVariants({ variant: 'secondary' })} href="/verify">
          {t('evidence.verifyLocally')}
        </Link>
        {c.canRequestAnchor && (
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await apiSend(`/api/v1/checkpoints/${c.id}/anchor`, 'POST');
                await mutate();
              } catch (e) {
                setError(e instanceof ApiError ? e.message : t('states.errorBody'));
              }
            }}
          >
            {t('evidence.retryTimestamp')}
          </Button>
        )}
      </div>
      <div className="mt-6">
        <ChainGraph checkpointId={c.id} />
      </div>
      <Card className="mt-6">
        <h2 className="text-[16px] font-semibold">{t('evidence.whatItProves')}</h2>
        <p className="mt-2 text-[15px]">{t('evidence.proves')}</p>
        <p className="mt-1 text-[15px] text-ink-secondary">{t('evidence.doesNotProve')}</p>
      </Card>
      <Card className="mt-4">
        <h2 className="text-[16px] font-semibold">{t('evidence.entries')}</h2>
        <ul className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">
          {c.entryTypes.map((e) => (
            <li key={e.type} className="flex justify-between gap-2 rounded-[8px] bg-canvas-warm px-2.5 py-1.5">
              <span className="font-mono text-[13px]">{e.type}</span>
              <span className="tabular">{e.n}</span>
            </li>
          ))}
        </ul>
      </Card>
      <div className="mt-4">
        <TechnicalDetails summary={t('common.technicalDetails')}>
          <dl>
            <KeyValue label="Head hash (SHA-256)">
              <CopyField label="head hash" value={c.headHash} />
            </KeyValue>
            <KeyValue label="Checkpoint hash">
              <CopyField label="checkpoint hash" value={c.hash} />
            </KeyValue>
            <KeyValue label="Ed25519 signature">
              <CopyField label="signature" value={c.signature} />
            </KeyValue>
            <KeyValue label="Key ID" mono>
              {c.keyId}
            </KeyValue>
            {c.anchor.commitmentHex && (
              <KeyValue label="Commitment">
                <CopyField label="commitment" value={c.anchor.commitmentHex} />
              </KeyValue>
            )}
            {c.anchor.rootHex && (
              <KeyValue label={`Merkle root (v${c.anchor.merkleVersion})`}>
                <CopyField label="merkle root" value={c.anchor.rootHex} />
              </KeyValue>
            )}
            {c.anchor.path && (
              <KeyValue label="Merkle path" mono>
                {c.anchor.path.length === 0 ? '(single-leaf batch)' : c.anchor.path.map((p) => `${p.side}:${p.hash.slice(0, 16)}…`).join(' → ')}
              </KeyValue>
            )}
            {c.anchor.blockHash && (
              <KeyValue label="Bitcoin block">
                <CopyField label="block hash" value={c.anchor.blockHash} />
              </KeyValue>
            )}
          </dl>
        </TechnicalDetails>
      </div>
    </div>
  );
}
