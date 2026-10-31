import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync, renameSync } from 'node:fs';
import type { AgentEvent } from '@saathi/contracts';

// Bounded offline queue (build.md Ph05.5). Observations are appended as JSON lines and kept
// across restarts. When the size cap is reached, new observations are dropped and counted;
// the counter is reported to the server so the gap is visible, never silent.

export class Spool {
  constructor(
    private file: string,
    private counterFile: string,
    readonly maxBytes = 5 * 1024 * 1024,
  ) {}

  private size() {
    return existsSync(this.file) ? statSync(this.file).size : 0;
  }

  get dropped(): number {
    return existsSync(this.counterFile) ? Number(readFileSync(this.counterFile, 'utf8')) || 0 : 0;
  }

  private setDropped(n: number) {
    writeFileSync(this.counterFile, String(n));
  }

  push(events: AgentEvent[]): { added: number; dropped: number } {
    let added = 0;
    let dropped = 0;
    let size = this.size();
    for (const e of events) {
      const line = JSON.stringify(e) + '\n';
      if (size + Buffer.byteLength(line) > this.maxBytes) {
        dropped++;
        continue;
      }
      appendFileSync(this.file, line);
      size += Buffer.byteLength(line);
      added++;
    }
    if (dropped) this.setDropped(this.dropped + dropped);
    return { added, dropped };
  }

  peek(max: number): AgentEvent[] {
    if (!existsSync(this.file)) return [];
    return readFileSync(this.file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .slice(0, max)
      .map((l) => JSON.parse(l) as AgentEvent);
  }

  depth(): number {
    if (!existsSync(this.file)) return 0;
    return readFileSync(this.file, 'utf8').split('\n').filter(Boolean).length;
  }

  /** Remove the first `n` events after the server acknowledged them. */
  ack(n: number) {
    if (!existsSync(this.file) || n <= 0) return;
    const rest = readFileSync(this.file, 'utf8').split('\n').filter(Boolean).slice(n);
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, rest.length ? rest.join('\n') + '\n' : '');
    renameSync(tmp, this.file);
  }

  /** Reset the dropped counter once it has been reported. */
  consumeDropped(): number {
    const n = this.dropped;
    if (n) this.setDropped(0);
    return n;
  }
}
