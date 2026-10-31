import { AlertTriangle, CheckCircle2, CircleDashed, Clock, Info, MinusCircle, ShieldCheck, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ActionState, AnchorState, CheckResult, ContainmentStatus, EvidenceState, Freshness, IncidentState, ScamVerdict, Urgency } from '@saathi/contracts';
import { cn } from '@/lib/cn';

// Status always carries a word and an icon in addition to color (frontend.md §3.1, §9).
// Green is reserved for observed outcomes; coral is never a severity signal.

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info';

const TONE: Record<Tone, string> = {
  success: 'bg-success-soft text-success-ink border-success-ink/20',
  warning: 'bg-warning-soft text-warning-ink border-warning-ink/20',
  danger: 'bg-danger-soft text-danger-ink border-danger-ink/20',
  neutral: 'bg-neutral-soft text-neutral-ink border-neutral-ink/20',
  info: 'bg-[#eef2f8] text-focus border-focus/20',
};

const ICON: Record<Tone, typeof CheckCircle2> = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, neutral: CircleDashed, info: Info };

export function StatusBadge({ tone, label, icon, className, pending }: { tone: Tone; label: ReactNode; icon?: typeof CheckCircle2; className?: string; pending?: boolean }) {
  const Icon = pending ? Clock : (icon ?? ICON[tone]);
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[13px] font-medium leading-6', TONE[tone], className)}>
      <Icon aria-hidden className={cn('size-4 shrink-0', pending && 'saathi-pending')} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}

export const actionTone = (s: ActionState): Tone => (s === 'confirmed' ? 'success' : s === 'failed' ? 'danger' : s === 'partial' ? 'warning' : s === 'unknown' ? 'warning' : s === 'expired' || s === 'cancelled' ? 'neutral' : 'info');
export const actionPending = (s: ActionState) => s === 'requested' || s === 'queued' || s === 'executing';
export const incidentTone = (s: IncidentState): Tone => (s === 'recovered' ? 'success' : s === 'contained' || s === 'recovering' ? 'info' : s === 'dismissed' ? 'neutral' : 'warning');
export const containmentTone = (s: ContainmentStatus): Tone => (s === 'contained' ? 'success' : s === 'partially_contained' ? 'warning' : s === 'unknown' ? 'neutral' : 'danger');
export const urgencyTone = (u: Urgency): Tone => (u === 'needs_attention' ? 'danger' : u === 'review_today' ? 'warning' : 'neutral');
export const anchorTone = (s: AnchorState): Tone => (s === 'confirmed' ? 'success' : s === 'invalid' || s === 'failed' ? 'danger' : s === 'retrying' ? 'warning' : s === 'not_requested' ? 'neutral' : 'info');
export const evidenceTone = (s: EvidenceState | 'none'): Tone => (s === 'signing_failed' ? 'danger' : s === 'pending_signature' ? 'info' : 'neutral');
export const checkTone = (r: CheckResult): Tone => (r === 'pass' ? 'success' : r === 'fail' ? 'danger' : 'neutral');
export const freshnessTone = (f: Freshness): Tone => (f === 'fresh' ? 'success' : f === 'stale' ? 'warning' : 'neutral');
// "No known indicators" is deliberately neutral — never a green "safe" (frontend.md §7).
export const verdictTone = (v: ScamVerdict): Tone => (v === 'known_malicious' ? 'danger' : v === 'suspicious' ? 'warning' : 'neutral');

export { ShieldCheck, MinusCircle };
