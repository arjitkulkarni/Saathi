import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { MESSAGES } from '@saathi/i18n';
import { LOCALES, type Locale } from '@saathi/contracts';

// Locale without URL prefixes (decision D-013): explicit user choice cookie, else English.
// The organization's preferred language is applied when the cookie is first set.
export const LOCALE_COOKIE = 'saathi_locale';

export default getRequestConfig(async () => {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale: Locale = (LOCALES as readonly string[]).includes(c ?? '') ? (c as Locale) : 'en';
  return { locale, messages: MESSAGES[locale] as unknown as Record<string, unknown>, timeZone: 'Asia/Kolkata', onError: () => undefined, getMessageFallback: ({ key, namespace }) => (namespace ? `${namespace}.${key}` : key) };
});
