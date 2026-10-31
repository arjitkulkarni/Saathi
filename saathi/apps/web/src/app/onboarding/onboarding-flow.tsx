'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LOCALES, ORG_TYPES, ROLES, type CoverageSummaryDTO, type IntegrationDTO, type Locale, type OrgType, type Role, type TelegramLinkDTO } from '@saathi/contracts';
import { Button, Card, FieldError, Hint, Input, Label, Select } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { CopyField } from '@/components/shared/client';
import { ApiError, apiSend } from '@/lib/api';
import { useI18n } from '@/lib/i18n-client';
import { CapabilityBadges } from '@/app/app/integrations/integrations-view';
import { AddDeviceDialog } from '@/app/app/devices/devices-view';
import { DependencyCard, type DependencyCardHandle } from './dependency-card';

const STEPS = ['organization', 'people', 'sources', 'automation', 'notifications', 'review'] as const;
type Step = (typeof STEPS)[number];
type State = { step: Step; orgId: string | null; policyVersion: number | null; coverage: CoverageSummaryDTO | null; integrations: IntegrationDTO[]; recoveryContact: string; profile: Profile | null };
type Profile = { name: string; orgType: OrgType; locale: Locale; timezone: string; workStart: string; workEnd: string; workDays: number[] };
const LANG: Record<Locale, string> = { en: 'English', kn: 'ಕನ್ನಡ', hi: 'हिन्दी' };

export function OnboardingFlow({ state, telegramConfigured }: { state: State; telegramConfigured: boolean }) {
  const { t, time } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<Step>(state.step);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteLinks, setInviteLinks] = useState<string[]>([]);
  const [tgLink, setTgLink] = useState<TelegramLinkDTO | null>(null);
  const idx = STEPS.indexOf(step);
  const prev = idx > 0 ? STEPS[idx - 1] : null;
  const heading = useRef<HTMLHeadingElement>(null);
  const deps = useRef<DependencyCardHandle>(null);
  const firstRender = useRef(true);

  // Moving between steps announces the new step to keyboard and screen-reader users.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const go = async (next: Step | 'done') => {
    if (state.orgId) await apiSend(`/api/v1/organizations/${state.orgId}`, 'PATCH', next === 'done' ? { setupStep: 'done', setupComplete: true } : { setupStep: next });
    if (next === 'done') window.location.assign('/app/overview');
    else {
      setStep(next);
      setError(null);
      router.refresh();
    }
  };
  const back = prev ? () => run(() => go(prev)) : undefined;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="text-[14px] font-medium text-ink-secondary">{t('onboarding.stepOf', { current: idx + 1, total: STEPS.length })}</p>
      <ol className="mt-2 flex gap-1.5" aria-label={t('onboarding.title')}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1" aria-current={s === step ? 'step' : undefined}>
            <div className={`h-1.5 rounded-full ${i <= idx ? 'bg-ink' : 'bg-border-subtle'}`} />
            <span className="sr-only">{t(`onboarding.steps.${s}`)}</span>
          </li>
        ))}
      </ol>
      <h1 ref={heading} tabIndex={-1} className="mt-5 text-[28px] font-semibold outline-none">{t(`onboarding.steps.${step}`)}</h1>
      {error && (
        <Notice tone="danger" className="mt-4" role="alert">
          {error}
        </Notice>
      )}

      {step === 'organization' && (
        <Card className="mt-5">
          <Notice tone="neutral" className="mb-5">
            {t('onboarding.coverageExplain')}
          </Notice>
          <form
            className="grid gap-4"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              run(async () => {
                if (!state.orgId) {
                  await apiSend('/api/v1/organizations', 'POST', {
                    name: f.get('name'),
                    orgType: f.get('type'),
                    locale: f.get('locale'),
                    timezone: f.get('tz'),
                    workStart: f.get('ws'),
                    workEnd: f.get('we'),
                    workDays: f.getAll('days').map(Number),
                  });
                  await apiSend('/api/v1/me/preferences', 'PATCH', { locale: f.get('locale') });
                  window.location.assign('/onboarding');
                } else {
                  // Returning to this step edits the existing organization instead of ignoring the form.
                  const p = state.profile;
                  const locale = f.get('locale') as Locale;
                  await apiSend(`/api/v1/organizations/${state.orgId}`, 'PATCH', { name: f.get('name'), orgType: f.get('type'), locale, timezone: f.get('tz'), workStart: f.get('ws'), workEnd: f.get('we'), workDays: f.getAll('days').map(Number) });
                  if (p && locale !== p.locale) {
                    await apiSend('/api/v1/me/preferences', 'PATCH', { locale });
                    await apiSend(`/api/v1/organizations/${state.orgId}`, 'PATCH', { setupStep: 'people' });
                    window.location.assign('/onboarding');
                  } else await go('people');
                }
              });
            }}
          >
            <div>
              <Label htmlFor="o-name">{t('onboarding.orgName')}</Label>
              <Input id="o-name" name="name" required minLength={2} defaultValue={state.profile?.name} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="o-type">{t('onboarding.orgType')}</Label>
                <Select id="o-type" name="type" defaultValue={state.profile?.orgType ?? "office"}>
                  {ORG_TYPES.map((x) => (
                    <option key={x} value={x}>
                      {t(`onboarding.types.${x}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="o-locale">{t('onboarding.preferredLanguage')}</Label>
                <Select id="o-locale" name="locale" defaultValue={state.profile?.locale ?? "en"}>
                  {LOCALES.map((l) => (
                    <option key={l} value={l} lang={l}>
                      {LANG[l]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="o-tz">{t('onboarding.timezone')}</Label>
              <Input id="o-tz" name="tz" defaultValue={state.profile?.timezone ?? (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata')} required />
            </div>
            <fieldset>
              <legend className="text-[15px] font-medium">{t('onboarding.workingHours')}</legend>
              <div className="mt-1 grid grid-cols-2 gap-3 sm:max-w-sm">
                <div>
                  <Label htmlFor="o-ws">{t('onboarding.workStart')}</Label>
                  <Input id="o-ws" name="ws" type="time" defaultValue={state.profile?.workStart ?? "09:00"} />
                </div>
                <div>
                  <Label htmlFor="o-we">{t('onboarding.workEnd')}</Label>
                  <Input id="o-we" name="we" type="time" defaultValue={state.profile?.workEnd ?? "18:00"} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t('onboarding.workDays')}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <label key={d} className="flex min-h-11 items-center gap-1.5 rounded-[10px] border border-border-subtle bg-surface px-3 text-[15px]">
                    <input type="checkbox" name="days" value={d} defaultChecked={state.profile ? state.profile.workDays.includes(d) : d !== 0} className="size-4" />
                    {t(`onboarding.days.${d}`)}
                  </label>
                ))}
              </div>
            </fieldset>
            <Button size="lg" disabled={busy}>
              {t('common.continue')}
            </Button>
          </form>
        </Card>
      )}

      {step === 'people' && (
        <div className="mt-5 space-y-5">
          <Card>
            <p className="text-[15px] text-ink-secondary">{t('onboarding.peopleBody')}</p>
            <p className="mt-2 text-[15px] text-ink-secondary">{t('onboarding.personVsSession')}</p>
            <form
              className="mt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const v = new FormData(e.currentTarget).get('rc');
                run(async () => {
                  await apiSend(`/api/v1/organizations/${state.orgId}`, 'PATCH', { recoveryContact: v });
                });
              }}
            >
              <Label htmlFor="rc">{t('onboarding.recoveryContact')}</Label>
              <Input id="rc" name="rc" defaultValue={state.recoveryContact} />
              <Button size="sm" variant="secondary" className="mt-2" disabled={busy}>
                {t('common.save')}
              </Button>
            </form>
            <form
              className="mt-5 grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const email = String(f.get('email'));
                run(async () => {
                  const r = await apiSend<{ link: string; expiresAt: string }>('/api/v1/invitations', 'POST', { email, role: f.get('role') as Role });
                  setInviteLinks((l) => [...l, `${email}: ${r.link}`]);
                });
              }}
            >
              <div>
                <Label htmlFor="inv-email">{t('onboarding.inviteEmail')}</Label>
                <Input id="inv-email" name="email" type="email" required />
              </div>
              <div>
                <Label htmlFor="inv-role">{t('onboarding.inviteRole')}</Label>
                <Select id="inv-role" name="role" defaultValue="approver">
                  {ROLES.filter((r) => r !== 'owner').map((r) => (
                    <option key={r} value={r}>
                      {t(`settings.role.${r}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="secondary" disabled={busy}>
                {t('onboarding.inviteSend')}
              </Button>
            </form>
            {inviteLinks.map((l) => (
              <CopyField key={l} className="mt-2" label="invitation" value={l} />
            ))}
          </Card>
          <DependencyCard busy={busy} run={run} handle={deps} />
          {/* Leaving the step saves any dependency the owner typed but did not save yet. */}
          <Nav
            onNext={() => run(async () => { await deps.current?.saveDrafts(); await go('sources'); })}
            onBack={() => run(async () => { await deps.current?.saveDrafts(); await go('organization'); })}
            busy={busy}
          />
        </div>
      )}

      {step === 'sources' && (
        <div className="mt-5 space-y-5">
          <Card>
            <p className="text-[15px] text-ink-secondary">{t('onboarding.sourcesBody')}</p>
            <div className="mt-4">
              <AddDeviceDialog />
            </div>
            <ul className="mt-5 space-y-2">
              {state.integrations.map((i) => (
                <li key={i.id} className="rounded-[12px] border border-border-subtle px-3 py-2.5">
                  <p className="font-medium">{i.name}</p>
                  <div className="mt-1">
                    <CapabilityBadges i={i} />
                  </div>
                </li>
              ))}
            </ul>
            <Link href="/workspace/records" className="mt-3 inline-flex min-h-11 items-center text-[15px] font-medium text-brand-action-hover underline underline-offset-4">
              {t('workspace.title')}
            </Link>
          </Card>
          <Nav onNext={() => run(() => go('automation'))} onBack={back} busy={busy} />
        </div>
      )}

      {step === 'automation' && (
        <Card className="mt-5">
          <p className="text-[18px] font-medium">{t('onboarding.automationQuestion')}</p>
          <p className="mt-3 text-[15px] leading-relaxed">{t('onboarding.automationScope', { threshold: 20, seconds: 120, daily: 100, rate: 1, minutes: 30 })}</p>
          <p className="mt-2 text-[15px] text-ink-secondary">{t('onboarding.automationImpact')}</p>
          <p className="mt-2 text-[15px] text-ink-secondary">{t('onboarding.automationNotIncluded')}</p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await apiSend('/api/v1/policy', 'PATCH', { autoThrottleEnabled: true, throttleRatePerMinute: 1, throttleDurationMinutes: 30, burstThreshold: 20, burstWindowSeconds: 120, dailyLimit: 100, expectedVersion: state.policyVersion ?? 1 });
                  await go('notifications');
                })
              }
            >
              {t('onboarding.automationAccept')}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(() => go('notifications'))}>
              {t('onboarding.automationDecline')}
            </Button>
          </div>
          {back && <BackButton onBack={back} busy={busy} className="mt-5" />}
        </Card>
      )}

      {step === 'notifications' && (
        <div className="mt-5 space-y-5">
          <Card>
            <p className="text-[15px] text-ink-secondary">{t('onboarding.notificationsBody')}</p>
            {!telegramConfigured ? (
              <Notice tone="neutral" className="mt-4">
                {t('onboarding.telegramUnavailable')}
              </Notice>
            ) : (
              <div className="mt-4">
                <Button variant="secondary" disabled={busy} onClick={() => run(async () => setTgLink(await apiSend<TelegramLinkDTO>('/api/v1/telegram/link', 'POST')))}>
                  {t('settings.telegramLink')}
                </Button>
                {tgLink && (
                  <div className="mt-3">
                    {tgLink.deepLink && (
                      <Button asChild>
                        <a href={tgLink.deepLink} target="_blank" rel="noopener noreferrer">
                          {t('settings.telegramOpenLink')}
                        </a>
                      </Button>
                    )}
                    <p className="mt-2 font-mono text-[16px]">{t('settings.telegramCode', { code: tgLink.code })}</p>
                  </div>
                )}
              </div>
            )}
          </Card>
          <Nav onNext={() => run(() => go('review'))} onBack={back} busy={busy} />
        </div>
      )}

      {step === 'review' && state.coverage && (
        <Card className="mt-5">
          <ul className="space-y-2 text-[16px] tabular">
            <li>{t('overview.devicesLine', { fresh: state.coverage.devices.fresh, stale: state.coverage.devices.stale, offline: state.coverage.devices.offline, total: state.coverage.devices.total })}</li>
            <li>{t('overview.appsLine', { enforceable: state.coverage.applications.enforceable, readOnly: state.coverage.applications.readOnly, unconnected: state.coverage.applications.unconnected })}</li>
            <li>{t('overview.unknownDeps', { count: state.coverage.unknownDependencies })}</li>
          </ul>
          {!state.coverage.hasAnySource && <Notice tone="neutral" className="mt-4">{t('overview.noSourcesBody')}</Notice>}
          <Hint className="mt-4">{t('onboarding.coverageExplain')}</Hint>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
            {back && <BackButton onBack={back} busy={busy} />}
            <Button size="lg" disabled={busy} onClick={() => run(() => go('done'))}>
              {t('onboarding.finish')}
            </Button>
          </div>
          <p className="sr-only">{time(new Date().toISOString())}</p>
        </Card>
      )}
      <FieldError id="onb-err">{null}</FieldError>
    </div>
  );
}

function Nav({ onNext, onBack, busy }: { onNext: () => void; onBack?: () => void; busy: boolean }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {onBack ? <BackButton onBack={onBack} busy={busy} /> : <span />}
      <Button size="lg" onClick={onNext} disabled={busy}>
        {t('common.continue')}
      </Button>
    </div>
  );
}

function BackButton({ onBack, busy, className }: { onBack: () => void; busy: boolean; className?: string }) {
  const { t } = useI18n();
  return (
    <Button type="button" size="lg" variant="secondary" onClick={onBack} disabled={busy} className={className}>
      ← {t('common.back')}
    </Button>
  );
}

