import Link from 'next/link';
import { ChevronRight, Users } from 'lucide-react';
import { listPeople } from '@saathi/db';
import { EmptyState, PageHeader, StateScreen } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status';
import { load } from '@/server/actor';
import { pageContext } from '@/server/page';

export default async function PeoplePage() {
  const { ctx, i18n } = await pageContext('/app/people');
  const { t } = i18n;
  const res = await load(ctx, (db) => listPeople(db, ctx.actor));
  if (!res.ok) return <StateScreen code={res.code} t={t} />;
  return (
    <>
      <PageHeader title={t('people.title')} description={t('people.intro')} />
      {res.data.length === 0 ? (
        <EmptyState icon={<Users className="size-8" />} title={t('people.empty')} />
      ) : (
        <ul className="divide-y divide-border-subtle rounded-[16px] border border-border-subtle bg-surface">
          {res.data.map((p) => (
            <li key={p.id}>
              <Link href={`/app/people/${p.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-canvas-warm sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="text-[16px] font-semibold">{p.name}</p>
                  <p className="text-[14px] text-ink-secondary">{t('people.sessionsCount', { active: p.activeSessions, restricted: p.restrictedSessions })}</p>
                </div>
                <div className="flex flex-wrap justify-end gap-1.5">
                  {p.status === 'offboarded' && <StatusBadge tone="neutral" label={t('people.inactive')} />}
                  {p.sharedAccount && <StatusBadge tone="warning" label={t('people.shared')} />}
                  {p.restrictedSessions > 0 && <StatusBadge tone="info" label={t('incidents.limited')} />}
                </div>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-secondary" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
