import { randomUUID } from 'node:crypto';
import type { CommandEnvelope, CommandResult } from '@saathi/contracts';
import type { DeviceAdapters, ExecOutcome, Probe } from './adapters/types';
import type { ChangeRecord, Ledger, Receipt } from './ledger';
import { verifyCommand, type PinnedKey, type RejectionReason } from './verify';

// Command execution (build.md Ph09): verify → persist receipt → local preconditions →
// apply desired state → observe postconditions → persist result → report. Redelivery of
// the same command returns the stored result and never reruns it. A crash between applying
// and recording is reconciled from observed state, or reported as unknown.

export type ExecutorConfig = { deviceId: string; orgId: string; keys: PinnedKey[]; recoverySids: string[] };

const MUTATING_OWNED = new Set(['device.disable_local_account', 'device.enable_firewall', 'device.set_lockout_policy', 'device.block_source_ip', 'device.enable_av', 'device.restrict_removable_storage']);

export function outcomeFromProbes(probes: Probe[]): CommandResult['outcome'] {
  const real = probes.filter((p) => p.kind !== 'simulated');
  if (real.length === 0) return 'unknown';
  if (real.every((p) => p.result === 'pass')) return 'confirmed';
  if (real.some((p) => p.result === 'pass')) return 'partial';
  if (real.every((p) => p.result === 'unknown')) return 'unknown';
  return 'failed';
}

export class Executor {
  constructor(
    private cfg: ExecutorConfig,
    private ledger: Ledger,
    private adapters: DeviceAdapters,
  ) {}

  private rejection(commandId: string, reason: RejectionReason): CommandResult {
    return { commandId, outcome: 'rejected', rejectionReason: reason, executedAt: null, probes: [], boundaries: this.adapters.simulated ? ['simulated'] : [], priorState: null, simulated: this.adapters.simulated };
  }

  /** Protected identities and other local preconditions (build.md Ph09). */
  async precheck(c: CommandEnvelope): Promise<{ reason: RejectionReason; change: ChangeRecord | null } | { reason: null; change: ChangeRecord | null }> {
    const caps = await this.adapters.capabilities();
    if (!caps.find((x) => x.action === c.type)?.supported) return { reason: 'unsupported', change: null };
    if (c.type === 'device.disable_local_account') {
      const sid = String(c.params.sid);
      const accounts = await this.adapters.accounts();
      const acct = accounts.find((a) => a.sid === sid);
      if (!acct) return { reason: 'precondition_changed', change: null };
      const self = await this.adapters.agentSid();
      if (this.cfg.recoverySids.includes(sid) || sid === self) return { reason: 'protected_identity', change: null };
      const enabledAdmins = accounts.filter((a) => a.isAdmin && a.enabled);
      if (acct.isAdmin && acct.enabled && enabledAdmins.length <= 1) return { reason: 'protected_identity', change: null };
      if (!acct.enabled) return { reason: 'precondition_changed', change: null };
    }
    if (c.type === 'device.undo_change') {
      const change = this.ledger.findChange(String(c.params.changeId));
      if (!change || change.status !== 'active') return { reason: 'precondition_changed', change: null };
      // Restore only if the device still holds exactly the state Saathi applied.
      if (!(await this.adapters.stillOwned(change))) return { reason: 'precondition_changed', change };
      return { reason: null, change };
    }
    return { reason: null, change: null };
  }

  async handle(raw: unknown, now = new Date()): Promise<CommandResult | null> {
    const v = verifyCommand(raw, { deviceId: this.cfg.deviceId, orgId: this.cfg.orgId, keys: this.cfg.keys, now, nonceOwner: (n) => this.ledger.nonceOwner(n) });
    if (!v.ok) {
      if (!v.commandId) return null;
      const prior = this.ledger.receipt(v.commandId);
      if (prior?.result && v.reason !== 'replayed') return prior.result;
      const res = this.rejection(v.commandId, v.reason);
      // A replay attempt under someone else's id must not overwrite that command's record.
      if (!prior) this.ledger.recordRejection(v.commandId, res);
      return res;
    }
    const c = v.command;
    const existing = this.ledger.receipt(c.id);
    if (existing?.status === 'done' && existing.result) return existing.result; // redelivery: no rerun
    if (existing && existing.status !== 'done') return this.reconcile(existing); // interrupted earlier
    this.ledger.recordReceipt(c, now); // receipt BEFORE any execution
    const pre = await this.precheck(c);
    if (pre.reason) {
      const res = this.rejection(c.id, pre.reason);
      this.ledger.complete(c.id, res);
      return res;
    }
    this.ledger.markApplying(c.id);
    let out: ExecOutcome | null = null;
    let error: string | null = null;
    try {
      out = await this.adapters.execute(c, { change: pre.change });
    } catch (e) {
      error = (e as Error).message;
    }
    let result: CommandResult;
    if (out) {
      const outcome = outcomeFromProbes(out.probes);
      result = { commandId: c.id, outcome, rejectionReason: null, executedAt: new Date().toISOString(), probes: out.probes.slice(0, 20), boundaries: out.boundaries, priorState: out.priorState, simulated: this.adapters.simulated };
      if (outcome !== 'failed' && out.priorState && out.appliedState && MUTATING_OWNED.has(c.type)) {
        this.ledger.addChange({ changeId: randomUUID(), actionId: c.actionId, commandId: c.id, type: c.type, priorState: out.priorState, appliedState: out.appliedState, status: 'active', at: new Date().toISOString() });
      }
      if (c.type === 'device.undo_change' && pre.change && outcome === 'confirmed') this.ledger.markUndone(pre.change.changeId);
    } else {
      // The change may or may not have happened: observe instead of assuming.
      const probes = await this.adapters.probe(this.ledger.receipt(c.id)!, { change: pre.change }).catch(() => [] as Probe[]);
      const outcome = outcomeFromProbes(probes);
      result = {
        commandId: c.id,
        outcome: outcome === 'confirmed' ? 'confirmed' : probes.length ? 'failed' : 'unknown',
        rejectionReason: null,
        executedAt: new Date().toISOString(),
        probes: [...probes, { kind: 'adapter_error', expected: 'no error', observed: (error ?? '').slice(0, 300), result: 'fail' as const, checkedAt: new Date().toISOString() }].slice(0, 20),
        boundaries: /policy|tamper|access is denied/i.test(error ?? '') ? ['managed_policy'] : [],
        priorState: null,
        simulated: this.adapters.simulated,
      };
    }
    this.ledger.complete(c.id, result);
    return result;
  }

  /** Reconcile a command interrupted by a crash: observe, never blindly rerun. */
  async reconcile(r: Receipt): Promise<CommandResult> {
    let result: CommandResult;
    if (r.status === 'received') {
      // Nothing was applied yet; it is safe to refuse rather than run late.
      result = this.rejection(r.commandId, new Date(r.expiresAt).getTime() <= Date.now() ? 'expired' : 'precondition_changed');
    } else {
      const change = r.type === 'device.undo_change' ? this.ledger.findChange(String(r.params.changeId)) : null;
      const probes = await this.adapters.probe(r, { change }).catch(() => [] as Probe[]);
      const outcome = outcomeFromProbes(probes);
      result = {
        commandId: r.commandId,
        // Desired state observed → confirmed; anything else after a crash is unknown.
        outcome: outcome === 'confirmed' ? 'confirmed' : 'unknown',
        rejectionReason: null,
        executedAt: null,
        probes,
        boundaries: this.adapters.simulated ? ['simulated'] : [],
        priorState: null,
        simulated: this.adapters.simulated,
      };
    }
    this.ledger.complete(r.commandId, result);
    return result;
  }

  async reconcileInterrupted(): Promise<CommandResult[]> {
    const out: CommandResult[] = [];
    for (const r of this.ledger.interrupted()) out.push(await this.reconcile(r));
    return out;
  }
}
