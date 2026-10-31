'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { IncidentCardDTO } from '@saathi/contracts';
import { Button } from '@/components/ui/primitives';
import { EmptyState } from '@/components/shared/states';
import { IncidentRow } from '@/components/incidents/incident-card';
import { apiGet, usePolling } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

type Page = { items: IncidentCardDTO[]; nextCursor: string | null };
const TABS = ['needs_attention', 'investigating', 'recovering', 'all'] as const;

// Tabs are filters over the backend state machine (they do not redefine it). The selected
// tab lives in the URL so Back restores it.
export function IncidentList({ tab, initial }: { tab: (typeof TABS)[number]; initial: Page }) {
  const { t } = useI18n();
  const { data } = usePolling<Page>(`/api/v1/incidents?tab=${tab}`, initial, () => true, { refreshInterval: 10_000 });
  const [more, setMore] = useState<IncidentCardDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(initial.nextCursor);
  const items = [...(data?.items ?? initial.items), ...more.filter((m) => !(data?.items ?? []).some((x) => x.id === m.id))];
  return (
    <div>
      <nav aria-label={t('incidents.title')} className="-mx-1 mb-5 flex gap-1 overflow-x-auto pb-1">
        {TABS.map((k) => (
          <Link
            key={k}
            href={`/app/incidents?tab=${k}`}
            aria-current={k === tab ? 'page' : undefined}
            data-saathi-interactive=""
            className={cn('inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-[15px]', k === tab ? 'border-brand-action/40 bg-brand-soft font-semibold text-brand-action-hover' : 'border-border-subtle bg-surface text-ink hover:bg-surface-subtle')}
          >
            {t(`incidents.tabs.${k}`)}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <EmptyState title={tab === 'all' ? t('incidents.emptyAll') : t('incidents.empty')} body={t('overview.noIncidentsBody')} />
      ) : (
        <ul className="space-y-3">
          {items.map((inc) => (
            <li key={inc.id}>
              <IncidentRow inc={inc} />
            </li>
          ))}
        </ul>
      )}
      {cursor && (
        <div className="mt-5 flex justify-center">
          <Button
            variant="secondary"
            onClick={async () => {
              const p = await apiGet<Page>(`/api/v1/incidents?tab=${tab}&cursor=${encodeURIComponent(cursor)}`);
              setMore((m) => [...m, ...p.items]);
              setCursor(p.nextCursor);
            }}
          >
            {t('incidents.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}
