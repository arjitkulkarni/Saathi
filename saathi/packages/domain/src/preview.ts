import {
  isDeviceAction,
  msg,
  type ActionOption,
  type ActionParams,
  type ActionType,
  type Capability,
  type Consequence,
  type Decision,
  type Finding,
  type Msg,
  type PreviewContent,
  type RecoveryRequirement,
  type Snapshot,
  type SnapshotDevice,
} from '@saathi/contracts';
import { canonicalBytes, sha256Hex } from '@saathi/evidence';
import { authorize, isRestrictionActive } from './authorize';

// Consequence engine (build.md Ph07). Pure: snapshot in, prediction out. Stored previews
// are the only thing approval acts on; the browser never recomputes consequences.

export type ActionSpec = { actionType: ActionType; targetType: 'session' | 'subject' | 'device'; targetId: string; params: ActionParams };
export type Objective = { capability: string; targetType: 'session' | 'subject' | 'device'; targetId: string } | null;

export const PREVIEW_TTL_SECONDS = 10 * 60;
const RECORD_CAPABILITIES: Capability[] = ['records.view', 'records.download'];

/** Subject that a records action targets (session target → its owner). */
export function targetSubjectId(s: Snapshot, spec: ActionSpec): string | null {
  if (spec.targetType === 'subject') return spec.targetId;
  if (spec.targetType === 'session') return s.sessions.find((x) => x.id === spec.targetId)?.subjectId ?? null;
  return null;
}

/** Guard rows an approval must lock (build.md Ph04.4 / Ph08.2). */
export function guardKeysFor(s: Snapshot, spec: ActionSpec): string[] {
  if (isDeviceAction(spec.actionType)) return [`device:${spec.targetId}`];
  const subject = targetSubjectId(s, spec);
  return subject ? [`subject:${subject}`] : [];
}

/** Pure state transition used by preview, property tests and enforcement checks. */
export function applyActionToSnapshot(s: Snapshot, spec: ActionSpec, at: string): Snapshot {
  const next: Snapshot = structuredClone(s);
  switch (spec.actionType) {
    case 'records.pause_session':
      next.restrictions.push({ id: `pending:${spec.targetId}:pause`, targetType: 'session', targetId: spec.targetId, kind: 'pause', ratePerMinute: null, expiresAt: null, source: 'action' });
      break;
    case 'records.disable_account':
      next.restrictions.push({ id: `pending:${spec.targetId}:disable`, targetType: 'subject', targetId: spec.targetId, kind: 'disable_account', ratePerMinute: null, expiresAt: null, source: 'action' });
      break;
    case 'records.offboard_subject': {
      const subj = next.subjects.find((x) => x.id === spec.targetId);
      if (subj) subj.status = 'offboarded';
      for (const sess of next.sessions) if (sess.subjectId === spec.targetId) sess.status = 'revoked';
      break;
    }
    default:
      // Device actions change the device, not records authorization.
      break;
  }
  void at;
  return next;
}

/**
 * Hash of the state relevant to this action. Approval recomputes it under guard locks;
 * a mismatch means the situation changed (409 STALE_PREVIEW). State of unrelated people
 * is excluded, so an unrelated new session does not invalidate a narrow preview.
 */
export function relevantStateHash(s: Snapshot, spec: ActionSpec, at: string): string {
  if (isDeviceAction(spec.actionType)) {
    const d = s.devices.find((x) => x.id === spec.targetId);
    return sha256Hex(
      canonicalBytes({
        v: 1,
        actionType: spec.actionType,
        params: spec.params,
        device: d ? { id: d.id, supported: [...d.supportedActions].sort(), accounts: d.accounts.map((a) => [a.sid, a.isAdmin, a.enabled, a.protected]).sort(), posture: d.posture ?? null } : null,
      }),
    );
  }
  const subjectId = targetSubjectId(s, spec);
  const subject = s.subjects.find((x) => x.id === subjectId);
  const sessions = s.sessions.filter((x) => x.subjectId === subjectId).map((x) => [x.id, x.status, x.integrationId]).sort();
  const sessionIds = new Set(s.sessions.filter((x) => x.subjectId === subjectId).map((x) => x.id));
  const restrictions = s.restrictions
    .filter((r) => isRestrictionActive(r, at) && ((r.targetType === 'subject' && r.targetId === subjectId) || (r.targetType === 'session' && sessionIds.has(r.targetId))))
    .map((r) => [r.id, r.kind, r.targetId, r.ratePerMinute ?? 0])
    .sort();
  const grants = s.grants.filter((g) => g.subjectId === subjectId).map((g) => [g.integrationId, g.capability]).sort();
  const integrationIds = new Set(s.sessions.filter((x) => x.subjectId === subjectId).map((x) => x.integrationId));
  const integrations = s.integrations.filter((i) => integrationIds.has(i.id)).map((i) => [i.id, i.status, i.canEnforce]).sort();
  const deps = s.dependencies.filter((d) => subjectId && d.subjectIds.includes(subjectId)).map((d) => [d.id, d.confidence]).sort();
  return sha256Hex(
    canonicalBytes({
      v: 1,
      policyVersion: s.policyVersion,
      actionType: spec.actionType,
      targetId: spec.targetId,
      params: spec.params,
      subject: subject ? [subject.id, subject.status, subject.sharedAccount] : null,
      sessions,
      restrictions,
      grants,
      integrations,
      deps,
    }),
  );
}

function sessionCapabilityRequests(s: Snapshot) {
  const out: { sessionId: string; subjectId: string; capability: Capability }[] = [];
  for (const sess of s.sessions) {
    const caps = s.grants.filter((g) => g.subjectId === sess.subjectId && g.integrationId === sess.integrationId).map((g) => g.capability);
    for (const c of RECORD_CAPABILITIES) if (caps.includes(c)) out.push({ sessionId: sess.id, subjectId: sess.subjectId, capability: c });
  }
  return out;
}

const ACTION_TITLES: Record<ActionType, string> = {
  'records.pause_session': 'preview.title.pause_session',
  'records.disable_account': 'preview.title.disable_account',
  'records.offboard_subject': 'preview.title.offboard_subject',
  'device.lock_session': 'preview.title.lock_session',
  'device.disable_local_account': 'preview.title.disable_local_account',
  'device.restrict_removable_storage': 'preview.title.restrict_removable_storage',
  'device.enable_firewall': 'preview.title.enable_firewall',
  'device.set_lockout_policy': 'preview.title.set_lockout_policy',
  'device.block_source_ip': 'preview.title.block_source_ip',
  'device.enable_av': 'preview.title.enable_av',
  'device.request_av_scan': 'preview.title.request_av_scan',
  'device.undo_change': 'preview.title.undo_change',
};

function coverageFor(s: Snapshot, relevantIntegrationIds: Set<string>, at: string) {
  const gaps: Msg[] = [];
  for (const i of s.integrations) {
    if (i.kind === 'device_agent') continue;
    if (!i.canEnforce || !['connected'].includes(i.status)) gaps.push(msg(i.canObserve ? 'coverage.gap.read_only_app' : 'coverage.gap.unconnected_app', { name: i.name }));
  }
  const scope = s.integrations.filter((i) => relevantIntegrationIds.has(i.id)).map((i) => i.name);
  return { scope, observedAt: s.observedAt ?? at, completeForScope: s.integrations.filter((i) => relevantIntegrationIds.has(i.id)).every((i) => i.canEnforce && i.status === 'connected'), gaps };
}

function recordsPreview(s: Snapshot, spec: ActionSpec, objective: Objective, at: string): PreviewContent {
  const next = applyActionToSnapshot(s, spec, at);
  const subjectId = targetSubjectId(s, spec);
  const subject = s.subjects.find((x) => x.id === subjectId);
  const stops: Consequence[] = [];
  const limits: Consequence[] = [];
  const keepsWorking: Consequence[] = [];
  let othersUnchanged = 0;
  let othersChanged = false;
  const otherSubjects = new Set<string>();

  for (const r of sessionCapabilityRequests(s)) {
    const req = { sessionId: r.sessionId, capability: r.capability, at };
    const before = authorize(s, req).decision;
    const after = authorize(next, req).decision;
    const sess = s.sessions.find((x) => x.id === r.sessionId)!;
    const person = s.subjects.find((x) => x.id === r.subjectId);
    const isTargetSubject = r.subjectId === subjectId;
    if (!isTargetSubject && before === after) {
      if (before !== 'deny') {
        othersUnchanged++;
        otherSubjects.add(r.subjectId);
      }
      continue;
    }
    if (!isTargetSubject) othersChanged = true;
    const c: Consequence = {
      capability: r.capability,
      subjectId: r.subjectId,
      sessionId: r.sessionId,
      label: msg(`consequence.${r.capability.replace('.', '_')}`, { session: sess.label, person: person?.label ?? '' }),
      before,
      after,
      unchanged: before === after,
    };
    classify(c, before, after, stops, limits, keepsWorking);
  }
  if (othersUnchanged > 0) {
    keepsWorking.push({
      capability: 'records.*',
      subjectId: null,
      sessionId: null,
      label: msg('consequence.other_people_unchanged', { people: otherSubjects.size, sessions: othersUnchanged }),
      before: 'allow',
      after: 'allow',
      unchanged: true,
    });
  }
  if (othersChanged) throw new Error('invariant violated: action changed authorization outside its target scope');

  const unknown: Msg[] = [];
  const relevantIntegrations = new Set(s.sessions.filter((x) => x.subjectId === subjectId).map((x) => x.integrationId));
  const coverage = coverageFor(s, relevantIntegrations, at);
  if (coverage.gaps.length > 0) unknown.push(msg('unknown.unconnected_apps'));
  unknown.push(...coverage.gaps);
  if (subject?.sharedAccount) unknown.push(msg('unknown.shared_account', { person: subject.label }));
  for (const d of s.dependencies) {
    if (subjectId && d.subjectIds.includes(subjectId)) unknown.push(msg('unknown.declared_dependency', { description: d.description, confidence: d.confidence }));
  }

  const cannotControl: Msg[] = [msg('cannot.records_already_downloaded'), msg('cannot.copies_outside_app')];
  const undo: RecoveryRequirement[] = [];
  if (spec.actionType === 'records.pause_session') {
    undo.push({ step: msg('undo.verify_person'), approver: 'owner' }, { step: msg('undo.fresh_session_old_stays_revoked'), approver: 'owner' });
  } else if (spec.actionType === 'records.disable_account') {
    cannotControl.push(msg('cannot.connector_semantics_reference'));
    undo.push({ step: msg('undo.verify_person'), approver: 'owner' }, { step: msg('undo.reenable_account_review_grants'), approver: 'owner' }, { step: msg('undo.fresh_session_old_stays_revoked'), approver: 'owner' });
  } else {
    undo.push({ step: msg('undo.restore_person_new_workflow'), approver: 'owner' });
  }

  let objectiveMet = true;
  if (objective) {
    const sessions = objective.targetType === 'session' ? [objective.targetId] : s.sessions.filter((x) => x.subjectId === objective.targetId).map((x) => x.id);
    objectiveMet = sessions.every((sid) => authorize(next, { sessionId: sid, capability: objective.capability as Capability, at }).decision === 'deny');
  }

  const targetLabel =
    spec.targetType === 'session'
      ? msg('target.session', { session: s.sessions.find((x) => x.id === spec.targetId)?.label ?? spec.targetId, person: subject?.label ?? '' })
      : msg('target.person', { person: subject?.label ?? spec.targetId });

  return {
    actionType: spec.actionType,
    targetType: spec.targetType,
    targetId: spec.targetId,
    targetLabel,
    params: spec.params,
    title: msg(ACTION_TITLES[spec.actionType]),
    stops,
    limits,
    keepsWorking,
    unknown,
    cannotControl,
    undo,
    reversible: true,
    objectiveMet,
    supported: !!subject && relevantIntegrations.size > 0,
    unsupportedReason: subject ? null : msg('unsupported.target_missing'),
    coverage,
    predictionBasis: 'modeled_policy',
  };
}

function classify(c: Consequence, before: Decision, after: Decision, stops: Consequence[], limits: Consequence[], keeps: Consequence[]) {
  if (after === 'deny' && before !== 'deny') stops.push(c);
  else if (after === 'deny' && before === 'deny') stops.push({ ...c, unchanged: true });
  else if (after === 'throttle') limits.push({ ...c, unchanged: before === 'throttle' });
  else if (after === 'allow' && before === 'allow') keeps.push(c);
  else keeps.push(c);
}

// ------------------------------------------------------------------ device actions

/** Protected identities that the agent and preview refuse to disable (build.md Ph09). */
export function protectedAccountReason(device: SnapshotDevice, sid: string): string | null {
  const acct = device.accounts.find((a) => a.sid === sid);
  if (!acct) return 'unsupported.account_not_observed';
  if (acct.protected) return 'unsupported.protected_identity';
  const enabledAdmins = device.accounts.filter((a) => a.isAdmin && a.enabled);
  if (acct.isAdmin && acct.enabled && enabledAdmins.length <= 1) return 'unsupported.last_enabled_admin';
  return null;
}

type DeviceEffect = { stops: string[]; limits: string[]; keeps: string[]; unknown: string[]; cannot: string[]; undo: string[]; capability: string };

const DEVICE_EFFECTS: Record<string, DeviceEffect> = {
  'device.lock_session': {
    capability: 'device.interactive_use',
    stops: ['consequence.device.interactive_use_until_unlock'],
    limits: [],
    keeps: ['consequence.device.background_processes_continue'],
    unknown: ['unknown.device.unsaved_work'],
    cannot: ['cannot.lock_not_termination', 'cannot.lock_not_password_guessing'],
    undo: ['undo.user_unlocks'],
  },
  'device.disable_local_account': {
    capability: 'device.local_login',
    stops: ['consequence.device.new_logins_for_account'],
    limits: [],
    keeps: ['consequence.device.other_accounts_unchanged'],
    unknown: ['unknown.device.existing_sessions_assessed_separately', 'unknown.device.services_using_account'],
    cannot: ['cannot.account_disable_not_logout'],
    undo: ['undo.reenable_local_account'],
  },
  'device.restrict_removable_storage': {
    capability: 'device.removable_storage',
    stops: ['consequence.device.new_removable_disks'],
    limits: [],
    keeps: ['consequence.device.keyboard_mouse_unchanged'],
    unknown: ['unknown.device.unsupported_storage_classes'],
    cannot: ['cannot.already_mounted_storage'],
    undo: ['undo.restore_prior_storage_policy'],
  },
  'device.enable_firewall': {
    capability: 'device.network_inbound',
    stops: [],
    limits: ['consequence.device.unsolicited_inbound'],
    keeps: ['consequence.device.outbound_unchanged'],
    unknown: ['unknown.device.apps_needing_inbound'],
    cannot: ['cannot.firewall_not_all_connections', 'cannot.managed_policy_may_block'],
    undo: ['undo.restore_prior_firewall'],
  },
  'device.set_lockout_policy': {
    capability: 'device.local_login',
    stops: [],
    limits: ['consequence.device.repeated_wrong_passwords'],
    keeps: ['consequence.device.correct_password_works'],
    unknown: ['unknown.device.staff_may_be_locked_out'],
    cannot: ['cannot.lockout_remote_guessing_elsewhere'],
    undo: ['undo.restore_prior_lockout'],
  },
  'device.block_source_ip': {
    capability: 'device.network_inbound',
    stops: ['consequence.device.inbound_from_address'],
    limits: [],
    keeps: ['consequence.device.other_addresses_unchanged'],
    unknown: ['unknown.device.address_may_change'],
    cannot: ['cannot.rule_existence_not_proof'],
    undo: ['undo.remove_rule'],
  },
  'device.enable_av': {
    capability: 'device.realtime_protection',
    stops: [],
    limits: [],
    keeps: ['consequence.device.normal_use_continues'],
    unknown: [],
    cannot: ['cannot.managed_policy_may_block', 'cannot.av_not_all_threats'],
    undo: ['undo.restore_prior_av'],
  },
  'device.request_av_scan': {
    capability: 'device.malware_scan',
    stops: [],
    limits: [],
    keeps: ['consequence.device.normal_use_continues_slower'],
    unknown: [],
    cannot: ['cannot.scan_not_eradication'],
    undo: ['undo.none_needed'],
  },
  'device.undo_change': {
    capability: 'device.policy',
    stops: [],
    limits: [],
    keeps: ['consequence.device.restores_prior_state'],
    unknown: ['unknown.device.later_admin_changes'],
    cannot: ['cannot.undo_only_if_still_owned'],
    undo: ['undo.reapply_via_new_preview'],
  },
};

function devicePreview(s: Snapshot, spec: ActionSpec, at: string): PreviewContent {
  const d = s.devices.find((x) => x.id === spec.targetId);
  const e = DEVICE_EFFECTS[spec.actionType];
  const mk = (key: string): Consequence => ({ capability: e.capability, subjectId: null, sessionId: null, label: msg(key, { device: d?.name ?? '' }), before: 'unknown', after: 'unknown', unchanged: false });
  let supported = !!d && d.supportedActions.includes(spec.actionType);
  let unsupportedReason: Msg | null = !d ? msg('unsupported.target_missing') : supported ? null : msg('unsupported.device_capability', { device: d.name });
  if (d && supported && spec.actionType === 'device.disable_local_account') {
    const reason = protectedAccountReason(d, String(spec.params.sid ?? ''));
    if (reason) {
      supported = false;
      unsupportedReason = msg(reason);
    }
  }
  const unknown: Msg[] = e.unknown.map((k) => msg(k));
  if (d && d.freshness !== 'fresh') unknown.unshift(msg('unknown.device.stale_snapshot', { device: d.name, lastSeen: d.lastSeenAt ?? '' }));
  if (d?.simulated) unknown.unshift(msg('unknown.device.simulated'));
  return {
    actionType: spec.actionType,
    targetType: 'device',
    targetId: spec.targetId,
    targetLabel: msg('target.device', { device: d?.name ?? spec.targetId }),
    params: spec.params,
    title: msg(ACTION_TITLES[spec.actionType]),
    stops: e.stops.map(mk).map((c) => ({ ...c, before: 'allow', after: 'deny' })),
    limits: e.limits.map(mk).map((c) => ({ ...c, before: 'allow', after: 'throttle' })),
    keepsWorking: e.keeps.map(mk).map((c) => ({ ...c, before: 'allow', after: 'allow', unchanged: true })),
    unknown,
    cannotControl: e.cannot.map((k) => msg(k)),
    undo: e.undo.map((k) => ({ step: msg(k), approver: 'owner' as const })),
    reversible: spec.actionType !== 'device.request_av_scan',
    objectiveMet: true,
    supported,
    unsupportedReason,
    coverage: { scope: d ? [d.name] : [], observedAt: d?.lastSeenAt ?? at, completeForScope: !!d && d.freshness === 'fresh' && !d.simulated, gaps: [] },
    predictionBasis: 'observed_device_snapshot',
  };
}

export function computePreview(s: Snapshot, spec: ActionSpec, objective: Objective, at: string): PreviewContent {
  return isDeviceAction(spec.actionType) ? devicePreview(s, spec, at) : recordsPreview(s, spec, objective, at);
}

// ------------------------------------------------------------------ recommendation

/**
 * Supported options for the incident's findings, least disruptive first. The first option
 * that meets the objective is recommended; if none can, no recommendation is made.
 */
export function recommendOptions(s: Snapshot, findings: Finding[], at: string): { options: ActionOption[]; noSupportedOption: Msg | null } {
  const options: ActionOption[] = [];
  const open = findings.filter((f) => f.status === 'open');
  const push = (o: Omit<ActionOption, 'recommended'>) => {
    if (!options.some((x) => x.actionType === o.actionType && x.targetId === o.targetId && JSON.stringify(x.params) === JSON.stringify(o.params))) options.push({ ...o, recommended: false });
  };
  for (const f of open) {
    if (f.target.type === 'session') {
      const sess = s.sessions.find((x) => x.id === f.target.id);
      if (!sess || sess.status === 'revoked') continue;
      push({ actionType: 'records.pause_session', targetType: 'session', targetId: sess.id, params: {}, reason: msg('option.reason.pause_session') });
      push({ actionType: 'records.disable_account', targetType: 'subject', targetId: sess.subjectId, params: {}, reason: msg('option.reason.disable_account') });
    } else if (f.target.type === 'device') {
      const d = s.devices.find((x) => x.id === f.target.id);
      if (!d) continue;
      const add = (actionType: ActionType, params: ActionParams, reason: string) => {
        if (d.supportedActions.includes(actionType)) push({ actionType, targetType: 'device', targetId: d.id, params, reason: msg(reason) });
      };
      const facts = Object.fromEntries(f.facts.flatMap((m) => Object.entries(m.params)));
      switch (f.ruleId) {
        case 'password_guessing':
          if (typeof facts.sourceAddress === 'string' && facts.sourceAddress) add('device.block_source_ip', { address: facts.sourceAddress, direction: 'inbound' }, 'option.reason.block_source_ip');
          add('device.set_lockout_policy', { threshold: 5, durationMinutes: 15 }, 'option.reason.set_lockout_policy');
          break;
        case 'possible_compromise':
          if (typeof facts.sid === 'string' && facts.sid && !protectedAccountReason(d, facts.sid)) add('device.disable_local_account', { sid: facts.sid }, 'option.reason.disable_local_account');
          add('device.lock_session', {}, 'option.reason.lock_session');
          break;
        case 'removable_media':
          add('device.restrict_removable_storage', { scope: 'new_removable_disks' }, 'option.reason.restrict_removable_storage');
          break;
        case 'unresolved_malware':
          add('device.request_av_scan', { scanType: 'quick' }, 'option.reason.request_av_scan');
          add('device.enable_av', { component: 'realtime' }, 'option.reason.enable_av');
          break;
        case 'protection_disabled':
          if (facts.component === 'firewall') add('device.enable_firewall', { profile: 'All' }, 'option.reason.enable_firewall');
          else add('device.enable_av', { component: 'realtime' }, 'option.reason.enable_av');
          break;
      }
    }
  }
  // Recommend the first option meeting its finding's objective (records options are
  // ordered narrow → broad; device options per rule priority).
  for (const o of options) {
    const finding = open.find((f) => (f.target.type === 'session' && o.targetType !== 'device') || (f.target.type === 'device' && f.target.id === o.targetId));
    const objective: Objective = finding && finding.target.type === 'session' ? { capability: finding.harmfulCapability, targetType: 'session', targetId: finding.target.id } : null;
    const p = computePreview(s, { actionType: o.actionType, targetType: o.targetType, targetId: o.targetId, params: o.params }, objective, at);
    if (p.supported && p.objectiveMet && !(finding?.ruleId === 'possible_compromise')) {
      o.recommended = true;
      break;
    }
  }
  let noSupportedOption: Msg | null = null;
  if (open.length === 0) noSupportedOption = msg('option.none.no_open_findings');
  else if (options.length === 0) noSupportedOption = msg('option.none.unsupported');
  else if (!options.some((o) => o.recommended)) noSupportedOption = msg('option.none.review_first');
  return { options, noSupportedOption };
}

/** Postconditions the probe must observe for the action to be `confirmed`. */
export function expectedPostconditions(s: Snapshot, spec: ActionSpec, at: string): { kind: string; sessionId?: string; capability?: string; expected: Decision }[] {
  if (isDeviceAction(spec.actionType)) return [{ kind: 'device_postcondition', expected: 'deny' }];
  const subjectId = targetSubjectId(s, spec);
  const next = applyActionToSnapshot(s, spec, at);
  const out: { kind: string; sessionId?: string; capability?: string; expected: Decision }[] = [];
  const targetSessions = spec.targetType === 'session' ? [spec.targetId] : s.sessions.filter((x) => x.subjectId === subjectId && x.status !== 'revoked').map((x) => x.id);
  for (const sid of targetSessions) out.push({ kind: 'target_denied', sessionId: sid, capability: 'records.download', expected: 'deny' });
  if (spec.targetType === 'session') {
    for (const other of s.sessions.filter((x) => x.subjectId === subjectId && x.id !== spec.targetId && x.status !== 'revoked')) {
      // The other session keeps whatever the policy predicts (allow, or an existing throttle).
      // Sessions that already had no access are not "keeps working" evidence, so skip them.
      const predicted = authorize(next, { sessionId: other.id, capability: 'records.download', at }).decision;
      if (predicted === 'deny') continue;
      out.push({ kind: 'unaffected_permitted', sessionId: other.id, capability: 'records.download', expected: predicted });
    }
  }
  return out;
}
