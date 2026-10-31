import type pg from 'pg';
import { withTx } from '@saathi/db';

// Durable job runtime (build.md Ph03.3–3.4). Claims happen in a short transaction with
// FOR UPDATE SKIP LOCKED (saathi_claim_jobs), the lease is committed, then the handler does
// its I/O. A crash leaves the lease to expire and the job returns to the queue. Handlers
// must be idempotent; irreversible effects are guarded by their own state checks.

export type Job = { id: string; orgId: string | null; type: string; payload: Record<string, unknown>; attempts: number; maxAttempts: number };
export type Handler = (job: Job) => Promise<void>;

export class PermanentError extends Error {}

export function backoffDelayMs(attempts: number) {
  const base = Math.min(5_000 * 2 ** (attempts - 1), 30 * 60 * 1000);
  return base + Math.floor(Math.random() * base * 0.25);
}

export type RuntimeOptions = { pool: pg.Pool; workerId: string; handlers: Record<string, Handler>; concurrency?: number; leaseSeconds?: number; log: (level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>) => void };

export class JobRuntime {
  private running = false;
  private active = 0;
  constructor(private o: RuntimeOptions) {}

  async claim(limit: number): Promise<Job[]> {
    return withTx(this.o.pool, {}, async (_db, client) => {
      const r = await client.query('SELECT id, org_id, type, payload, attempts, max_attempts FROM saathi_claim_jobs($1, $2, $3)', [this.o.workerId, limit, this.o.leaseSeconds ?? 120]);
      return r.rows.map((x) => ({ id: x.id, orgId: x.org_id, type: x.type, payload: x.payload ?? {}, attempts: x.attempts, maxAttempts: x.max_attempts }));
    });
  }

  async runOne(job: Job) {
    const handler = this.o.handlers[job.type];
    const started = Date.now();
    try {
      if (!handler) throw new PermanentError(`no handler for job type ${job.type}`);
      await handler(job);
      await withTx(this.o.pool, {}, (_db, c) => c.query('SELECT saathi_job_succeed($1, $2)', [job.id, this.o.workerId]));
      this.o.log('info', 'job done', { type: job.type, id: job.id, ms: Date.now() - started });
    } catch (e) {
      const err = e as Error;
      const dead = e instanceof PermanentError || job.attempts >= job.maxAttempts;
      const retryAt = dead ? null : new Date(Date.now() + backoffDelayMs(job.attempts));
      await withTx(this.o.pool, {}, (_db, c) => c.query('SELECT saathi_job_fail($1, $2, $3, $4, $5)', [job.id, this.o.workerId, `${err.name}: ${err.message}`, retryAt, dead])).catch(() => undefined);
      this.o.log(dead ? 'error' : 'warn', dead ? 'job failed permanently' : 'job failed; will retry', { type: job.type, id: job.id, attempts: job.attempts, error: err.message });
    }
  }

  /** Process due jobs until none remain (used by tests and by the loop). */
  async drain(maxRounds = 50) {
    for (let i = 0; i < maxRounds; i++) {
      const jobs = await this.claim(this.o.concurrency ?? 4);
      if (jobs.length === 0) return i;
      await Promise.all(jobs.map((j) => this.runOne(j)));
    }
    return maxRounds;
  }

  start(pollMs = 1000) {
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      try {
        const free = (this.o.concurrency ?? 4) - this.active;
        if (free > 0) {
          const jobs = await this.claim(free);
          for (const j of jobs) {
            this.active++;
            void this.runOne(j).finally(() => this.active--);
          }
        }
      } catch (e) {
        this.o.log('warn', 'claim failed (database unavailable?)', { error: (e as Error).message });
      }
      setTimeout(tick, pollMs);
    };
    void tick();
  }

  async stop() {
    this.running = false;
    for (let i = 0; i < 100 && this.active > 0; i++) await new Promise((r) => setTimeout(r, 100));
  }
}
