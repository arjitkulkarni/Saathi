import { msg, type Msg, type RecoveryStepKind } from '@saathi/contracts';

// Guided recovery (build.md Ph11.4–11.5, flow.md §6G, frontend.md §6.6). User-attested and
// machine-verified steps are distinct. The original session is never resumed.

export type RecoveryStepKey =
  | 'verify_person'
  | 'address_credentials'
  | 'review_findings'
  | 'revoke_old_session'
  | 'issue_fresh_session'
  | 'verify_old_token_rejected'
  | 'restore_device_policy'
  | 'verify_device_state'
  | 'finish';

export type RecoveryStep = {
  key: RecoveryStepKey;
  kind: RecoveryStepKind;
  status: 'pending' | 'done' | 'failed' | 'blocked';
  title: Msg;
  help: Msg;
  result: Msg | null;
  at: string | null;
  by: string | null;
};

const step = (key: RecoveryStepKey, kind: RecoveryStepKind): RecoveryStep => ({
  key,
  kind,
  status: 'pending',
  title: msg(`recovery.step.${key}.title`),
  help: msg(`recovery.step.${key}.help`),
  result: null,
  at: null,
  by: null,
});

export function recoveryTemplate(kind: 'records_session' | 'records_account' | 'device'): RecoveryStep[] {
  if (kind === 'device') {
    return [step('verify_person', 'attested'), step('review_findings', 'verified'), step('restore_device_policy', 'verified'), step('verify_device_state', 'verified'), step('finish', 'verified')];
  }
  return [
    step('verify_person', 'attested'),
    step('address_credentials', 'attested'),
    step('review_findings', 'verified'),
    step('revoke_old_session', 'verified'),
    step('issue_fresh_session', 'verified'),
    step('verify_old_token_rejected', 'verified'),
    step('finish', 'verified'),
  ];
}

/** A step may run only when every earlier step is done (failed steps block later ones). */
export function canRunStep(steps: RecoveryStep[], key: RecoveryStepKey): { ok: boolean; reason: Msg | null } {
  const idx = steps.findIndex((s) => s.key === key);
  if (idx < 0) return { ok: false, reason: msg('recovery.blocked.not_applicable') };
  if (steps[idx].status === 'done') return { ok: false, reason: msg('recovery.blocked.already_done') };
  const blocker = steps.slice(0, idx).find((s) => s.status !== 'done');
  if (blocker) return { ok: false, reason: msg('recovery.blocked.earlier_step', { step: blocker.key }) };
  return { ok: true, reason: null };
}
