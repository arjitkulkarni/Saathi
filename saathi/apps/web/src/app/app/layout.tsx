import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { can } from '@saathi/domain';
import { coverageSummary } from '@saathi/db';
import { AppShell, type NavKey } from '@/components/shell/app-shell';
import { I18nProvider } from '@/lib/i18n-client';
import { actorTx, getActorContext } from '@/server/actor';
import { requestLocale } from '@/server/i18n';

// Authenticated console shell. Navigation visibility is a usability aid only; every page and
// API re-checks authority against current membership.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await getActorContext();
  if (ctx === null) redirect('/login?next=/app');
  if (ctx === 'no_membership') redirect('/onboarding');
  if (ctx.actor.role === 'owner' && !ctx.dto.setupComplete) redirect('/onboarding');
  const role = ctx.actor.role;
  const visible: NavKey[] = [];
  if (can(role, 'overview.read')) visible.push('overview');
  if (can(role, 'incidents.read')) visible.push('incidents');
  if (can(role, 'scam.submit')) visible.push('ask');
  if (can(role, 'devices.read')) visible.push('devices');
  if (can(role, 'people.read')) visible.push('people');
  if (can(role, 'health.read')) visible.push('health');
  if (can(role, 'evidence.read')) visible.push('evidence');
  if (can(role, 'reports.read')) visible.push('reports');
  if (can(role, 'devices.read')) visible.push('integrations');
  visible.push('settings');
  const coverage = await actorTx(ctx, (db) => coverageSummary(db, ctx.actor.orgId));
  const locale = await requestLocale(ctx.dto.locale);
  const dto = { ...ctx.dto, locale };
  return (
    <I18nProvider value={{ locale, vocabulary: dto.vocabulary, timezone: dto.timezone }}>
      <div lang={locale}>
        <AppShell actor={dto} visible={visible} coverage={coverage}>
          {children}
        </AppShell>
      </div>
    </I18nProvider>
  );
}
