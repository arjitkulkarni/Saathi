import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import type { Locale, OrgType } from '@saathi/contracts';
import { coverageSummary, getPolicy, listIntegrations, schema as s } from '@saathi/db';
import { Wordmark } from '@/components/brand/wordmark';
import { I18nProvider } from '@/lib/i18n-client';
import { actorTx, getActorContext, getSession } from '@/server/actor';
import { integrationsStatus } from '@/server/env';
import { requestLocale } from '@/server/i18n';
import { OnboardingFlow } from './onboarding-flow';

export const metadata = { title: 'Set up your organization' };

// Resumable owner setup (flow.md §4, frontend.md §7).
export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login?next=/onboarding');
  const ctx = await getActorContext();
  const locale = await requestLocale(ctx && ctx !== 'no_membership' ? ctx.dto.locale : 'en');
  let state: Parameters<typeof OnboardingFlow>[0]['state'] = { step: 'organization', orgId: null, policyVersion: null, coverage: null, integrations: [], recoveryContact: '', profile: null };
  if (ctx && ctx !== 'no_membership') {
    if (ctx.actor.role !== 'owner' || ctx.dto.setupComplete) redirect('/app');
    state = await actorTx(ctx, async (db) => {
      const [org] = await db.select().from(s.organizations).where(and(eq(s.organizations.id, ctx.actor.orgId)));
      const policy = await getPolicy(db, ctx.actor);
      return {
        step: (org.setupStep === 'done' ? 'review' : org.setupStep) as 'organization' | 'people' | 'sources' | 'automation' | 'notifications' | 'review',
        orgId: org.id,
        policyVersion: policy?.version ?? 1,
        coverage: await coverageSummary(db, org.id),
        integrations: await listIntegrations(db, ctx.actor),
        recoveryContact: org.recoveryContact ?? '',
        profile: { name: org.name, orgType: org.orgType as OrgType, locale: org.locale as Locale, timezone: org.timezone, workStart: org.workStart, workEnd: org.workEnd, workDays: org.workDays },
      };
    });
  }
  return (
    <I18nProvider value={{ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' }}>
      <div lang={locale} className="min-h-dvh bg-canvas-warm">
        <header className="flex h-16 items-center border-b border-border-subtle px-4 sm:px-8">
          <Wordmark />
        </header>
        <main className="mx-auto max-w-[720px] px-4 py-8 sm:py-12">
          <OnboardingFlow state={state} telegramConfigured={integrationsStatus().telegram} />
        </main>
      </div>
    </I18nProvider>
  );
}
