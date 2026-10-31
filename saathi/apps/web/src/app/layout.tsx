import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Noto_Sans_Devanagari, Noto_Sans_Kannada } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Regional fonts; the browser downloads them only when Kannada/Devanagari glyphs render.
const kannada = Noto_Sans_Kannada({ subsets: ['kannada'], variable: '--font-kannada', display: 'swap', weight: ['400', '600'], preload: false });
const devanagari = Noto_Sans_Devanagari({ subsets: ['devanagari'], variable: '--font-devanagari', display: 'swap', weight: ['400', '600'], preload: false });

export const metadata: Metadata = {
  title: { default: 'Saathi – security decisions people can understand', template: '%s · Saathi' },
  description: 'Saathi explains security concerns in your language, shows who each response affects, and checks what happened after you act.',
};
export const viewport: Viewport = { themeColor: '#f8f6f2', width: 'device-width', initialScale: 1 };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${inter.variable} ${kannada.variable} ${devanagari.variable}`}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
