import { redirect } from 'next/navigation';
import { can } from '@saathi/domain';
import { StateScreen } from '@/components/shared/states';
import { I18nProvider } from '@/lib/i18n-client';
import { getActorContext } from '@/server/actor';
import { env } from '@/server/env';
import { requestLocale, serverI18n } from '@/server/i18n';
import { DemoControls } from './demo-controls';

export const metadata = { title: 'Demonstration controls' };

export default async function DemoPage() {
  const ctx = await getActorContext();
  if (ctx === null) redirect('/login?next=/demo');
  if (ctx === 'no_membership') redirect('/onboarding');
  const locale = await requestLocale(ctx.dto.locale);
  const i18n = serverI18n({ locale, vocabulary: ctx.dto.vocabulary, timezone: ctx.dto.timezone });
  const allowed = env().DEMO_MODE === 'on' && ctx.dto.isDemo && can(ctx.actor.role, 'demo.control');
  return (
    <I18nProvider value={{ locale, vocabulary: ctx.dto.vocabulary, timezone: ctx.dto.timezone }}>
      <div lang={locale} className="min-h-dvh bg-canvas-warm">
        <div className="bg-ink px-4 py-2 text-center text-[13px] font-semibold tracking-wide text-white">
          {i18n.t('common.demoBadge')} · {i18n.t('common.replayBadge')} · {i18n.t('common.synthetic')}
        </div>
        <main className="mx-auto max-w-[1100px] px-4 py-8">{allowed ? <DemoControls orgName={ctx.dto.orgName} vocabulary={ctx.dto.vocabulary} orgId={ctx.actor.orgId} /> : <StateScreen code="FORBIDDEN" t={i18n.t} />}</main>
      </div>
    </I18nProvider>
  );
}
