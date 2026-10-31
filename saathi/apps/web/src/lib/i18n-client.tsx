'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Locale, Msg, Vocabulary } from '@saathi/contracts';
import { formatTime, renderMsg, translate } from '@saathi/i18n';

type Ctx = { locale: Locale; vocabulary: Vocabulary; timezone: string };
const I18nCtx = createContext<Ctx>({ locale: 'en', vocabulary: 'generic', timezone: 'Asia/Kolkata' });

export function I18nProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

/** Translation hooks shared with the server renderer (same catalogue, same vocabulary). */
export function useI18n() {
  const c = useContext(I18nCtx);
  const t = useCallback((key: string, params: Record<string, unknown> = {}) => translate(key, params, c), [c]);
  const r = useCallback((m: Msg | null | undefined) => renderMsg(m, c), [c]);
  const time = useCallback((iso: string | null | undefined, style: 'short' | 'long' = 'short') => (iso ? formatTime(iso, c.locale, c.timezone, style) : t('common.never')), [c, t]);
  return useMemo(() => ({ ...c, t, r, time }), [c, t, r, time]);
}
