import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Cog,
  Database,
  FileLock2,
  FolderLock,
  KeyRound,
  LayoutDashboard,
  MessageSquareWarning,
  Monitor,
  Send,
  ShieldCheck,
  Sparkles,
  SplitSquareHorizontal,
  FileQuestion,
  type LucideIcon,
} from 'lucide-react';
import { buttonVariants } from '@/components/ui/primitives';
import { cn } from '@/lib/cn';

// Server-rendered explanation of the complete project for first-time readers and judges:
// problem, nine-step journey, architecture, guarantees and honest prototype status.
// Every block is fully present in the HTML; motion is added by RevealOnScroll only.

type T = (key: string, params?: Record<string, unknown>) => string;
const serif = 'font-[family-name:var(--font-display)] text-ink';
const h2 = cn(serif, 'max-w-[820px] text-[30px] leading-[1.2] sm:text-[34px] md:text-[44px]');
const eyebrow = 'text-[14px] font-semibold uppercase tracking-[0.08em] text-brand-action-hover';

export function ProblemSection({ t }: { t: T }) {
  const points: { key: string; icon: LucideIcon }[] = [
    { key: 'one', icon: MessageSquareWarning },
    { key: 'two', icon: SplitSquareHorizontal },
    { key: 'three', icon: FileQuestion },
  ];
  return (
    <section id="problem" className="px-4 py-14 sm:px-6 md:py-[96px]">
      <div className="mx-auto max-w-[1160px]">
        <p className={eyebrow}>{t('pitch.problem.eyebrow')}</p>
        <h2 className={cn(h2, 'mt-3')}>{t('pitch.problem.title')}</h2>
        <ul data-reveal-stagger="" className="mt-10 grid gap-4 md:grid-cols-3">
          {points.map((p) => (
            <li key={p.key} className="rounded-[18px] border border-border-subtle bg-surface p-6">
              <p.icon aria-hidden className="size-6 text-ink-secondary" />
              <h3 className="mt-4 text-[19px] font-semibold text-ink">{t(`pitch.problem.points.${p.key}.title`)}</h3>
              <p className="mt-2 text-[16px] leading-relaxed text-ink-secondary">{t(`pitch.problem.points.${p.key}.body`)}</p>
            </li>
          ))}
        </ul>
        <p data-reveal="" className="mt-8 flex items-start gap-3 rounded-[16px] bg-brand-soft px-5 py-4 text-[17px] font-medium leading-relaxed text-ink md:text-[18px]">
          <ShieldCheck aria-hidden className="mt-0.5 size-6 shrink-0 text-brand-action" />
          {t('pitch.problem.answer')}
        </p>
      </div>
    </section>
  );
}

const PHASES = [
  { key: 'before', steps: ['connect', 'observe'] },
  { key: 'during', steps: ['explain', 'preview', 'authorize', 'act', 'verify'] },
  { key: 'after', steps: ['recover', 'preserve'] },
] as const;

// Step numbers run 1–9 across the three phases.
const OFFSETS = PHASES.map((_, i) => PHASES.slice(0, i).reduce((a, p) => a + p.steps.length, 0));

export function JourneySection({ t }: { t: T }) {
  return (
    <section id="journey" className="border-t border-border-subtle bg-canvas-warm px-4 py-14 sm:px-6 md:py-[104px]">
      <div className="mx-auto max-w-[1160px]">
        <p className={eyebrow}>{t('pitch.journey.eyebrow')}</p>
        <h2 className={cn(h2, 'mt-3')}>{t('pitch.journey.title')}</h2>
        <p className="mt-4 max-w-[700px] text-[17px] leading-relaxed text-ink-secondary">{t('pitch.journey.intro')}</p>
        <div aria-hidden className="mt-10 hidden h-1 overflow-hidden rounded-full bg-border-subtle lg:block">
          <div className="saathi-draw h-full w-full rounded-full bg-gradient-to-r from-brand-art via-brand-action to-success-ink" />
        </div>
        <div data-reveal-stagger="" className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          {PHASES.map((ph, pi) => (
            <div key={ph.key} className="rounded-[20px] border border-border-subtle bg-surface p-5 sm:p-6">
              <h3 className="text-[15px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">{t(`pitch.journey.phases.${ph.key}`)}</h3>
              <ol className={cn('mt-4 grid gap-4', ph.key === 'during' && 'sm:grid-cols-2')}>
                {ph.steps.map((s, si) => {
                  const n = OFFSETS[pi] + si + 1;
                  return (
                    <li key={s} className="flex gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-ink text-[14px] font-semibold text-white tabular">{n}</span>
                      <div className="min-w-0">
                        <p className="text-[17px] font-semibold text-ink">{t(`pitch.journey.steps.${s}.title`)}</p>
                        <p className="mt-1 text-[15px] leading-relaxed text-ink-secondary">{t(`pitch.journey.steps.${s}.body`)}</p>
                        <p className="mt-2 inline-flex rounded-[8px] bg-surface-subtle px-2.5 py-0.5 text-[12.5px] font-medium text-ink-secondary">
                          {t('pitch.journey.where', { screen: t(`pitch.journey.steps.${s}.place`) })}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const LANES: { key: string; tone: string; nodes: { key: string; icon: LucideIcon }[] }[] = [
  {
    key: 'sources',
    tone: 'border-border-subtle bg-surface',
    nodes: [
      { key: 'agent', icon: Monitor },
      { key: 'records', icon: FolderLock },
    ],
  },
  {
    key: 'server',
    tone: 'border-brand-action/30 bg-brand-soft/60',
    nodes: [
      { key: 'web', icon: LayoutDashboard },
      { key: 'worker', icon: Cog },
    ],
  },
  {
    key: 'storage',
    tone: 'border-border-subtle bg-surface',
    nodes: [
      { key: 'db', icon: Database },
      { key: 'files', icon: FileLock2 },
    ],
  },
  {
    key: 'outside',
    tone: 'border-dashed border-border-control/60 bg-canvas',
    nodes: [
      { key: 'telegram', icon: Send },
      { key: 'ai', icon: Sparkles },
      { key: 'ots', icon: Clock3 },
    ],
  },
];

function Flow() {
  return (
    <div aria-hidden className="flex items-center justify-center text-brand-action/70">
      <svg viewBox="0 0 48 16" className="hidden h-4 w-12 lg:block">
        <line x1="2" y1="8" x2="40" y2="8" stroke="currentColor" strokeWidth="2" className="saathi-flow" />
        <path d="M38 3 L46 8 L38 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <svg viewBox="0 0 16 40" className="h-9 w-4 lg:hidden">
        <line x1="8" y1="2" x2="8" y2="32" stroke="currentColor" strokeWidth="2" className="saathi-flow" />
        <path d="M3 30 L8 38 L13 30" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

export function BuiltSection({ t }: { t: T }) {
  const guarantees = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'];
  return (
    <section id="built" className="border-t border-border-subtle px-4 py-14 sm:px-6 md:py-[104px]">
      <div className="mx-auto max-w-[1200px]">
        <p className={eyebrow}>{t('pitch.built.eyebrow')}</p>
        <h2 className={cn(h2, 'mt-3')}>{t('pitch.built.title')}</h2>
        <p className="mt-4 max-w-[700px] text-[17px] leading-relaxed text-ink-secondary">{t('pitch.built.intro')}</p>

        <div data-reveal="" className="mt-10 grid items-stretch gap-2 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-3">
          {LANES.map((lane, i) => (
            <div key={lane.key} className="contents">
              {i > 0 && <Flow />}
              <div className={cn('rounded-[18px] border p-4', lane.tone)}>
                <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink-secondary">{t(`pitch.built.lanes.${lane.key}`)}</p>
                <ul className="mt-3 grid gap-2.5">
                  {lane.nodes.map((node) => (
                    <li key={node.key} className="rounded-[12px] border border-border-subtle bg-surface p-3">
                      <p className="flex items-center gap-2 text-[15.5px] font-semibold text-ink">
                        <node.icon aria-hidden className="size-4.5 shrink-0 text-brand-action" />
                        {t(`pitch.built.nodes.${node.key}.title`)}
                      </p>
                      <p className="mt-1 text-[14px] leading-relaxed text-ink-secondary">{t(`pitch.built.nodes.${node.key}.body`)}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 rounded-[22px] bg-canvas-warm p-6 sm:p-10">
          <h3 className={cn(serif, 'text-[26px] leading-[1.2] sm:text-[30px]')}>{t('pitch.built.guaranteesTitle')}</h3>
          <ul data-reveal-stagger="" className="mt-6 grid gap-3 md:grid-cols-2">
            {guarantees.map((g) => (
              <li key={g} className="flex items-start gap-3 rounded-[14px] bg-surface px-4 py-3.5 text-[15.5px] leading-relaxed text-ink">
                <ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success-ink" />
                {t(`pitch.built.guarantees.${g}`)}
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[14.5px] text-ink-secondary">{t('pitch.built.stack')}</p>
        </div>
      </div>
    </section>
  );
}

export function StatusSection({ t, primaryHref }: { t: T; primaryHref: string }) {
  const cols: { key: 'works' | 'needs' | 'next'; icon: LucideIcon; tone: string; items: string[] }[] = [
    { key: 'works', icon: CheckCircle2, tone: 'text-success-ink', items: ['i1', 'i2', 'i3', 'i4', 'i5', 'i6'] },
    { key: 'needs', icon: KeyRound, tone: 'text-warning-ink', items: ['i1', 'i2', 'i3', 'i4'] },
    { key: 'next', icon: CircleDashed, tone: 'text-ink-secondary', items: ['i1', 'i2', 'i3'] },
  ];
  const steps = ['s1', 's2', 's3', 's4', 's5'];
  return (
    <section id="status" className="border-t border-border-subtle bg-canvas-warm px-4 py-14 sm:px-6 md:py-[104px]">
      <div className="mx-auto max-w-[1160px]">
        <p className={eyebrow}>{t('pitch.status.eyebrow')}</p>
        <h2 className={cn(h2, 'mt-3')}>{t('pitch.status.title')}</h2>
        <p className="mt-4 max-w-[700px] text-[17px] leading-relaxed text-ink-secondary">{t('pitch.status.intro')}</p>
        <div data-reveal-stagger="" className="mt-10 grid gap-4 lg:grid-cols-3">
          {cols.map((c) => (
            <div key={c.key} className="rounded-[18px] border border-border-subtle bg-surface p-6">
              <h3 className="flex items-center gap-2 text-[18px] font-semibold text-ink">
                <c.icon aria-hidden className={cn('size-5', c.tone)} />
                {t(`pitch.status.${c.key}.title`)}
              </h3>
              <ul className="mt-4 grid gap-2.5">
                {c.items.map((i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[15.5px] leading-relaxed text-ink">
                    <c.icon aria-hidden className={cn('mt-1 size-4 shrink-0', c.tone)} />
                    {t(`pitch.status.${c.key}.${i}`)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div data-reveal="" className="mt-12 grid gap-8 rounded-[22px] border border-border-subtle bg-surface p-6 sm:p-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div>
            <h3 className={cn(serif, 'text-[26px] leading-[1.2] sm:text-[30px]')}>{t('pitch.tryIt.title')}</h3>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={primaryHref} className={buttonVariants({ size: 'pill' })}>
                {t('landing.ctaPrimary')}
                <ArrowRight aria-hidden className="size-4" />
              </Link>
              <Link href="/verify" className={buttonVariants({ variant: 'quiet', size: 'pill' })}>
                {t('verify.title')}
              </Link>
            </div>
            <p className="mt-4 text-[14px] text-ink-secondary">{t('pitch.tryIt.note')}</p>
          </div>
          <ol className="grid gap-3">
            {steps.map((s, i) => (
              <li key={s} className="flex items-start gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[13.5px] font-semibold text-brand-action-hover tabular">{i + 1}</span>
                <span className="pt-0.5 text-[16px] leading-relaxed text-ink">{t(`pitch.tryIt.${s}`)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

