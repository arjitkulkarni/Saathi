import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';
import { LocalVerifier } from '@/components/evidence/local-verifier';
import { I18nProvider } from '@/lib/i18n-client';
import { requestLocale, serverI18n } from '@/server/i18n';

export const metadata = { title: 'Verify a receipt' };

// Public local verifier: no sign-in, no uploads (frontend.md §8).
export default async function VerifyPage() {
  const locale = await requestLocale();
  const { t } = serverI18n({ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' });
  return (
    <I18nProvider value={{ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' }}>
      <div lang={locale} className="min-h-dvh bg-canvas-warm">
        <header className="border-b border-border-subtle bg-canvas">
          <div className="mx-auto flex h-16 max-w-[1160px] items-center justify-between px-4 sm:px-6">
            <Link href="/" aria-label="Saathi home">
              <Wordmark />
            </Link>
            <Link href="/app/evidence" className="inline-flex min-h-11 items-center text-[15px] text-ink-secondary hover:text-ink">
              {t('nav.evidence')}
            </Link>
          </div>
        </header>
        <main id="main" className="mx-auto max-w-[1160px] px-4 py-8 sm:px-6 md:py-12">
          <h1 className="text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">{t('verify.title')}</h1>
          <p className="mt-2 max-w-[700px] text-[17px] text-ink-secondary">{t('verify.intro')}</p>
          <div className="mt-8">
            <LocalVerifier />
          </div>
          <section className="mt-10 max-w-[760px] text-[15px] leading-relaxed text-ink-secondary">
            <h2 className="text-[16px] font-semibold text-ink">{t('evidence.whatItProves')}</h2>
            <p className="mt-1">{t('evidence.proves')}</p>
            <p className="mt-1">{t('evidence.doesNotProve')}</p>
          </section>
        </main>
      </div>
    </I18nProvider>
  );
}
