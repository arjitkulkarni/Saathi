import Link from 'next/link';
import type { ReactNode } from 'react';
import { AlertTriangle, CloudOff, Info, Lock, SearchX, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/primitives';

export function PageHeader({ title, description, actions, meta, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && <div className="mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.01em] text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 text-[16px] leading-relaxed text-ink-secondary">{description}</p>}
        {meta && <div className="mt-2 text-[14px] text-ink-secondary tabular">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ title, body, action, icon }: { title: ReactNode; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-border-control/60 bg-canvas-warm px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex justify-center text-ink-secondary">{icon}</div>}
      <p className="text-[17px] font-semibold text-ink">{title}</p>
      {body && <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-ink-secondary">{body}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({ tone = 'info', title, children, className, role }: { tone?: 'info' | 'warning' | 'danger' | 'neutral' | 'success'; title?: ReactNode; children?: ReactNode; className?: string; role?: 'status' | 'alert' }) {
  const styles = {
    info: 'border-focus/20 bg-[#eef2f8] text-ink',
    warning: 'border-warning-ink/25 bg-warning-soft text-ink',
    danger: 'border-danger-ink/25 bg-danger-soft text-ink',
    neutral: 'border-border-subtle bg-neutral-soft text-ink',
    success: 'border-success-ink/25 bg-success-soft text-ink',
  }[tone];
  const Icon = tone === 'danger' ? XCircle : tone === 'warning' ? AlertTriangle : Info;
  const iconColor = tone === 'danger' ? 'text-danger-ink' : tone === 'warning' ? 'text-warning-ink' : tone === 'success' ? 'text-success-ink' : 'text-focus';
  return (
    <div role={role} className={cn('flex gap-3 rounded-[14px] border px-4 py-3', styles, className)}>
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', iconColor)} />
      <div className="min-w-0 text-[15px] leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-ink')}>{children}</div>}
      </div>
    </div>
  );
}

export type StateCode = 'FORBIDDEN' | 'NOT_FOUND' | 'DEPENDENCY_UNAVAILABLE' | 'INTERNAL';

/** Full-page authorization / not-found / unavailable states with a safe return route. */
export function StateScreen({ code, t, backHref = '/app/overview' }: { code: StateCode; t: (k: string) => string; backHref?: string }) {
  const map = {
    FORBIDDEN: { icon: Lock, title: t('states.forbiddenTitle'), body: t('states.forbiddenBody') },
    NOT_FOUND: { icon: SearchX, title: t('states.notFoundTitle'), body: t('states.notFoundBody') },
    DEPENDENCY_UNAVAILABLE: { icon: CloudOff, title: t('states.unavailableTitle'), body: t('states.unavailableBody') },
    INTERNAL: { icon: AlertTriangle, title: t('states.errorTitle'), body: t('states.errorBody') },
  }[code];
  const Icon = map.icon;
  return (
    <div className="mx-auto max-w-xl py-16 text-center" role={code === 'INTERNAL' || code === 'DEPENDENCY_UNAVAILABLE' ? 'alert' : undefined}>
      <Icon aria-hidden className="mx-auto size-10 text-ink-secondary" />
      <h1 className="mt-4 text-[24px] font-semibold text-ink">{map.title}</h1>
      <p className="mt-2 text-[16px] leading-relaxed text-ink-secondary">{map.body}</p>
      <Link href={backHref} className={cn(buttonVariants({ variant: 'secondary' }), 'mt-6')}>
        {t('states.returnSafe')}
      </Link>
    </div>
  );
}

export function TechnicalDetails({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="group rounded-[12px] border border-border-subtle bg-canvas-warm">
      <summary className="flex min-h-11 items-center justify-between gap-2 px-4 text-[14px] font-medium text-ink-secondary hover:text-ink">
        {summary}
        <span aria-hidden className="text-ink-secondary transition-transform group-open:rotate-90">›</span>
      </summary>
      <div className="border-t border-border-subtle px-4 py-3 text-[14px]">{children}</div>
    </details>
  );
}

export function KeyValue({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[180px_1fr] sm:gap-3">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className={cn('min-w-0 break-words text-ink', mono && 'font-mono text-[13px] [overflow-wrap:anywhere]')}>{children}</dd>
    </div>
  );
}
