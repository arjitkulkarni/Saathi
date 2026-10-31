import type { CommandEnvelope, CommandResult, Heartbeat, PostureCheck, PostureKey } from '@saathi/contracts';
import type { ChangeRecord, Receipt } from '../ledger';

export type CapabilityReportT = Heartbeat['capabilities'][number];
export type Account = { sid: string; username: string; isAdmin: boolean; enabled: boolean };
export type Probe = CommandResult['probes'][number];
export type Boundary = 'lock_not_termination' | 'already_mounted' | 'existing_sessions' | 'managed_policy' | 'scan_not_eradication' | 'simulated';
export type StateValue = Record<string, string | number | boolean | null>;

export type ExecOutcome = {
  priorState: StateValue | null;
  appliedState: StateValue | null;
  probes: Probe[];
  boundaries: Boundary[];
  /** Set when the adapter knows the change cannot be judged from probes alone. */
  note?: string;
};

export type ModeName = 'full' | 'observe-only' | 'simulate';

/**
 * Fixed device adapters (build.md Ph09): each action has supports / execute (desired state)
 * / probe / boundaries. No adapter accepts executables, script bodies, paths or command
 * lines from the server.
 */
export interface DeviceAdapters {
  readonly mode: ModeName;
  readonly simulated: boolean;
  capabilities(): Promise<CapabilityReportT[]>;
  prerequisites(): Promise<Heartbeat['prerequisites']>;
  accounts(): Promise<Account[]>;
  /** SID of the identity the agent runs as (protected from disabling). */
  agentSid(): Promise<string | null>;
  posture(): Promise<Partial<Record<PostureKey, PostureCheck>>>;
  interactiveSession(): Promise<Heartbeat['interactiveSession']>;
  /** Apply the desired state for a verified command and observe postconditions. */
  execute(c: CommandEnvelope, ctx: { change: ChangeRecord | null }): Promise<ExecOutcome>;
  /** Observe whether a command's desired state currently holds (crash reconciliation). */
  probe(r: Receipt, ctx: { change: ChangeRecord | null }): Promise<Probe[]>;
  /** For undo: does the device still hold exactly the state Saathi applied? */
  stillOwned(change: ChangeRecord): Promise<boolean>;
}

export const probe = (kind: string, expected: string, observed: string, pass: boolean | null, at = new Date()): Probe => ({
  kind,
  expected: expected.slice(0, 200),
  observed: observed.slice(0, 400),
  result: pass === null ? 'unknown' : pass ? 'pass' : 'fail',
  checkedAt: at.toISOString(),
});

export const nowIso = () => new Date().toISOString();
