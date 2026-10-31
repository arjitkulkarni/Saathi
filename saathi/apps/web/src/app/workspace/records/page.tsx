import { getActorContext } from '@/server/actor';
import { requestLocale } from '@/server/i18n';
import { I18nProvider } from '@/lib/i18n-client';
import { RecordsWorkspace } from './workspace';

export const metadata = { title: 'Records workspace (reference app)' };

// Reference business application, separate from the security console (flow.md §3).
// The org parameter only selects which workspace to sign in to.
export default async function RecordsWorkspacePage(props: PageProps<'/workspace/records'>) {
  const sp = await props.searchParams;
  const orgParam = Array.isArray(sp.org) ? sp.org[0] : sp.org;
  const ctx = await getActorContext().catch(() => null);
  const consoleCtx = ctx && ctx !== 'no_membership' ? ctx : null;
  const orgId = orgParam && /^[0-9a-f-]{36}$/.test(orgParam) ? orgParam : (consoleCtx?.actor.orgId ?? null);
  const locale = await requestLocale(consoleCtx?.dto.locale ?? 'en');
  return (
    <I18nProvider value={{ locale, vocabulary: consoleCtx?.dto.vocabulary ?? 'generic', timezone: consoleCtx?.dto.timezone ?? 'Asia/Kolkata' }}>
      <RecordsWorkspace orgId={orgId} />
    </I18nProvider>
  );
}
