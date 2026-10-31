import { DEVICE_ACTIONS, type CommandEnvelope } from '@saathi/contracts';
import type { ChangeRecord, Receipt } from '../ledger';
import { WindowsAdapters } from './windows';
import type { CapabilityReportT, ExecOutcome, Probe } from './types';

// Observe-only mode: real event collection and posture reads, but every mutating action is
// reported unsupported. This is the mode that is safe on an everyday machine.

export class ObserveOnlyAdapters extends WindowsAdapters {
  override readonly mode = 'observe-only' as const;

  override async capabilities(): Promise<CapabilityReportT[]> {
    return DEVICE_ACTIONS.map((action) => ({ action, supported: false, reason: 'Agent runs in observe-only mode; actions are disabled on this device' }));
  }

  override async execute(c: CommandEnvelope, _ctx: { change: ChangeRecord | null }): Promise<ExecOutcome> {
    void _ctx;
    throw new Error(`observe-only mode refuses ${c.type}`);
  }

  override async probe(_r: Receipt, _ctx: { change: ChangeRecord | null }): Promise<Probe[]> {
    void _r;
    void _ctx;
    return [];
  }
}
