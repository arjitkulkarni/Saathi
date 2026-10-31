import { and, eq } from 'drizzle-orm';
import { can } from '@saathi/domain';
import { getPolicy, listMembers, schema as s, telegramStatus } from '@saathi/db';
import { PageHeader } from '@/components/shared/states';
import { actorTx } from '@/server/actor';
import { integrationsStatus } from '@/server/env';
import { pageContext } from '@/server/page';
import { SettingsView } from './settings-view';

export default async function SettingsPage() {
  const { ctx, i18n } = await pageContext('/app/settings');
  const role = ctx.actor.role;
  const data = await actorTx(ctx, async (db) => {
    const [org] = await db.select().from(s.organizations).where(and(eq(s.organizations.id, ctx.actor.orgId)));
    return {
      org: { id: org.id, name: org.name, timezone: org.timezone, workStart: org.workStart, workEnd: org.workEnd, workDays: org.workDays, recoveryContact: org.recoveryContact ?? '', vocabulary: org.vocabulary, locale: org.locale, retention: org.retention },
      policy: can(role, 'incidents.read') ? await getPolicy(db, ctx.actor) : null,
      members: can(role, 'members.manage') ? await listMembers(db, ctx.actor) : null,
      telegram: await telegramStatus(db, ctx.actor),
    };
  });
  return (
    <>
      <PageHeader title={i18n.t('settings.title')} />
      <SettingsView
        role={role}
        org={data.org}
        policy={data.policy ? { version: data.policy.version, autoThrottleEnabled: data.policy.autoThrottleEnabled, throttleRatePerMinute: data.policy.throttleRatePerMinute, throttleDurationMinutes: data.policy.throttleDurationMinutes, burstThreshold: data.policy.burstThreshold, burstWindowSeconds: data.policy.burstWindowSeconds, dailyLimit: data.policy.dailyLimit, consentedAt: data.policy.consentedAt?.toISOString() ?? null } : null}
        members={data.members}
        telegram={{ ...data.telegram, configured: integrationsStatus().telegram }}
      />
    </>
  );
}
