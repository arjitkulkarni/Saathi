import { msg, type ActionOption, type ActionParams, type ActionType, type Msg } from '@saathi/contracts';

// Scenario decision popup (frontend spec: scenario-based incident popups). Pure mapping from
// an incident's rule and its already-computed ActionOption[] (packages/domain preview.ts
// recommendOptions — the single authoritative source of what is actually executable) to the
// modal's structured response list. This module invents no new capability and no new
// evidence: an option is only ever `available` when recommendOptions already produced a
// matching ActionOption, so approval (createPreview/approvePreview) accepts exactly what the
// modal offered. Non-executing responses (monitor, review, manual acknowledgement) never touch
// the action/preview machinery at all.

export type ScenarioKey = 'unresolved_malware' | 'protection_disabled' | 'password_guessing' | 'generic';
export type ScenarioResponseKind = 'device_action' | 'device_action_combo' | 'manual' | 'monitor' | 'review';
export type ScenarioAvailability = 'available' | 'manual' | 'unavailable';

export type ScenarioDeviceActionSpec = { actionType: ActionType; targetType: 'device'; targetId: string; params: ActionParams };

export type ScenarioOption = {
  key: string;
  kind: ScenarioResponseKind;
  availability: ScenarioAvailability;
  unavailableReason: Msg | null;
  label: Msg;
  benefit: Msg | null;
  consequences: Msg[];
  scope: Msg | null;
  /** null when reversibility is not applicable (e.g. a review/monitor response). */
  reversible: boolean | null;
  recommended: boolean;
  /** One entry for a single device action, two for an ordered combo ("restore, then scan"); empty for non-device responses. */
  actionSpecs: ScenarioDeviceActionSpec[];
};

export type ScenarioPrompt = { scenarioKey: ScenarioKey; message: Msg; options: ScenarioOption[] };

function findOpt(options: ActionOption[], actionType: ActionType): ActionOption | null {
  return options.find((o) => o.actionType === actionType) ?? null;
}

function deviceOption(args: {
  key: string;
  opt: ActionOption | null;
  label: string;
  benefit: string;
  consequences: string[];
  scope: string;
  reversible: boolean;
  forceNotRecommended?: boolean;
}): ScenarioOption {
  return {
    key: args.key,
    kind: 'device_action',
    availability: args.opt ? 'available' : 'unavailable',
    unavailableReason: args.opt ? null : msg('scenario.unavailable.no_capability'),
    label: msg(args.label),
    benefit: msg(args.benefit),
    consequences: args.consequences.map((c) => msg(c)),
    scope: msg(args.scope),
    reversible: args.reversible,
    recommended: !args.forceNotRecommended && !!args.opt?.recommended,
    actionSpecs: args.opt ? [{ actionType: args.opt.actionType, targetType: 'device', targetId: args.opt.targetId, params: args.opt.params }] : [],
  };
}

function manualOption(args: { key: string; label: string; benefit: string; consequences: string[]; scope: string }): ScenarioOption {
  return {
    key: args.key,
    kind: 'manual',
    availability: 'manual',
    unavailableReason: null,
    label: msg(args.label),
    benefit: msg(args.benefit),
    consequences: args.consequences.map((c) => msg(c)),
    scope: msg(args.scope),
    reversible: true,
    // Never guessed: would require explicit evidence of active spreading/encryption that this
    // system does not currently collect. Recommending it from absence would invent evidence.
    recommended: false,
    actionSpecs: [],
  };
}

function reviewOption(key: string, benefit: string, consequences: string[]): ScenarioOption {
  return {
    key,
    kind: 'review',
    availability: 'available',
    unavailableReason: null,
    label: msg('scenario.option.review.label'),
    benefit: msg(benefit),
    consequences: consequences.map((c) => msg(c)),
    scope: null,
    reversible: null,
    recommended: false,
    actionSpecs: [],
  };
}

function monitorOption(key: string, consequence: string): ScenarioOption {
  return {
    key,
    kind: 'monitor',
    availability: 'available',
    unavailableReason: null,
    label: msg('scenario.option.monitor.label'),
    benefit: null,
    consequences: [msg(consequence)],
    scope: null,
    reversible: null,
    recommended: false,
    actionSpecs: [],
  };
}

function unresolvedMalware(options: ActionOption[]): ScenarioPrompt {
  return {
    scenarioKey: 'unresolved_malware',
    message: msg('scenario.message.unresolved_malware'),
    options: [
      deviceOption({
        key: 'scan',
        opt: findOpt(options, 'device.request_av_scan'),
        label: 'scenario.option.scan.label',
        benefit: 'scenario.option.scan.benefit',
        consequences: ['scenario.option.scan.consequence_slow', 'scenario.option.scan.consequence_no_proof'],
        scope: 'scenario.scope.this_device',
        reversible: true,
      }),
      manualOption({
        key: 'disconnect',
        label: 'scenario.option.disconnect.label',
        benefit: 'scenario.option.disconnect.benefit',
        consequences: ['scenario.option.disconnect.consequence_work', 'scenario.option.disconnect.consequence_local', 'scenario.option.disconnect.consequence_contact'],
        scope: 'scenario.scope.this_device',
      }),
      reviewOption('review', 'scenario.option.review_malware.benefit', ['scenario.option.review.consequence_followup', 'scenario.option.review_malware.consequence_no_containment']),
      monitorOption('monitor', 'scenario.option.monitor_malware.consequence'),
    ],
  };
}

function protectionDisabled(options: ActionOption[]): ScenarioPrompt {
  const restore = findOpt(options, 'device.enable_av') ?? findOpt(options, 'device.enable_firewall');
  const scan = findOpt(options, 'device.request_av_scan');
  const restoreType = restore?.actionType ?? null;
  return {
    scenarioKey: 'protection_disabled',
    message: msg('scenario.message.protection_disabled'),
    options: [
      deviceOption({
        key: 'restore',
        opt: restore,
        label: 'scenario.option.restore.label',
        benefit: 'scenario.option.restore.benefit',
        consequences: ['scenario.option.restore.consequence_block', 'scenario.option.restore.consequence_policy'],
        scope: 'scenario.scope.this_device',
        reversible: true,
      }),
      // Combo: restore, then scan — two ordered device actions. Only available when both
      // underlying actions are individually available; approval applies them in order and
      // reports each outcome separately rather than claiming one combined success.
      {
        key: 'restore_then_scan',
        kind: 'device_action_combo',
        availability: restore && scan ? 'available' : 'unavailable',
        unavailableReason: restore && scan ? null : msg('scenario.unavailable.no_capability'),
        label: msg('scenario.option.restore_then_scan.label'),
        benefit: msg('scenario.option.restore_then_scan.benefit'),
        consequences: [msg('scenario.option.restore_then_scan.consequence_slow')],
        scope: msg('scenario.scope.this_device'),
        reversible: true,
        recommended: false,
        actionSpecs:
          restore && scan && restoreType
            ? [
                { actionType: restoreType, targetType: 'device', targetId: restore.targetId, params: restore.params },
                { actionType: 'device.request_av_scan', targetType: 'device', targetId: scan.targetId, params: scan.params },
              ]
            : [],
      },
      reviewOption('review', 'scenario.option.review_protection.benefit', ['scenario.option.review.consequence_followup', 'scenario.option.review_protection.consequence_no_change']),
      monitorOption('defer', 'scenario.option.defer_protection.consequence'),
    ],
  };
}

function passwordGuessing(options: ActionOption[]): ScenarioPrompt {
  return {
    scenarioKey: 'password_guessing',
    message: msg('scenario.message.password_guessing'),
    options: [
      deviceOption({
        key: 'block_source',
        opt: findOpt(options, 'device.block_source_ip'),
        label: 'scenario.option.block_source.label',
        benefit: 'scenario.option.block_source.benefit',
        consequences: ['scenario.option.block_source.consequence_shared', 'scenario.option.block_source.consequence_other_sources'],
        scope: 'scenario.scope.one_address',
        reversible: true,
      }),
      deviceOption({
        key: 'lockout',
        opt: findOpt(options, 'device.set_lockout_policy'),
        label: 'scenario.option.lockout.label',
        benefit: 'scenario.option.lockout.benefit',
        consequences: ['scenario.option.lockout.consequence_legit', 'scenario.option.lockout.consequence_deliberate'],
        scope: 'scenario.scope.covered_accounts',
        reversible: true,
      }),
      deviceOption({
        key: 'disable_account',
        opt: findOpt(options, 'device.disable_local_account'),
        label: 'scenario.option.disable_account.label',
        benefit: 'scenario.option.disable_account.benefit',
        consequences: ['scenario.option.disable_account.consequence_disrupt', 'scenario.option.disable_account.consequence_sessions'],
        scope: 'scenario.scope.one_account',
        reversible: true,
      }),
      {
        key: 'verify_owner',
        kind: 'monitor',
        availability: 'available',
        unavailableReason: null,
        label: msg('scenario.option.verify_owner.label'),
        benefit: msg('scenario.option.verify_owner.benefit'),
        consequences: [msg('scenario.option.verify_owner.consequence')],
        scope: null,
        reversible: null,
        recommended: false,
        actionSpecs: [],
      },
    ],
  };
}

/** Unfamiliar incident types: use whatever the server already computed, never a guessed action. */
function generic(options: ActionOption[]): ScenarioPrompt {
  const deviceOpts = options.filter((o) => o.targetType === 'device');
  return {
    scenarioKey: 'generic',
    message: msg('scenario.message.generic'),
    options: [
      ...deviceOpts.map((o, i) =>
        deviceOption({
          key: `option_${i}`,
          opt: o,
          label: `action.title.${o.actionType.replace('.', '_')}`,
          benefit: 'scenario.option.generic.benefit',
          consequences: ['scenario.option.generic.consequence'],
          scope: 'scenario.scope.this_device',
          reversible: true,
        }),
      ),
      reviewOption('review', 'scenario.option.review_generic.benefit', ['scenario.option.review.consequence_followup']),
      monitorOption('monitor', 'scenario.option.monitor_generic.consequence'),
    ],
  };
}

export function buildScenarioPrompt(ruleId: string, options: ActionOption[]): ScenarioPrompt {
  if (ruleId === 'unresolved_malware') return unresolvedMalware(options);
  if (ruleId === 'protection_disabled') return protectionDisabled(options);
  if (ruleId === 'password_guessing') return passwordGuessing(options);
  return generic(options);
}

/** True when a finding exists now that was not part of the decided set — the prompt should reopen. */
export function decisionNeedsReopen(currentOpenFindingIds: string[], decidedFindingIds: string[] | null): boolean {
  if (!decidedFindingIds) return true;
  const decided = new Set(decidedFindingIds);
  return currentOpenFindingIds.some((id) => !decided.has(id));
}
