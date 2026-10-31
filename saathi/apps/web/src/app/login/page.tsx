import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';
import { I18nProvider } from '@/lib/i18n-client';
import { requestLocale } from '@/server/i18n';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in' };

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const locale = await requestLocale();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  // Only same-site relative destinations are honoured.
  const next = one(sp.next);
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
  return (
    <I18nProvider value={{ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' }}>
      <main lang={locale} className="flex min-h-dvh flex-col items-center justify-center bg-canvas-warm px-4 py-12">
        <Link href="/" className="mb-8" aria-label="Saathi home">
          <Wordmark size="lg" />
        </Link>
        <LoginForm next={safeNext} invite={one(sp.invite)} reauth={one(sp.reauth) === '1'} />
      </main>
    </I18nProvider>
  );
}
