'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Dialog } from 'radix-ui';
import { Menu, X } from 'lucide-react';
import type { Locale } from '@saathi/contracts';
import { Wordmark } from '@/components/brand/wordmark';
import { buttonVariants } from '@/components/ui/primitives';
import { apiSend } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';

const LANGS: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'kn', label: 'ಕನ್ನಡ' },
  { code: 'hi', label: 'हिन्दी' },
];

export function LanguageSelect({ id, className }: { id: string; className?: string }) {
  const { t, locale } = useI18n();
  const router = useRouter();
  return (
    <span className={cn('inline-flex items-center', className)}>
      <label htmlFor={id} className="sr-only">
        {t('common.language')}
      </label>
      <select
        id={id}
        value={locale}
        onChange={async (e) => {
          await apiSend('/api/v1/me/preferences', 'PATCH', { locale: e.target.value });
          router.refresh();
        }}
        className="min-h-11 rounded-[10px] border border-border-subtle bg-canvas px-2 text-[14px] text-ink hover:bg-surface-subtle"
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export function LandingHeader({ signedIn }: { signedIn: boolean }) {
  const { t } = useI18n();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const links = [
    { href: '#journey', label: t('pitch.nav.journey') },
    { href: '#how-it-works', label: t('landing.navHow') },
    { href: '#built', label: t('pitch.nav.built') },
    { href: '#trust', label: t('landing.navTrust') },
  ];
  const cta = signedIn ? { href: '/app', label: t('common.openSaathi') } : { href: '/login', label: t('common.signIn') };
  return (
    <header className={cn('sticky top-0 z-40 bg-canvas transition-[border-color] duration-150', scrolled ? 'border-b border-border-subtle' : 'border-b border-transparent')}>
      <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-2 px-3 sm:gap-4 sm:px-6 md:h-[72px]">
        <Link href="/" aria-label="Saathi home" className="shrink-0">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {links.map((l) => (
              <li key={l.href}>
                <a href={l.href} data-saathi-interactive="" className="inline-flex min-h-11 items-center rounded-[10px] px-3 text-[15px] text-ink hover:bg-surface-subtle">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-1 sm:gap-2 lg:ml-0">
          <LanguageSelect id="lang-header" className="hidden sm:inline-flex" />
          <Link href={cta.href} className={cn(buttonVariants({ variant: signedIn ? 'primary' : 'secondary', size: 'sm' }), 'hidden rounded-full px-3 min-[360px]:inline-flex sm:px-4')}>
            {cta.label}
          </Link>
          <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2.5 text-[15px] text-ink hover:bg-surface-subtle lg:hidden" aria-label={t('common.menu')}>
                <Menu aria-hidden className="size-5" />
                <span className="hidden min-[360px]:inline">{t('common.menu')}</span>
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/30" />
              <Dialog.Content className="saathi-fade fixed inset-x-0 top-0 z-50 rounded-b-[20px] bg-canvas p-5 shadow-[var(--shadow-raised)]">
                <div className="flex items-center justify-between">
                  <Dialog.Title className="sr-only">{t('common.menu')}</Dialog.Title>
                  <Wordmark />
                  <Dialog.Close className="inline-flex size-11 items-center justify-center rounded-[10px] hover:bg-surface-subtle" aria-label={t('common.close')}>
                    <X aria-hidden className="size-5" />
                  </Dialog.Close>
                </div>
                <Dialog.Description className="sr-only">{t('common.menu')}</Dialog.Description>
                <ul className="mt-4 grid gap-1">
                  {links.map((l) => (
                    <li key={l.href}>
                      <a href={l.href} onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-[10px] px-3 text-[17px] hover:bg-surface-subtle">
                        {l.label}
                      </a>
                    </li>
                  ))}
                  <li>
                    <Link href="/verify" onClick={() => setOpen(false)} className="flex min-h-12 items-center rounded-[10px] px-3 text-[17px] hover:bg-surface-subtle">
                      {t('verify.title')}
                    </Link>
                  </li>
                </ul>
                <div className="mt-4 flex items-center justify-between gap-3">
                  <LanguageSelect id="lang-sheet" />
                  <Link href={signedIn ? '/app' : '/login'} className={cn(buttonVariants({ size: 'pill' }))}>
                    {t('landing.ctaPrimary')}
                  </Link>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}
