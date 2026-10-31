'use client';

import { useId, useState, type FormEvent } from 'react';
import { Button, Card, FieldError, Hint, Input, Label } from '@/components/ui/primitives';
import { Notice } from '@/components/shared/states';
import { apiSend } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { useI18n } from '@/lib/i18n-client';

/** better-auth reports a duplicate email via this code; fall back to the stable message text
 * in case the client surfaces only one of the two. Any other error must not be reported as
 * "email already registered" — that was previously shown for every sign-up failure. */
function emailAlreadyExists(error: { code?: string; message?: string }) {
  if (error.code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' || error.code === 'USER_ALREADY_EXISTS') return true;
  return !!error.message?.toLowerCase().includes('already exist');
}

export function LoginForm({ next, invite, reauth }: { next: string | null; invite: string | null; reauth: boolean }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ids = { email: useId(), password: useId(), name: useId(), err: useId() };

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const email = String(f.get('email') ?? '').trim();
    const password = String(f.get('password') ?? '');
    try {
      const r = mode === 'signin' ? await authClient.signIn.email({ email, password }) : await authClient.signUp.email({ email, password, name: String(f.get('name') ?? '').trim() || email });
      if (r.error) {
        // A rate-limited request is not a wrong password; say so. For sign-up, only claim the
        // email is taken when the server actually said so — any other failure (validation,
        // network, misconfiguration) gets a message that doesn't misdirect the user.
        setError(r.error.status === 429 ? t('auth.rateLimited') : mode === 'signin' ? t('auth.failed') : emailAlreadyExists(r.error) ? t('auth.signupFailed') : t('auth.signupError'));
        return;
      }
      if (invite) await apiSend('/api/v1/invitations/accept', 'POST', { token: invite });
      window.location.assign(next ?? '/app');
    } catch {
      setError(mode === 'signin' ? t('auth.failed') : t('auth.signupError'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="w-full max-w-[440px] p-6 sm:p-8">
      <h1 className="text-[24px] font-semibold text-ink">{mode === 'signin' ? t('auth.title') : t('auth.createAccount')}</h1>
      <div className="mt-4 space-y-3">
        {reauth && <Notice tone="warning">{t('auth.reauth')}</Notice>}
        {invite && <Notice title={t('auth.inviteTitle')}>{t('auth.inviteBody')}</Notice>}
        {next && !reauth && <Notice tone="neutral">{t('states.sessionExpired')}</Notice>}
      </div>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate aria-describedby={error ? ids.err : undefined}>
        {mode === 'signup' && (
          <div>
            <Label htmlFor={ids.name}>{t('auth.name')}</Label>
            <Input id={ids.name} name="name" autoComplete="name" required />
          </div>
        )}
        <div>
          <Label htmlFor={ids.email}>{t('auth.email')}</Label>
          <Input id={ids.email} name="email" type="email" autoComplete="email" required aria-invalid={!!error} />
        </div>
        <div>
          <Label htmlFor={ids.password}>{t('auth.password')}</Label>
          <Input id={ids.password} name="password" type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={10} required aria-invalid={!!error} />
        </div>
        <FieldError id={ids.err}>{error}</FieldError>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? t('common.loading') : mode === 'signin' ? t('auth.submit') : t('auth.createSubmit')}
        </Button>
      </form>
      <button type="button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')} className="mt-4 min-h-11 text-[15px] font-medium text-brand-action-hover underline underline-offset-4">
        {mode === 'signin' ? t('auth.noAccount') : t('auth.haveAccount')}
      </button>
      <Hint className="mt-4">{t('auth.recovery')}</Hint>
      <details className="mt-4 rounded-[12px] bg-canvas-warm px-4 py-3 text-[14px] text-ink-secondary">
        <summary className="min-h-8 font-medium text-ink">{t('common.demoBadge')}</summary>
        <p className="mt-2 leading-relaxed">{t('auth.demoAccounts')}</p>
      </details>
    </Card>
  );
}
