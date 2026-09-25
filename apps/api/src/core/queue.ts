/**
 * In-process job queue with retry/backoff. Stands in for Redis + BullMQ (docs §4) behind the
 * same enqueue/handler shape, so it can be swapped without touching callers.
 * Jobs must be enqueued AFTER the transaction that created their subject has committed.
 */
export type JobHandler = (payload: any, meta: { attempt: number; cid: string }) => Promise<void>;

interface Job {
  name: string;
  payload: unknown;
  attempt: number;
  cid: string;
  notBefore: number;
}

export interface QueueOptions {
  maxAttempts: number;
  backoffMs: (attempt: number) => number;
  /** Called when a job fails for the last time. */
  onExhausted?: (name: string, payload: any, err: unknown, cid: string) => Promise<void>;
}

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private jobs: Job[] = [];
  private running = false;
  private idleWaiters: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: QueueOptions) {}

  handle(name: string, fn: JobHandler) {
    this.handlers.set(name, fn);
  }

  setExhaustedHandler(fn: NonNullable<QueueOptions['onExhausted']>) {
    this.opts.onExhausted = fn;
  }

  enqueue(name: string, payload: unknown, cid: string) {
    this.jobs.push({ name, payload, attempt: 1, cid, notBefore: 0 });
    this.kick();
  }

  get pending() {
    return this.jobs.length + (this.running ? 1 : 0);
  }

  /** Resolves once every job (including retries) has finished. Used by tests and the seed. */
  drain(): Promise<void> {
    if (!this.jobs.length && !this.running) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private kick() {
    if (this.running || this.timer) return;
    const next = this.jobs.length ? Math.min(...this.jobs.map((j) => j.notBefore)) : 0;
    const wait = Math.max(0, next - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.loop();
    }, wait);
  }

  private async loop() {
    this.running = true;
    while (true) {
      const now = Date.now();
      const idx = this.jobs.findIndex((j) => j.notBefore <= now);
      if (idx < 0) break;
      const job = this.jobs.splice(idx, 1)[0];
      const fn = this.handlers.get(job.name);
      if (!fn) continue;
      try {
        await fn(job.payload, { attempt: job.attempt, cid: job.cid });
      } catch (err) {
        if (job.attempt < this.opts.maxAttempts) {
          this.jobs.push({ ...job, attempt: job.attempt + 1, notBefore: Date.now() + this.opts.backoffMs(job.attempt) });
        } else if (this.opts.onExhausted) {
          await this.opts.onExhausted(job.name, job.payload, err, job.cid).catch(() => {});
        }
      }
    }
    this.running = false;
    if (this.jobs.length) {
      this.kick();
      return;
    }
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach((w) => w());
  }
}
