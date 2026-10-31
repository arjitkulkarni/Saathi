import Link from 'next/link';
import { Building2, School, Stethoscope, Store, ShieldCheck, FileCheck2 } from 'lucide-react';
import { Wordmark } from '@/components/brand/wordmark';
import { buttonVariants } from '@/components/ui/primitives';
import { ReceiptExample, VerifyExample } from '@/components/marketing/examples';
import { BuiltSection, JourneySection, ProblemSection, StatusSection } from '@/components/marketing/explainer';
import { JourneyPlayer } from '@/components/marketing/journey-player';
import { FeatureStages } from '@/components/marketing/feature-stages';
import { LandingHeader } from '@/components/marketing/landing-header';
import { RevealOnScroll } from '@/components/marketing/reveal';
import { I18nProvider } from '@/lib/i18n-client';
import { cn } from '@/lib/cn';
import { getSession } from '@/server/actor';
import { requestLocale, serverI18n } from '@/server/i18n';

// Public landing (frontend.md §4): editorial serif hero, warm product stage, three feature
// stages, who it helps, trust, FAQ. All copy and controls render without JavaScript.
export default async function Home() {
  const locale = await requestLocale();
  let signedIn = false;
  try {
    signedIn = !!(await getSession());
  } catch {
    signedIn = false; // database unavailable: the public page still renders
  }
  const { t } = serverI18n({ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' });
  const primaryHref = signedIn ? '/app' : '/login';
  const who = [
    { icon: Stethoscope, title: t('landing.whoClinic'), body: t('landing.whoClinicBody') },
    { icon: Store, title: t('landing.whoShop'), body: t('landing.whoShopBody') },
    { icon: School, title: t('landing.whoSchool'), body: t('landing.whoSchoolBody') },
    { icon: Building2, title: t('landing.whoOffice'), body: t('landing.whoOfficeBody') },
  ];
  const faq = [1, 2, 3, 4, 5].map((n) => ({ q: t(`landing.faq${n}q`), a: t(`landing.faq${n}a`) }));
  const serif = 'font-[family-name:var(--font-display)] text-ink';

  return (
    <I18nProvider value={{ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' }}>
      <div lang={locale} className="min-h-dvh bg-canvas">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[10px] focus:bg-surface focus:px-4 focus:py-2 focus:shadow-[var(--shadow-raised)]">
          {t('common.skipToContent')}
        </a>
        <LandingHeader signedIn={signedIn} />
        <main id="main" tabIndex={-1} className="outline-none">
          {/* Hero */}
          <section className="relative overflow-hidden px-4 pt-14 pb-10 sm:px-6 md:pt-24 md:pb-16">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-40 -z-0 flex justify-center">
              <div className="saathi-glow h-[460px] w-[760px] max-w-[140vw] rounded-full bg-[radial-gradient(closest-side,rgb(246_91_58/0.16),transparent)]" />
            </div>
            <div className="relative mx-auto max-w-[800px] text-center">
              <p className="saathi-rise text-[15px] font-medium text-brand-action-hover">{t('landing.eyebrow')}</p>
              <h1 className={cn(serif, 'mt-4 text-[40px] leading-[1.12] tracking-[-0.015em] sm:text-[46px] md:text-[68px] md:leading-[1.08]')}>
                <span className="saathi-rise block" style={{ animationDelay: '80ms' }}>
                  {t('landing.heroLine1')}
                </span>
                <span className="saathi-rise block" style={{ animationDelay: '200ms' }}>
                  {t('landing.heroLine2')}
                </span>
              </h1>
              <p className="saathi-rise mx-auto mt-6 max-w-[660px] text-[18px] leading-relaxed text-ink-secondary md:text-[19px]" style={{ animationDelay: '320ms' }}>{t('landing.heroBody')}</p>
              <div className="saathi-rise mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row" style={{ animationDelay: '440ms' }}>
                <Link href={primaryHref} className={buttonVariants({ size: 'pill' })}>
                  {t('landing.ctaPrimary')}
                </Link>
                <a href="#journey" className={buttonVariants({ variant: 'quiet', size: 'pill' })}>
                  {t('landing.ctaSecondary')}
                </a>
              </div>
              <p className="mt-4 text-[14px] text-ink-secondary">{t('landing.qualifier')}</p>
            </div>
            <div className="saathi-rise relative mt-12" style={{ animationDelay: '560ms' }}>
              <JourneyPlayer />
            </div>
          </section>

          <ProblemSection t={t} />
          <JourneySection t={t} />

          {/* How it works */}
          <section id="how-it-works" data-reveal="" className="border-t border-border-subtle px-4 py-14 sm:px-6 md:py-[104px]">
            <div className="mx-auto max-w-[1160px]">
              <h2 className={cn(serif, 'max-w-[760px] text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]')}>{t('landing.howTitle')}</h2>
              <div className="mt-10">
                <FeatureStages />
              </div>
            </div>
          </section>

          <BuiltSection t={t} />

          {/* Who it helps */}
          <section id="who-it-helps" className="border-t border-border-subtle bg-canvas-warm px-4 py-14 sm:px-6 md:py-[104px]">
            <div className="mx-auto max-w-[1160px]">
              <h2 className={cn(serif, 'max-w-[760px] text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]')}>{t('landing.whoTitle')}</h2>
              <p className="mt-4 max-w-[660px] text-[17px] leading-relaxed text-ink-secondary">{t('landing.whoBody')}</p>
              <ul data-reveal-stagger="" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {who.map((w) => (
                  <li key={w.title} className="rounded-[16px] border border-border-subtle bg-surface p-6">
                    <w.icon aria-hidden className="size-6 text-brand-art" />
                    <h3 className="mt-4 text-[18px] font-semibold text-ink">{w.title}</h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{w.body}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-[14px] text-ink-secondary">{t('landing.whoNote')}</p>
            </div>
          </section>

          {/* Trust and evidence */}
          <section id="trust" data-reveal="" className="px-4 py-14 sm:px-6 md:py-[104px]">
            <div className="mx-auto max-w-[1160px]">
              <h2 className={cn(serif, 'max-w-[760px] text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]')}>{t('landing.trustTitle')}</h2>
              <div className="mt-10 grid gap-6 lg:grid-cols-2">
                <article className="rounded-[22px] bg-canvas-warm p-6 sm:p-10">
                  <ShieldCheck aria-hidden className="size-7 text-brand-art" />
                  <h3 className="mt-4 text-[22px] font-semibold text-ink">{t('landing.trustActionsTitle')}</h3>
                  <p className="mt-3 text-[16px] leading-relaxed text-ink-secondary">{t('landing.trustActionsBody')}</p>
                  <div className="mt-6">
                    <VerifyExample />
                  </div>
                </article>
                <article className="rounded-[22px] bg-canvas-warm p-6 sm:p-10">
                  <FileCheck2 aria-hidden className="size-7 text-brand-art" />
                  <h3 className="mt-4 text-[22px] font-semibold text-ink">{t('landing.trustReceiptsTitle')}</h3>
                  <p className="mt-3 text-[16px] leading-relaxed text-ink-secondary">{t('landing.trustReceiptsBody')}</p>
                  <div className="mt-6">
                    <ReceiptExample />
                  </div>
                  <details className="mt-5 rounded-[12px] border border-border-subtle bg-surface">
                    <summary className="flex min-h-11 items-center px-4 text-[15px] font-medium text-ink">{t('landing.trustTechnical')}</summary>
                    <p className="border-t border-border-subtle px-4 py-3 text-[15px] leading-relaxed text-ink-secondary">{t('landing.trustTechnicalBody')}</p>
                  </details>
                  <Link href="/verify" className="mt-4 inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover underline underline-offset-4">
                    {t('verify.title')}
                  </Link>
                </article>
              </div>
            </div>
          </section>

          <StatusSection t={t} primaryHref={primaryHref} />

          {/* FAQ */}
          <section id="faq" data-reveal="" className="border-t border-border-subtle px-4 py-14 sm:px-6 md:py-[104px]">
            <div className="mx-auto max-w-[800px]">
              <h2 className={cn(serif, 'text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]')}>{t('landing.faqTitle')}</h2>
              <div className="mt-8 divide-y divide-border-subtle border-y border-border-subtle">
                {faq.map((f) => (
                  <details key={f.q} className="group">
                    <summary className="flex min-h-14 items-center justify-between gap-4 py-3 text-[17px] font-medium text-ink">
                      {f.q}
                      <span aria-hidden className="text-[22px] leading-none text-ink-secondary group-open:rotate-45">+</span>
                    </summary>
                    <p className="pb-5 text-[16px] leading-relaxed text-ink-secondary">{f.a}</p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* Final CTA */}
          <section className="px-4 pb-16 sm:px-6 md:pb-24">
            <div className="mx-auto max-w-[1160px] rounded-[22px] bg-canvas-warm px-6 py-14 text-center md:py-20">
              <h2 className={cn(serif, 'mx-auto max-w-[700px] text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]')}>{t('landing.finalTitle')}</h2>
              <Link href={primaryHref} className={cn(buttonVariants({ size: 'pill' }), 'mt-8')}>
                {t('landing.ctaPrimary')}
              </Link>
            </div>
          </section>
        </main>
        <footer className="border-t border-border-subtle px-4 py-10 sm:px-6">
          <div className="mx-auto flex max-w-[1160px] flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="max-w-md">
              <Wordmark />
              <p className="mt-3 text-[14px] leading-relaxed text-ink-secondary">{t('landing.footerNote')}</p>
            </div>
            <nav aria-label="Footer">
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#journey">
                    {t('pitch.nav.journey')}
                  </a>
                </li>
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#how-it-works">
                    {t('landing.navHow')}
                  </a>
                </li>
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#built">
                    {t('pitch.nav.built')}
                  </a>
                </li>
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#who-it-helps">
                    {t('landing.navWho')}
                  </a>
                </li>
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#trust">
                    {t('landing.navTrust')}
                  </a>
                </li>
                <li>
                  <a className="inline-flex min-h-11 items-center hover:underline" href="#status">
                    {t('pitch.nav.status')}
                  </a>
                </li>
                <li>
                  <Link className="inline-flex min-h-11 items-center hover:underline" href="/verify">
                    {t('verify.title')}
                  </Link>
                </li>
                <li>
                  <Link className="inline-flex min-h-11 items-center hover:underline" href={primaryHref}>
                    {signedIn ? t('common.openSaathi') : t('common.signIn')}
                  </Link>
                </li>
              </ul>
            </nav>
          </div>
        </footer>
        <RevealOnScroll />
      </div>
    </I18nProvider>
  );
}
