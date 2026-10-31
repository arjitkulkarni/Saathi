import { createTranslator } from 'use-intl/core';
import type { Locale, Msg, Vocabulary } from '@saathi/contracts';
import { en, type Messages } from './en';
import { kn } from './kn';
import { hi } from './hi';
import { vocabParams, VOCAB } from './vocab';

export { en, kn, hi, vocabParams, VOCAB };
export type { Messages };

export const MESSAGES: Record<Locale, Messages> = { en, kn, hi };

/** Review status of each catalogue. KN/HI are model-drafted and need native review (D-013). */
export const TRANSLATION_STATUS: Record<Locale, 'source' | 'machine_draft_needs_native_review'> = {
  en: 'source',
  kn: 'machine_draft_needs_native_review',
  hi: 'machine_draft_needs_native_review',
};

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export type RenderOptions = { locale: Locale; vocabulary: Vocabulary; timezone: string; now?: Date };

/**
 * Deterministic time formatting. Node and browsers ship different ICU locale data for kn/hi,
 * which would make server and client render different text, so only numeric parts come from
 * Intl and month names, am/pm and word order come from the reviewed catalogue.
 */
export function formatTime(iso: string, locale: Locale, timezone: string, style: 'short' | 'long' = 'short'): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const t = getTranslator(locale);
  const h24 = Number(parts.hour) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const month = t('time.months').split('|')[Number(parts.month) - 1] ?? parts.month;
  const time = `${h12}:${parts.minute} ${h24 < 12 ? t('time.am') : t('time.pm')}`;
  return t(style === 'short' ? 'time.short' : 'time.long', { day: Number(parts.day), month, year: parts.year, time });
}

type Translator = (key: string, params?: Record<string, unknown>) => string;

function translator(locale: Locale): Translator {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale] as unknown as Record<string, unknown>,
    onError: () => undefined,
    getMessageFallback: ({ key, namespace }) => {
      const full = namespace ? `${namespace}.${key}` : key;
      // Fall back to English, then to the key itself; never throw while rendering.
      try {
        const fb = createTranslator({ locale: 'en', messages: en as unknown as Record<string, unknown>, onError: () => undefined, getMessageFallback: () => full });
        return (fb as unknown as Translator)(full);
      } catch {
        return full;
      }
    },
  });
  return t as unknown as Translator;
}

const cache = new Map<Locale, Translator>();
export function getTranslator(locale: Locale): Translator {
  let t = cache.get(locale);
  if (!t) {
    t = translator(locale);
    cache.set(locale, t);
  }
  return t;
}

/** Parameter values that are themselves vocabulary (states, action types, rules). */
function translateParam(t: Translator, key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (key === 'action' && value.includes('.')) return t(`action.title.${value.replace('.', '_')}`);
  if (key === 'state') return t(`status.action.${value}`);
  if (key === 'from' || key === 'to') return t(`status.incident.${value}`);
  if (key === 'rule') return t(`rules.${value}`);
  if (key === 'component') return t(`components.${value || 'protection'}`);
  if (key === 'confidence') return t(`onboarding.confidence.${value}`);
  if (key === 'step') return t(`recovery.step.${value}.title`);
  return value;
}

export function renderMsg(m: Msg | null | undefined, o: RenderOptions): string {
  if (!m) return '';
  const t = getTranslator(o.locale);
  const params: Record<string, unknown> = { ...vocabParams(o.vocabulary, o.locale) };
  for (const [k, v] of Object.entries(m.params ?? {})) {
    params[k] = typeof v === 'string' && ISO.test(v) ? formatTime(v, o.locale, o.timezone) : translateParam(t, k, v);
  }
  return t(m.key, params);
}

/** Plain translation of a UI key with vocabulary nouns available. */
export function translate(key: string, params: Record<string, unknown>, o: RenderOptions): string {
  return getTranslator(o.locale)(key, { ...vocabParams(o.vocabulary, o.locale), ...params });
}
