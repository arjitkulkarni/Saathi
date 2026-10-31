import 'server-only';
import { cookies } from 'next/headers';
import { LOCALES, type Locale, type Msg, type Vocabulary } from '@saathi/contracts';
import { formatTime, renderMsg, translate } from '@saathi/i18n';
import { LOCALE_COOKIE } from '@/i18n/request';

export async function requestLocale(fallback: Locale = 'en'): Promise<Locale> {
  const c = (await cookies()).get(LOCALE_COOKIE)?.value;
  return (LOCALES as readonly string[]).includes(c ?? '') ? (c as Locale) : fallback;
}

/** Server-side translator bound to locale/vocabulary/timezone. */
export function serverI18n(o: { locale: Locale; vocabulary: Vocabulary; timezone: string }) {
  return {
    ...o,
    t: (key: string, params: Record<string, unknown> = {}) => translate(key, params, o),
    r: (m: Msg | null | undefined) => renderMsg(m, o),
    time: (iso: string | null | undefined, style: 'short' | 'long' = 'short') => (iso ? formatTime(iso, o.locale, o.timezone, style) : translate('common.never', {}, o)),
  };
}
