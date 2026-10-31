import type { CommandEnvelope, CommandResult } from '@saathi/contracts';
import type { StateStore } from './state';

// Persistent command ledger: replay protection (nonce → command), receipts written BEFORE
// execution, stored results for idempotent redelivery, and crash markers for reconciliation.

export type ReceiptStatus = 'received' | 'applying' | 'done';
export type Receipt = {
  commandId: string;
  actionId: string;
  type: CommandEnvelope['type'];
  params: CommandEnvelope['params'];
  expiresAt: string;
  receivedAt: string;
  status: ReceiptStatus;
  result: CommandResult | null;
  reported: boolean;
};
export type ChangeRecord = { changeId: string; actionId: string; commandId: string; type: string; priorState: Record<string, string | number | boolean | null>; appliedState: Record<string, string | number | boolean | null>; status: 'active' | 'undone'; at: string };

type LedgerFile = { nonces: Record<string, { commandId: string; expiresAt: string }>; receipts: Record<string, Receipt>; changes: ChangeRecord[] };

const FILE = 'ledger.json';

export class Ledger {
  private data: LedgerFile;
  constructor(private store: StateStore) {
    this.data = store.read<LedgerFile>(FILE, { nonces: {}, receipts: {}, changes: [] });
    this.data.changes ??= [];
  }

  private save() {
    this.store.write(FILE, this.data);
  }

  nonceOwner(nonce: string): string | null {
    return this.data.nonces[nonce]?.commandId ?? null;
  }

  receipt(commandId: string): Receipt | null {
    return this.data.receipts[commandId] ?? null;
  }

  /** Persist the receipt and consume the nonce before anything is executed. */
  recordReceipt(c: CommandEnvelope, now = new Date()): Receipt {
    const r: Receipt = { commandId: c.id, actionId: c.actionId, type: c.type, params: c.params, expiresAt: c.expiresAt, receivedAt: now.toISOString(), status: 'received', result: null, reported: false };
    this.data.nonces[c.nonce] = { commandId: c.id, expiresAt: c.expiresAt };
    this.data.receipts[c.id] = r;
    this.save();
    return r;
  }

  markApplying(commandId: string) {
    this.data.receipts[commandId].status = 'applying';
    this.save();
  }

  complete(commandId: string, result: CommandResult) {
    const r = this.data.receipts[commandId];
    r.status = 'done';
    r.result = result;
    r.reported = false;
    this.save();
  }

  /** Record a rejection for a command we may never have parsed fully. */
  recordRejection(commandId: string, result: CommandResult) {
    this.data.receipts[commandId] ??= { commandId, actionId: '', type: 'device.lock_session', params: {}, expiresAt: new Date().toISOString(), receivedAt: new Date().toISOString(), status: 'done', result, reported: false };
    this.data.receipts[commandId].status = 'done';
    this.data.receipts[commandId].result = result;
    this.save();
  }

  markReported(commandId: string) {
    if (this.data.receipts[commandId]) {
      this.data.receipts[commandId].reported = true;
      this.save();
    }
  }

  unreported(): Receipt[] {
    return Object.values(this.data.receipts).filter((r) => r.status === 'done' && r.result && !r.reported);
  }

  interrupted(): Receipt[] {
    return Object.values(this.data.receipts).filter((r) => r.status === 'applying' || r.status === 'received');
  }

  addChange(ch: ChangeRecord) {
    this.data.changes.push(ch);
    this.save();
  }

  /** Undo lookup accepts the agent's change id or the original action id. */
  findChange(id: string): ChangeRecord | null {
    return this.data.changes.find((c) => c.changeId === id || c.actionId === id) ?? null;
  }

  markUndone(changeId: string) {
    const c = this.data.changes.find((x) => x.changeId === changeId);
    if (c) {
      c.status = 'undone';
      this.save();
    }
  }

  /** Drop nonces long past expiry (the receipts keep the audit trail). */
  prune(now = new Date()) {
    const cutoff = now.getTime() - 7 * 86400_000;
    let changed = false;
    for (const [n, v] of Object.entries(this.data.nonces)) {
      if (new Date(v.expiresAt).getTime() < cutoff) {
        delete this.data.nonces[n];
        changed = true;
      }
    }
    if (changed) this.save();
  }
}
