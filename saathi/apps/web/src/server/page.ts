import 'server-only';
import { requireActorPage, type ActorContext } from './actor';
import { requestLocale, serverI18n } from './i18n';

/** Common page context: verified actor + server translator in the viewer's locale. */
export async function pageContext(path: string): Promise<{ ctx: ActorContext; i18n: ReturnType<typeof serverI18n> }> {
  const ctx = await requireActorPage(path);
  const locale = await requestLocale(ctx.dto.locale);
  return { ctx, i18n: serverI18n({ locale, vocabulary: ctx.dto.vocabulary, timezone: ctx.dto.timezone }) };
}
