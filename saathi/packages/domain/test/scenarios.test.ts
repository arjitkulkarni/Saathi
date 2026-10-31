import { describe, expect, it } from 'vitest';
import type { ActionOption, ActionParams } from '@saathi/contracts';
import { buildScenarioPrompt, decisionNeedsReopen } from '../src/scenarios';

const opt = (actionType: ActionOption['actionType'], params: ActionParams = {}, recommended = false): ActionOption => ({
  actionType,
  targetType: 'device',
  targetId: 'dev-1',
  params,
  recommended,
  reason: { key: 'option.reason.x', params: {} },
});

describe('unresolved_malware scenario', () => {
  it('offers the scan as available when the server computed it, and marks it recommended only when the server did', () => {
    const p = buildScenarioPrompt('unresolved_malware', [opt('device.request_av_scan', { scanType: 'quick' }, true)]);
    const scan = p.options.find((o) => o.key === 'scan')!;
    expect(scan.availability).toBe('available');
    expect(scan.recommended).toBe(true);
    expect(scan.actionSpecs).toEqual([{ actionType: 'device.request_av_scan', targetType: 'device', targetId: 'dev-1', params: { scanType: 'quick' } }]);
  });

  it('marks the scan unavailable, with a reason, when the server did not offer it', () => {
    const p = buildScenarioPrompt('unresolved_malware', []);
    const scan = p.options.find((o) => o.key === 'scan')!;
    expect(scan.availability).toBe('unavailable');
    expect(scan.unavailableReason).not.toBeNull();
    expect(scan.actionSpecs).toEqual([]);
  });

  it('always offers disconnect as a manual instruction, never recommended — no capability exists to execute it, and no evidence of spreading is modeled to recommend it from', () => {
    const p = buildScenarioPrompt('unresolved_malware', [opt('device.request_av_scan', {}, true)]);
    const disconnect = p.options.find((o) => o.key === 'disconnect')!;
    expect(disconnect.kind).toBe('manual');
    expect(disconnect.availability).toBe('manual');
    expect(disconnect.recommended).toBe(false);
    expect(disconnect.actionSpecs).toEqual([]);
  });

  it('includes a non-executing review option and a monitor option that applies no restriction', () => {
    const p = buildScenarioPrompt('unresolved_malware', []);
    const review = p.options.find((o) => o.key === 'review')!;
    const monitor = p.options.find((o) => o.key === 'monitor')!;
    expect(review.kind).toBe('review');
    expect(review.actionSpecs).toEqual([]);
    expect(monitor.kind).toBe('monitor');
    expect(monitor.actionSpecs).toEqual([]);
    expect(monitor.consequences.length).toBeGreaterThan(0);
  });

  it('uses the exact required banner message', () => {
    const p = buildScenarioPrompt('unresolved_malware', []);
    expect(p.message.key).toBe('scenario.message.unresolved_malware');
  });
});

describe('protection_disabled scenario', () => {
  it('offers restore as available when enable_av was computed', () => {
    const p = buildScenarioPrompt('protection_disabled', [opt('device.enable_av', { component: 'realtime' })]);
    expect(p.options.find((o) => o.key === 'restore')!.availability).toBe('available');
  });

  it('offers the restore-then-scan combo only when BOTH underlying actions are available', () => {
    const bothAvailable = buildScenarioPrompt('protection_disabled', [opt('device.enable_av', {}), opt('device.request_av_scan', {})]);
    const combo = bothAvailable.options.find((o) => o.key === 'restore_then_scan')!;
    expect(combo.availability).toBe('available');
    expect(combo.kind).toBe('device_action_combo');
    expect(combo.actionSpecs).toHaveLength(2);
    expect(combo.actionSpecs.map((s) => s.actionType)).toEqual(['device.enable_av', 'device.request_av_scan']);

    const onlyRestore = buildScenarioPrompt('protection_disabled', [opt('device.enable_av', {})]);
    const comboMissing = onlyRestore.options.find((o) => o.key === 'restore_then_scan')!;
    expect(comboMissing.availability).toBe('unavailable');
    expect(comboMissing.actionSpecs).toEqual([]);
  });

  it('offers a review option and a defer/reminder option that changes nothing', () => {
    const p = buildScenarioPrompt('protection_disabled', []);
    expect(p.options.find((o) => o.key === 'review')).toBeTruthy();
    const defer = p.options.find((o) => o.key === 'defer')!;
    expect(defer.kind).toBe('monitor');
    expect(defer.actionSpecs).toEqual([]);
  });
});

describe('password_guessing scenario', () => {
  it('offers block-source only when a usable source and capability were computed', () => {
    const withSource = buildScenarioPrompt('password_guessing', [opt('device.block_source_ip', { address: '203.0.113.7', direction: 'inbound' })]);
    expect(withSource.options.find((o) => o.key === 'block_source')!.availability).toBe('available');

    const withoutSource = buildScenarioPrompt('password_guessing', []);
    expect(withoutSource.options.find((o) => o.key === 'block_source')!.availability).toBe('unavailable');
  });

  it('offers lockout and disable-account independently based on what the server computed', () => {
    const p = buildScenarioPrompt('password_guessing', [opt('device.set_lockout_policy', { threshold: 5, durationMinutes: 15 }), opt('device.disable_local_account', { sid: 'S-1-5-21-1' })]);
    expect(p.options.find((o) => o.key === 'lockout')!.availability).toBe('available');
    expect(p.options.find((o) => o.key === 'disable_account')!.availability).toBe('available');
  });

  it('offers "verify with owner and continue monitoring" as a non-executing response', () => {
    const p = buildScenarioPrompt('password_guessing', []);
    const verify = p.options.find((o) => o.key === 'verify_owner')!;
    expect(verify.kind).toBe('monitor');
    expect(verify.actionSpecs).toEqual([]);
  });

  it('never treats screen locking as a response here — lock_session is not among the offered keys', () => {
    const p = buildScenarioPrompt('password_guessing', [opt('device.lock_session', {})]);
    expect(p.options.some((o) => o.actionSpecs.some((s) => s.actionType === 'device.lock_session'))).toBe(false);
  });
});

describe('unfamiliar incident types route through supported metadata, never a guessed action', () => {
  it('builds a generic prompt from whatever device options the server already computed, plus review and monitor fallbacks', () => {
    const p = buildScenarioPrompt('removable_media', [opt('device.restrict_removable_storage', { scope: 'new_removable_disks' })]);
    expect(p.scenarioKey).toBe('generic');
    expect(p.options.some((o) => o.actionSpecs.some((s) => s.actionType === 'device.restrict_removable_storage'))).toBe(true);
    expect(p.options.some((o) => o.kind === 'review')).toBe(true);
    expect(p.options.some((o) => o.kind === 'monitor')).toBe(true);
  });

  it('never fabricates a device action when none was computed', () => {
    const p = buildScenarioPrompt('some_future_rule', []);
    expect(p.options.every((o) => o.kind !== 'device_action' && o.kind !== 'device_action_combo')).toBe(true);
  });
});

describe('decisionNeedsReopen', () => {
  it('needs a decision when none has been recorded yet', () => {
    expect(decisionNeedsReopen(['f1'], null)).toBe(true);
  });
  it('does not reopen when every currently open finding was already part of the decided set', () => {
    expect(decisionNeedsReopen(['f1'], ['f1', 'f2'])).toBe(false);
    expect(decisionNeedsReopen([], ['f1'])).toBe(false);
  });
  it('reopens when a finding is open now that was not part of the decided set — new material evidence', () => {
    expect(decisionNeedsReopen(['f1', 'f2'], ['f1'])).toBe(true);
  });
});
