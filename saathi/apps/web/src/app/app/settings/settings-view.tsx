'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { LOCALES, VOCABULARIES, ROLES, type Locale, type MemberDTO, type Role, type Vocabulary } from '@saathi/contracts';
import { Button, Card, Hint, Input, Label, Select } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { CopyField } from '@/components/shared/client';
import { StatusBadge } from '@/components/shared/status';
import { ApiError, apiGet, apiSend } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';

type Org = { id: string; name: string; timezone: string; workStart: string; workEnd: string; workDays: number[]; recoveryContact: string; vocabulary: string; locale: string; retention: { telemetryDays: number; messageImageHours: number; reportDays: number } };
type Policy = { version: number; autoThrottleEnabled: boolean; throttleRatePerMinute: number; throttleDurationMinutes: number; burstThreshold: number; burstWindowSeconds: number; dailyLimit: number; consentedAt: string | null };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="min-w-0">
      <Card className="min-w-0">
        <h2 id={`${id}-h`} className="text-[18px] font-semibold">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </Card>
    </section>
  );
}

const LANG_LABEL: Record<Locale, string> = { en: 'English', kn: 'ಕನ್ನಡ', hi: 'हिन्दी' };

export function SettingsView({ role, org, policy, members, telegram }: { role: Role; org: Org; policy: Policy | null; members: MemberDTO[] | null; telegram: { linked: boolean; linkedAt: string | null; configured: boolean } }) {
  const { t, locale, time } = useI18n();
  const router = useRouter();
  const owner = role === 'owner';
  const [status, setStatus] = useState<Record<string, { tone: 'success' | 'danger' | 'info'; text: string }>>({});
  const note = (k: string, tone: 'success' | 'danger' | 'info', text: string) => setStatus((s) => ({ ...s, [k]: { tone, text } }));
  const fail = (k: string, e: unknown) => note(k, 'danger', e instanceof ApiError ? e.message : t('states.errorBody'));

  // Organization profile
  const [o, setO] = useState(org);
  // Policy with explicit review step (frontend.md §7 "Settings and automation")
  const [draft, setDraft] = useState(policy);
  const [reviewing, setReviewing] = useState(false);
  const [saved, setSaved] = useState(policy);
  // Members
  const [invite, setInvite] = useState<{ email: string; role: Role }>({ email: '', role: 'staff' });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  // Telegram
  const [tgCode, setTgCode] = useState<string | null>(null);
  // Ops
  const [ops, setOps] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (owner) apiGet<Record<string, unknown>>('/api/v1/ops/status').then(setOps).catch(() => setOps(null));
  }, [owner]);

  return (
    <div className="grid min-w-0 gap-5">
      <Section id="language" title={t('settings.language')}>
        <Label htmlFor="pref-locale">{t('common.language')}</Label>
        <Select
          id="pref-locale"
          value={locale}
          onChange={async (e) => {
            await apiSend('/api/v1/me/preferences', 'PATCH', { locale: e.target.value });
            router.refresh();
          }}
          className="max-w-xs"
        >
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LANG_LABEL[l]}
            </option>
          ))}
        </Select>
        {owner && (
          <div className="mt-4">
            <Label htmlFor="vocab">{t('settings.vocabulary')}</Label>
            <Select
              id="vocab"
              className="max-w-xs"
              value={o.vocabulary}
              onChange={async (e) => {
                const v = e.target.value as Vocabulary;
                try {
                  await apiSend(`/api/v1/organizations/${org.id}`, 'PATCH', { vocabulary: v });
                  setO({ ...o, vocabulary: v });
                  router.refresh();
                } catch (err) {
                  fail('language', err);
                }
              }}
            >
              {VOCABULARIES.map((v) => (
                <option key={v} value={v}>
                  {t(`settings.vocab.${v}`)}
                </option>
              ))}
            </Select>
            <Hint>{t('settings.vocabularyNote')}</Hint>
          </div>
        )}
        {status.language && <Notice tone={status.language.tone} className="mt-3">{status.language.text}</Notice>}
      </Section>

      {owner && (
        <Section id="organization" title={t('settings.organization')}>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              note('organization', 'info', t('common.saving'));
              try {
                await apiSend(`/api/v1/organizations/${org.id}`, 'PATCH', { name: o.name, timezone: o.timezone, workStart: o.workStart, workEnd: o.workEnd, recoveryContact: o.recoveryContact });
                note('organization', 'success', t('common.saved'));
                router.refresh();
              } catch (err) {
                fail('organization', err);
              }
            }}
          >
            <div className="sm:col-span-2">
              <Label htmlFor="org-name">{t('onboarding.orgName')}</Label>
              <Input id="org-name" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="org-tz">{t('onboarding.timezone')}</Label>
              <Input id="org-tz" value={o.timezone} onChange={(e) => setO({ ...o, timezone: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="org-ws">{t('onboarding.workStart')}</Label>
                <Input id="org-ws" type="time" value={o.workStart} onChange={(e) => setO({ ...o, workStart: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="org-we">{t('onboarding.workEnd')}</Label>
                <Input id="org-we" type="time" value={o.workEnd} onChange={(e) => setO({ ...o, workEnd: e.target.value })} />
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="org-rc">{t('settings.recoveryContact')}</Label>
              <Input id="org-rc" value={o.recoveryContact} onChange={(e) => setO({ ...o, recoveryContact: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <Button>{t('common.save')}</Button>
            </div>
          </form>
          {status.organization && <Notice tone={status.organization.tone} className="mt-3" role="status">{status.organization.text}</Notice>}
        </Section>
      )}

      {policy && draft && saved && (
        <Section id="automation" title={t('settings.automation')}>
          <p className="text-[15px]">
            <StatusBadge tone={saved.autoThrottleEnabled ? 'info' : 'neutral'} label={saved.autoThrottleEnabled ? t('settings.automationEnabled') : t('settings.automationDisabled')} />{' '}
            <span className="ml-2 text-ink-secondary tabular">{t('settings.automationVersion', { version: saved.version })}</span>
          </p>
          <p className="mt-3 text-[16px] font-medium">{t('onboarding.automationQuestion')}</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-secondary">{t('onboarding.automationScope', { threshold: draft.burstThreshold, seconds: draft.burstWindowSeconds, daily: draft.dailyLimit, rate: draft.throttleRatePerMinute, minutes: draft.throttleDurationMinutes })}</p>
          <p className="mt-1 text-[15px] text-ink-secondary">{t('onboarding.automationImpact')}</p>
          <p className="mt-1 text-[15px] text-ink-secondary">{t('onboarding.automationNotIncluded')}</p>
          {owner && (
            <>
              <label className="mt-4 flex min-h-11 items-center gap-3 text-[16px]">
                <input type="checkbox" className="size-5" checked={draft.autoThrottleEnabled} onChange={(e) => setDraft({ ...draft, autoThrottleEnabled: e.target.checked })} />
                {t('onboarding.automationAccept')}
              </label>
              {draft.autoThrottleEnabled !== saved.autoThrottleEnabled &&
                (!reviewing ? (
                  <Button className="mt-3" variant="secondary" onClick={() => setReviewing(true)}>
                    {t('settings.reviewChange')}
                  </Button>
                ) : (
                  <Notice tone="warning" className="mt-3" title={draft.autoThrottleEnabled ? t('settings.automationEnabled') : t('settings.automationDisabled')}>
                    <p>{t('onboarding.automationScope', { threshold: draft.burstThreshold, seconds: draft.burstWindowSeconds, daily: draft.dailyLimit, rate: draft.throttleRatePerMinute, minutes: draft.throttleDurationMinutes })}</p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        onClick={async () => {
                          note('automation', 'info', t('common.saving'));
                          try {
                            const r = await apiSend<{ version: number }>('/api/v1/policy', 'PATCH', { ...draft, expectedVersion: saved.version });
                            setSaved({ ...draft, version: r.version });
                            setDraft({ ...draft, version: r.version });
                            setReviewing(false);
                            note('automation', 'success', t('settings.automationVersion', { version: r.version }));
                          } catch (err) {
                            fail('automation', err);
                          }
                        }}
                      >
                        {t('settings.confirmPolicy')}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setDraft(saved);
                          setReviewing(false);
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </Notice>
                ))}
            </>
          )}
          {status.automation && <Notice tone={status.automation.tone} className="mt-3" role="status">{status.automation.text}</Notice>}
        </Section>
      )}

      {members && (
        <Section id="members" title={t('settings.members')}>
          <ul className="divide-y divide-border-subtle">
            {members.map((m) => (
              <li key={m.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  <span className="block font-medium">{m.name}</span>
                  <span className="block text-[14px] text-ink-secondary">
                    {m.email}
                    {m.telegramLinked ? ` · ${t('settings.telegramLinked')}` : ''}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {m.status === 'revoked' ? (
                    <StatusBadge tone="neutral" label={t('settings.revokeMember')} />
                  ) : (
                    <Select
                      aria-label={`${t('settings.changeRole')}: ${m.name}`}
                      disabled={m.isSelf}
                      className="mt-0 w-40"
                      defaultValue={m.role}
                      onChange={async (e) => {
                        try {
                          await apiSend(`/api/v1/members/${m.id}`, 'PATCH', { role: e.target.value });
                          note('members', 'success', t('common.saved'));
                        } catch (err) {
                          fail('members', err);
                        }
                      }}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`settings.role.${r}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                  {!m.isSelf && m.status === 'active' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await apiSend(`/api/v1/members/${m.id}`, 'PATCH', { status: 'revoked' });
                          router.refresh();
                        } catch (err) {
                          fail('members', err);
                        }
                      }}
                    >
                      {t('settings.revokeMember')}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await apiSend<{ link: string; expiresAt: string }>('/api/v1/invitations', 'POST', invite);
                setInviteLink(r.link);
                note('members', 'info', t('onboarding.inviteLink', { email: invite.email, expires: time(r.expiresAt) }));
              } catch (err) {
                fail('members', err);
              }
            }}
          >
            <div>
              <Label htmlFor="inv-email">{t('onboarding.inviteEmail')}</Label>
              <Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="inv-role">{t('onboarding.inviteRole')}</Label>
              <Select id="inv-role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {t(`settings.role.${r}`)}
                  </option>
                ))}
              </Select>
            </div>
            <Button>{t('onboarding.inviteSend')}</Button>
          </form>
          {status.members && <Notice tone={status.members.tone} className="mt-3" role="status">{status.members.text}</Notice>}
          {inviteLink && <CopyField className="mt-2" label="invitation link" value={inviteLink} />}
        </Section>
      )}

      <Section id="alerts" title={t('settings.alerts')}>
        {!telegram.configured ? (
          <Notice tone="neutral">{t('onboarding.telegramUnavailable')}</Notice>
        ) : telegram.linked ? (
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge tone="info" label={t('settings.telegramLinked')} />
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await apiSend('/api/v1/telegram/link', 'DELETE');
                router.refresh();
              }}
            >
              {t('settings.telegramUnlink')}
            </Button>
          </div>
        ) : (
          <div>
            <StatusBadge tone="neutral" label={t('settings.telegramNotLinked')} />
            <Button
              className="ml-3"
              size="sm"
              onClick={async () => {
                try {
                  setTgCode((await apiSend<{ code: string }>('/api/v1/telegram/link', 'POST')).code);
                } catch (err) {
                  fail('alerts', err);
                }
              }}
            >
              {t('settings.telegramLink')}
            </Button>
            {tgCode && <p className="mt-3 font-mono text-[16px]">{t('settings.telegramCode', { code: tgCode })}</p>}
          </div>
        )}
        <Hint className="mt-3">{t('onboarding.notificationsBody')}</Hint>
        {status.alerts && <Notice tone={status.alerts.tone} className="mt-3">{status.alerts.text}</Notice>}
      </Section>

      {owner && (
        <Section id="retention" title={t('settings.retention')}>
          <p className="text-[15px] tabular">
            {o.retention.telemetryDays} d · {o.retention.messageImageHours} h · {o.retention.reportDays} d
          </p>
          <Hint>{t('settings.retentionNote')}</Hint>
        </Section>
      )}

      {owner && (
        <Section id="operations" title={t('settings.operations')}>
          {!ops ? (
            <p className="text-[15px] text-ink-secondary">{t('common.loading')}</p>
          ) : (
            <pre className="max-h-96 max-w-full overflow-auto whitespace-pre rounded-[10px] bg-canvas-warm p-3 font-mono text-[12.5px] leading-relaxed" tabIndex={0} aria-label={t('settings.operations')}>
              {JSON.stringify(ops, null, 2)}
            </pre>
          )}
        </Section>
      )}
    </div>
  );
}
