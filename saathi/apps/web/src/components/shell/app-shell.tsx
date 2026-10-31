'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { DropdownMenu, Dialog } from 'radix-ui';
import {
  Activity,
  BarChart3,
  Building2,
  ChevronDown,
  FileCheck2,
  FileText,
  HeartPulse,
  Languages,
  LayoutDashboard,
  Menu,
  MessageCircleQuestion,
  Monitor,
  Plug,
  Settings,
  ShieldAlert,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import type { ActorDTO, CoverageSummaryDTO, Locale } from '@saathi/contracts';
import { Wordmark } from '@/components/brand/wordmark';
import { OfflineBanner } from '@/components/shared/client';
import { apiSend } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';
import { authClient } from '@/lib/auth-client';

export type NavKey = 'overview' | 'incidents' | 'ask' | 'devices' | 'people' | 'health' | 'evidence' | 'reports' | 'integrations' | 'settings';

const NAV: { key: NavKey; href: string; icon: typeof Activity; group: 'groupWork' | 'groupOrganization' | 'groupManage' }[] = [
  { key: 'overview', href: '/app/overview', icon: LayoutDashboard, group: 'groupWork' },
  { key: 'incidents', href: '/app/incidents', icon: ShieldAlert, group: 'groupWork' },
  { key: 'ask', href: '/app/ask', icon: MessageCircleQuestion, group: 'groupWork' },
  { key: 'devices', href: '/app/devices', icon: Monitor, group: 'groupOrganization' },
  { key: 'people', href: '/app/people', icon: Users, group: 'groupOrganization' },
  { key: 'health', href: '/app/health', icon: HeartPulse, group: 'groupOrganization' },
  { key: 'evidence', href: '/app/evidence', icon: FileCheck2, group: 'groupManage' },
  { key: 'reports', href: '/app/reports', icon: FileText, group: 'groupManage' },
  { key: 'integrations', href: '/app/integrations', icon: Plug, group: 'groupManage' },
  { key: 'settings', href: '/app/settings', icon: Settings, group: 'groupManage' },
];

const LANGS: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'hi', label: 'हिन्दी' },
];

export function AppShell({ actor, visible, coverage, children }: { actor: ActorDTO; visible: NavKey[]; coverage: CoverageSummaryDTO; children: ReactNode }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const items = NAV.filter((n) => visible.includes(n.key));
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const mobilePrimary = (['overview', 'incidents', 'ask'] as NavKey[]).filter((k) => visible.includes(k));
  const mobileRest = items.filter((i) => !mobilePrimary.includes(i.key));

  const switchOrg = async (orgId: string) => {
    await apiSend('/api/v1/session/org', 'POST', { orgId });
    // Clear all client caches by a full navigation: no cross-organization data survives.
    window.location.assign('/app');
  };
  const setLocale = async (locale: Locale) => {
    await apiSend('/api/v1/me/preferences', 'PATCH', { locale });
    router.refresh();
  };

  const coverageText = coverage.hasAnySource
    ? t('nav.coverageLink', { fresh: coverage.devices.fresh, total: coverage.devices.total, apps: coverage.applications.enforceable })
    : t('nav.noCoverage');

  const navList = (onNavigate?: () => void) => (
    <nav aria-label={t('common.menu')}>
      {(['groupWork', 'groupOrganization', 'groupManage'] as const).map((g) => {
        const group = items.filter((i) => i.group === g);
        if (!group.length) return null;
        return (
          <div key={g} className="mb-5">
            <p className="mb-1.5 px-3 text-[12px] font-medium uppercase tracking-[0.06em] text-ink-secondary">{t(`nav.${g}`)}</p>
            <ul className="space-y-0.5">
              {group.map((i) => {
                const active = isActive(i.href);
                const Icon = i.icon;
                return (
                  <li key={i.key}>
                    <Link
                      href={i.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      data-saathi-interactive=""
                      className={cn(
                        'relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px]',
                        active ? 'bg-brand-soft font-semibold text-brand-action-hover' : 'text-ink hover:bg-surface-subtle',
                      )}
                    >
                      {active && <span aria-hidden className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-brand-action" />}
                      <Icon aria-hidden className="size-[19px]" />
                      {t(`nav.${i.key}`)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-canvas-warm">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-[10px] focus:bg-surface focus:px-4 focus:py-2 focus:shadow-[var(--shadow-raised)]">
        {t('common.skipToContent')}
      </a>
      <OfflineBanner />
      {actor.isDemo && (
        <div className="border-b border-border-subtle bg-ink px-4 py-1.5 text-center text-[13px] font-medium tracking-wide text-white" role="note">
          {t('common.demoBadge')} · {t('common.synthetic')}
        </div>
      )}
      <div className="flex">
        <aside className="sticky top-0 hidden h-dvh w-[244px] shrink-0 flex-col border-r border-border-subtle bg-canvas-warm px-3 py-5 lg:flex">
          <Link href="/app" className="mb-6 px-3" aria-label="Saathi">
            <Wordmark />
          </Link>
          <div className="min-h-0 flex-1 overflow-y-auto">{navList()}</div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border-subtle bg-canvas-warm/95 px-3 backdrop-blur-sm sm:px-6">
            <Link href="/app" className="mr-1 lg:hidden" aria-label="Saathi">
              <Wordmark />
            </Link>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button data-saathi-interactive="" className="flex min-h-11 min-w-0 items-center gap-2 rounded-[10px] px-2 text-[15px] font-medium text-ink hover:bg-surface-subtle" aria-label={t('nav.switchOrg')}>
                  <Building2 aria-hidden className="hidden size-[18px] text-ink-secondary sm:block" />
                  <span className="max-w-[9rem] truncate sm:max-w-[16rem]">{actor.orgName}</span>
                  <ChevronDown aria-hidden className="size-4 text-ink-secondary" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content align="start" sideOffset={6} className="saathi-fade z-50 min-w-60 rounded-[12px] border border-border-subtle bg-surface p-1.5 shadow-[var(--shadow-raised)]">
                  <DropdownMenu.Label className="px-2.5 py-1.5 text-[12px] font-medium uppercase tracking-wide text-ink-secondary">{t('nav.switchOrg')}</DropdownMenu.Label>
                  {actor.memberships.map((m) => (
                    <DropdownMenu.Item key={m.orgId} onSelect={() => m.orgId !== actor.orgId && switchOrg(m.orgId)} className="flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2.5 text-[15px] outline-none data-[highlighted]:bg-surface-subtle">
                      <span className={cn(m.orgId === actor.orgId && 'font-semibold')}>{m.orgName}</span>
                      <span className="text-[13px] text-ink-secondary">{t(`settings.role.${m.role}`)}</span>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
            <Link
              href="/app/integrations"
              className="ml-1 hidden min-h-11 items-center gap-2 rounded-[10px] px-2 text-[13.5px] text-ink-secondary hover:bg-surface-subtle hover:text-ink md:flex"
              data-saathi-interactive=""
            >
              <span aria-hidden className={cn('size-2 rounded-full', coverage.hasAnySource ? (coverage.devices.stale + coverage.devices.offline > 0 ? 'bg-warning-ink' : 'bg-success-ink') : 'bg-neutral-ink')} />
              <span className="tabular">{coverageText}</span>
            </Link>
            <div className="ml-auto flex items-center gap-1">
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button data-saathi-interactive="" className="flex min-h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] text-ink hover:bg-surface-subtle" aria-label={t('common.language')}>
                    <Languages aria-hidden className="size-[18px]" />
                    <span className="hidden sm:inline">{LANGS.find((l) => l.code === actor.locale)?.label}</span>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={6} className="saathi-fade z-50 min-w-44 rounded-[12px] border border-border-subtle bg-surface p-1.5 shadow-[var(--shadow-raised)]">
                    {LANGS.map((l) => (
                      <DropdownMenu.Item key={l.code} lang={l.code} onSelect={() => setLocale(l.code)} className="flex min-h-11 cursor-pointer items-center rounded-[8px] px-2.5 text-[15px] outline-none data-[highlighted]:bg-surface-subtle">
                        <span className={cn(l.code === actor.locale && 'font-semibold')}>{l.label}</span>
                      </DropdownMenu.Item>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button data-saathi-interactive="" className="flex min-h-11 items-center gap-2 rounded-[10px] px-2.5 text-[14px] text-ink hover:bg-surface-subtle" aria-label={t('common.profile')}>
                    <UserRound aria-hidden className="size-[18px]" />
                    <span className="hidden max-w-[10rem] truncate md:inline">{actor.name}</span>
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={6} className="saathi-fade z-50 min-w-56 rounded-[12px] border border-border-subtle bg-surface p-1.5 shadow-[var(--shadow-raised)]">
                    <div className="px-2.5 py-2 text-[14px]">
                      <p className="font-semibold text-ink">{actor.name}</p>
                      <p className="text-ink-secondary">{actor.email}</p>
                      <p className="mt-1 text-ink-secondary">{t(`settings.role.${actor.role}`)}</p>
                    </div>
                    <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
                    <DropdownMenu.Item
                      onSelect={async () => {
                        await authClient.signOut();
                        window.location.assign('/login');
                      }}
                      className="flex min-h-11 cursor-pointer items-center rounded-[8px] px-2.5 text-[15px] outline-none data-[highlighted]:bg-surface-subtle"
                    >
                      {t('common.signOut')}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1180px] flex-1 px-4 pb-[calc(88px+env(safe-area-inset-bottom))] pt-6 outline-none sm:px-6 lg:px-8 lg:pb-12 lg:pt-8">
            {children}
          </main>
        </div>
      </div>

      {/* Mobile navigation: Overview, Incidents, Ask, More (flow.md §3). */}
      <nav aria-label={t('common.menu')} className="fixed inset-x-0 bottom-0 z-30 border-t border-border-subtle bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="flex">
          {mobilePrimary.map((k) => {
            const n = NAV.find((x) => x.key === k)!;
            const Icon = n.icon;
            const active = isActive(n.href);
            return (
              <li key={k} className="flex-1">
                <Link href={n.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px]', active ? 'font-semibold text-brand-action-hover' : 'text-ink-secondary')}>
                  <Icon aria-hidden className="size-5" />
                  {k === 'ask' ? t('nav.ask') : t(`nav.${k}`)}
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
              <Dialog.Trigger asChild>
                <button className="flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-[12px] text-ink-secondary" aria-label={t('common.more')}>
                  <Menu aria-hidden className="size-5" />
                  {t('common.more')}
                </button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
                <Dialog.Content className="saathi-fade fixed inset-x-0 bottom-0 z-50 max-h-[80dvh] overflow-y-auto rounded-t-[20px] bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[var(--shadow-raised)]">
                  <div className="mb-3 flex items-center justify-between">
                    <Dialog.Title className="text-[17px] font-semibold">{t('common.more')}</Dialog.Title>
                    <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-[10px] hover:bg-surface-subtle" aria-label={t('common.close')}>
                      <X aria-hidden className="size-5" />
                    </Dialog.Close>
                  </div>
                  <Dialog.Description className="sr-only">{t('common.menu')}</Dialog.Description>
                  <ul className="grid gap-1">
                    {mobileRest.map((i) => {
                      const Icon = i.icon;
                      return (
                        <li key={i.key}>
                          <Link href={i.href} onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-[16px] hover:bg-surface-subtle" aria-current={isActive(i.href) ? 'page' : undefined}>
                            <Icon aria-hidden className="size-5 text-ink-secondary" />
                            {t(`nav.${i.key}`)}
                          </Link>
                        </li>
                      );
                    })}
                    <li>
                      <Link href="/app/integrations" onClick={() => setMoreOpen(false)} className="flex min-h-12 items-center gap-3 rounded-[10px] px-3 text-[15px] text-ink-secondary hover:bg-surface-subtle">
                        <BarChart3 aria-hidden className="size-5" />
                        {coverageText}
                      </Link>
                    </li>
                  </ul>
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>
          </li>
        </ul>
      </nav>
    </div>
  );
}
