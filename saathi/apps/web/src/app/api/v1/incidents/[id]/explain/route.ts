import type { Locale } from '@saathi/contracts';
import { aiAvailable, explainIncident, getIncidentDetail } from '@saathi/db';
import { renderMsg } from '@saathi/i18n';
import { actorTx } from '@/server/actor';
import { parseId, userRoute } from '@/server/api';
import { aiConfig } from '@/server/env';

// Optional explanation. It cannot change policy or authorization; failures fall back to the
// standard (template) explanation shown on the page.
export const POST = userRoute<{ id: string }>(async ({ req, ctx, params }) => {
  const cfg = aiConfig(20_000);
  if (!aiAvailable(cfg)) return { status: 'unavailable' as const, summary: null, checks: [] };
  const detail = await actorTx(ctx, (db) => getIncidentDetail(db, ctx.actor, parseId(params.id)));
  const locale = (new URL(req.url).searchParams.get('locale') as Locale) || ctx.dto.locale;
  const ro = { locale, vocabulary: ctx.dto.vocabulary, timezone: ctx.dto.timezone };
  const r = await explainIncident(cfg, {
    language: locale === 'kn' ? 'Kannada' : locale === 'hi' ? 'Hindi' : 'English',
    facts: detail.facts.map((m) => renderMsg(m, ro)),
    uncertain: detail.uncertain.map((m) => renderMsg(m, ro)),
    options: detail.options.map((o) => renderMsg(o.reason, ro)),
    boundaries: detail.boundaries.map((m) => renderMsg(m, ro)),
  });
  return r ? { status: 'used' as const, summary: r.summary, checks: r.checks } : { status: 'failed' as const, summary: null, checks: [] };
});
