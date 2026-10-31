'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Ban, CheckCircle2, CircleHelp, Hourglass, Pause, Play, RotateCcw, Undo2 } from 'lucide-react';
import { StatusBadge } from '@/components/shared/status';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n-client';
import { Illustrative, Window } from './examples';

// One incident, start to finish (skills.md §1 central journey), as a short walkthrough.
// Plays once when it scrolls into view, never loops, and can be paused or stepped through.
// With reduced motion it does not autoplay. Every frame is a labelled illustration.

const FRAMES = ['observe', 'limit', 'explain', 'preview', 'approve', 'verify', 'preserve'] as const;
type Frame = (typeof FRAMES)[number];
const FRAME_MS = 3600;

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export function JourneyPlayer() {
  const { t } = useI18n();
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [done, setDone] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  // Start once, when at least half of the player is visible.
  useEffect(() => {
    const el = root.current;
    if (!el || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const io = new IntersectionObserver(
      ([en]) => {
        if (en.isIntersecting && !started.current) {
          started.current = true;
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      if (frame >= FRAMES.length - 1) {
        setPlaying(false);
        setDone(true);
      } else setFrame((f) => f + 1);
    }, FRAME_MS);
    return () => window.clearTimeout(id);
  }, [playing, frame]);

  const select = (i: number) => {
    started.current = true;
    setPlaying(false);
    setDone(i === FRAMES.length - 1);
    setFrame(i);
  };
  const toggle = () => {
    started.current = true;
    if (done) {
      setFrame(0);
      setDone(false);
      setPlaying(true);
    } else setPlaying((p) => !p);
  };
  const key = FRAMES[frame];

  return (
    <div ref={root} role="region" aria-label={t('pitch.player.label')} className="mx-auto max-w-[1160px] rounded-[22px] bg-canvas-warm px-4 py-6 sm:px-8 sm:py-10">
      {/* Step rail */}
      <ol className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {FRAMES.map((f, i) => (
          <li key={f}>
            <button
              type="button"
              onClick={() => select(i)}
              aria-current={i === frame ? 'step' : undefined}
              aria-label={`${i + 1}. ${t(`pitch.player.steps.${f}.label`)}`}
              data-saathi-interactive=""
              className="group flex min-h-11 w-full flex-col items-stretch justify-center gap-1.5 rounded-[10px] px-0.5 text-left"
            >
              <span className="relative block h-1.5 overflow-hidden rounded-full bg-border-subtle">
                {i < frame && <span className="absolute inset-0 bg-ink" />}
                {i === frame && (
                  <span
                    key={`${f}-${playing}`}
                    className={cn('absolute inset-0 bg-brand-action', playing ? 'saathi-progress' : '')}
                    style={{ ['--saathi-frame' as string]: `${FRAME_MS}ms` } as CSSProperties}
                  />
                )}
              </span>
              <span className={cn('hidden truncate text-[13px] font-medium md:block', i === frame ? 'text-brand-action-hover' : 'text-ink-secondary group-hover:text-ink')}>
                {t(`pitch.player.steps.${f}.label`)}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-6 grid items-center gap-6 md:mt-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
        <div key={`text-${key}`} className="saathi-fade min-h-[11rem]">
          <p className="text-[14px] font-medium text-ink-secondary tabular">{t('pitch.player.stepOf', { current: frame + 1, total: FRAMES.length })}</p>
          <p className="mt-2 text-[14px] font-semibold uppercase tracking-wide text-brand-action-hover">{t(`pitch.player.steps.${key}.label`)}</p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-[26px] leading-[1.2] text-ink sm:text-[30px]">{t(`pitch.player.steps.${key}.title`)}</h3>
          <p className="mt-3 text-[16px] leading-relaxed text-ink-secondary sm:text-[17px]">{t(`pitch.player.steps.${key}.body`)}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggle}
              data-saathi-interactive=""
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border-control/60 bg-surface px-4 text-[15px] font-medium text-ink hover:bg-surface-subtle"
            >
              {done ? <RotateCcw aria-hidden className="size-4" /> : playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
              {done ? t('pitch.player.replay') : playing ? t('pitch.player.pause') : t('pitch.player.play')}
            </button>
          </div>
        </div>
        {/* Reserve the tallest frame so the page below never jumps while it plays. */}
        <div className="min-h-[24.5rem] sm:min-h-[24rem]">
          <Window>
            <div key={`frame-${key}`} className="saathi-fade">
              <Illustrative />
              <div className="mt-3">
                <FrameVisual frame={key} />
              </div>
            </div>
          </Window>
        </div>
      </div>
      <p className="mt-5 text-center text-[13.5px] text-ink-secondary">{t('pitch.player.note')}</p>
    </div>
  );
}

function SessionRow({ tone, label, value, className, style }: { tone: 'danger' | 'neutral' | 'success'; label: string; value?: string; className?: string; style?: CSSProperties }) {
  const dot = { danger: 'bg-danger-ink', neutral: 'bg-border-control', success: 'bg-success-ink' }[tone];
  return (
    <div className={cn('flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle px-3 py-2 text-[14.5px]', className)} style={style}>
      <span className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />
        <span className="truncate">{label}</span>
      </span>
      {value && <span className="shrink-0 font-medium text-danger-ink tabular">{value}</span>}
    </div>
  );
}

function Panel({ icon, title, tone, children, style }: { icon: ReactNode; title: string; tone: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div className="saathi-fade rounded-[12px] border border-border-subtle p-3" style={style}>
      <p className={cn('flex items-center gap-2 text-[14px] font-semibold', tone)}>
        {icon}
        {title}
      </p>
      <div className="mt-1 text-[14.5px] text-ink">{children}</div>
    </div>
  );
}

function FrameVisual({ frame }: { frame: Frame }) {
  const { t } = useI18n();
  const m = (k: string) => t(`pitch.player.mock.${k}`);

  if (frame === 'observe') {
    const bars = [2, 1, 3, 2, 1, 2, 3, 2, 19, 23];
    return (
      <div>
        <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-secondary">{m('perMinute')}</p>
        <div aria-hidden className="mt-3 flex h-28 items-end gap-1.5 border-b border-border-subtle pb-px">
          {bars.map((h, i) => (
            <span key={i} className={cn('saathi-bar flex-1 rounded-t-[4px]', h > 10 ? 'bg-danger-ink/85' : 'bg-border-control/50')} style={{ height: `${(h / 23) * 100}%`, ...delay(i * 70) }} />
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          <SessionRow tone="danger" label={m('unfamiliar')} value={m('requested')} className="saathi-fade" style={delay(800)} />
          <SessionRow tone="neutral" label={m('familiar')} className="saathi-fade" style={delay(950)} />
        </div>
      </div>
    );
  }

  if (frame === 'limit') {
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="warning" label={m('limitTitle')} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-[18px] font-semibold text-ink">
          <Hourglass aria-hidden className="size-5 text-warning-ink" />
          {m('limitRate')}
        </p>
        <div aria-hidden className="mt-4 h-2.5 overflow-hidden rounded-full bg-warning-soft">
          <span className="saathi-countdown block h-full rounded-full bg-warning-ink/70" />
        </div>
        <p className="mt-2 text-[14.5px] text-ink-secondary">{m('limitEnds')}</p>
        <p className="saathi-fade mt-4 flex items-center gap-2 rounded-[10px] bg-surface-subtle px-3 py-2 text-[14.5px] text-ink" style={delay(500)}>
          <CheckCircle2 aria-hidden className="size-4 text-success-ink" />
          {m('limitConsent')}
        </p>
      </div>
    );
  }

  if (frame === 'explain') {
    return (
      <div>
        <StatusBadge tone="danger" label={t('status.urgency.needs_attention')} />
        <p className="mt-3 text-[18px] font-semibold leading-snug text-ink">{t('landing.stageTitle')}</p>
        <p className="saathi-fade mt-3 text-[13px] font-semibold uppercase tracking-wide text-ink-secondary" style={delay(200)}>
          {t('landing.exampleWhatHappened')}
        </p>
        <p className="saathi-fade text-[15px]" style={delay(200)}>
          {t('landing.stageFact')}
        </p>
        <p className="saathi-fade mt-3 rounded-[10px] bg-warning-soft px-3 py-2 text-[15px]" style={delay(500)}>
          {t('landing.stageUncertain')}
        </p>
        <p className="saathi-fade mt-3 flex items-center gap-2 text-[14.5px] text-ink-secondary" style={delay(800)}>
          <Hourglass aria-hidden className="size-4" />
          {t('landing.stageLimited')}
        </p>
      </div>
    );
  }

  if (frame === 'preview') {
    return (
      <div className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <Panel icon={<Ban aria-hidden className="size-4" />} title={m('stops')} tone="text-danger-ink">
            {m('unfamiliar')}
          </Panel>
          <Panel icon={<CheckCircle2 aria-hidden className="size-4" />} title={m('keeps')} tone="text-success-ink" style={delay(250)}>
            {m('familiar')}
          </Panel>
        </div>
        <Panel icon={<CircleHelp aria-hidden className="size-4" />} title={m('unknown')} tone="text-ink" style={delay(500)}>
          {m('unknownItem')}
        </Panel>
        <p className="saathi-fade flex items-center gap-2 px-1 text-[14px] text-ink-secondary" style={delay(750)}>
          <Undo2 aria-hidden className="size-4" />
          {m('undo')}
        </p>
      </div>
    );
  }

  if (frame === 'approve') {
    return (
      <div>
        <p className="text-[18px] font-semibold text-ink">{t('landing.decideHeading')}</p>
        <span aria-hidden className="mt-4 inline-flex min-h-11 items-center rounded-[11px] bg-brand-action px-4 text-[15px] font-medium text-white shadow-[var(--shadow-rest)]">
          {m('approveButton')}
        </span>
        <p className="saathi-fade mt-4 flex items-center gap-2 text-[15px] text-ink" style={delay(700)}>
          <CheckCircle2 aria-hidden className="saathi-check size-4 text-success-ink" style={delay(700)} />
          {m('approved')}
        </p>
        <p className="saathi-fade mt-2 flex items-center gap-2 text-[15px] text-ink" style={delay(1100)}>
          <CheckCircle2 aria-hidden className="saathi-check size-4 text-success-ink" style={delay(1100)} />
          {m('rechecked')}
        </p>
      </div>
    );
  }

  if (frame === 'verify') {
    return (
      <div>
        <StatusBadge tone="success" label={t('status.action.confirmed')} />
        <div className="mt-3 grid gap-2">
          <Panel icon={<Ban aria-hidden className="saathi-check size-4" style={delay(300)} />} title={m('stopped')} tone="text-success-ink" style={delay(300)}>
            <span className="text-ink-secondary">403 · session_paused</span>
          </Panel>
          <Panel icon={<CheckCircle2 aria-hidden className="saathi-check size-4" style={delay(650)} />} title={m('permitted')} tone="text-success-ink" style={delay(650)}>
            <span className="text-ink-secondary">200 · granted</span>
          </Panel>
        </div>
        <p className="saathi-fade mt-3 text-[14px] text-ink-secondary tabular" style={delay(900)}>
          {m('checkedAt')}
        </p>
      </div>
    );
  }

  const entries = [
    { n: 127, k: 'entry1', h: '9f2c41…a07e' },
    { n: 128, k: 'entry2', h: '3b8d0e…51c2' },
    { n: 129, k: 'entry3', h: 'c47a19…e3d0' },
    { n: 130, k: 'entry4', h: '06e5bb…7f19' },
  ];
  return (
    <div>
      <ol className="grid gap-1.5">
        {entries.map((e, i) => (
          <li key={e.n} className="saathi-fade flex items-center justify-between gap-3 rounded-[10px] border border-border-subtle px-3 py-2 text-[14.5px]" style={delay(i * 220)}>
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[13px] text-ink-secondary tabular">#{e.n}</span>
              <span className="truncate">{m(e.k)}</span>
            </span>
            <span aria-hidden className="hidden shrink-0 font-mono text-[12.5px] text-ink-secondary sm:inline">
              {e.h}
            </span>
          </li>
        ))}
      </ol>
      <div className="saathi-fade mt-3 flex flex-col gap-2" style={delay(1000)}>
        <StatusBadge tone="success" label={m('integrity')} />
        <StatusBadge tone="info" pending label={m('timestamp')} />
      </div>
    </div>
  );
}
