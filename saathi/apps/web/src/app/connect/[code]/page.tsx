import Link from 'next/link';
import { Wordmark } from '@/components/brand/wordmark';
import { I18nProvider } from '@/lib/i18n-client';
import { requestLocale } from '@/server/i18n';
import { PreviewPanel } from './preview-panel';

export const metadata = { title: 'Saathi — attack preview' };

// Public, unauthenticated preview: the enrollment code in the URL is itself the one-use
// credential (see runAttackPreview in @saathi/db). No Saathi account needed to view this.
export default async function ConnectPage(props: PageProps<'/connect/[code]'>) {
  const { code } = await props.params;
  const locale = await requestLocale();
  return (
    <I18nProvider value={{ locale, vocabulary: 'generic', timezone: 'Asia/Kolkata' }}>
      <main lang={locale} className="flex min-h-dvh flex-col items-center bg-canvas-warm px-4 py-12">
        <Link href="/" className="mb-8" aria-label="Saathi home">
          <Wordmark size="lg" />
        </Link>
        <PreviewPanel code={code} />
      </main>
    </I18nProvider>
  );
}
