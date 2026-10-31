import type { AppContext } from "../context";
import { JOB_POLICIES, type JobName, type JobPayloads } from "./definitions";
import { jobHandlers } from "./handlers";
import { PermanentJobError, type EnqueueOptions, type JobHandler, type JobHandlers, type JobQueue } from "./JobQueue";
import { scheduledJobs, type ScheduledJob } from "./schedules";

interface PendingJob {
  name: JobName;
  data: unknown;
  opts?: EnqueueOptions;
  attempt: number;
  delayed: boolean;
}

/**
 * In-process queue for tests and the unit context. Jobs only run when a test calls drain() or runScheduled(), so a
 * test decides exactly when background work happens (and never races truncateAll between tests).
 */
export class MemoryJobQueue implements JobQueue {
  readonly kind = "memory" as const;
  /** Everything ever enqueued, in order. */
  readonly history: Array<{ name: JobName; data: unknown; opts?: EnqueueOptions }> = [];
  private pending: PendingJob[] = [];

  constructor(
    private readonly getCtx: () => AppContext,
    private readonly handlers: Partial<JobHandlers> = {},
    private readonly schedules: ScheduledJob[] = scheduledJobs,
  ) {}

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void> {
    this.history.push({ name, data, opts });
    if (opts?.jobId && this.pending.some((p) => p.opts?.jobId === opts.jobId)) return;
    this.pending.push({ name, data, opts, attempt: 1, delayed: !!opts?.delayMs });
  }

  /** Pending jobs of one name (or all), without running them. */
  peek(name?: JobName): Array<{ name: JobName; data: unknown }> {
    return this.pending.filter((p) => !name || p.name === name).map(({ name: n, data }) => ({ name: n, data }));
  }

  /**
   * Runs pending jobs first in, first out, including jobs they enqueue, honouring attempts and PermanentJobError.
   * Delayed jobs run only with includeDelayed. Returns what ran and what failed for good.
   */
  async drain(opts: { includeDelayed?: boolean; maxJobs?: number } = {}): Promise<{ ran: number; failed: Array<{ name: JobName; error: unknown }> }> {
    const max = opts.maxJobs ?? 1000;
    const failed: Array<{ name: JobName; error: unknown }> = [];
    let ran = 0;
    for (;;) {
      const index = this.pending.findIndex((p) => opts.includeDelayed || !p.delayed);
      if (index === -1 || ran >= max) break;
      const job = this.pending.splice(index, 1)[0]!;
      ran += 1;
      const policy = JOB_POLICIES[job.name];
      try {
        await this.handlerFor(job.name)(this.getCtx(), job.data as never, { jobId: job.opts?.jobId, attempt: job.attempt, maxAttempts: policy.attempts });
      } catch (error) {
        if (!(error instanceof PermanentJobError) && job.attempt < policy.attempts) this.pending.push({ ...job, attempt: job.attempt + 1, delayed: false });
        else failed.push({ name: job.name, error });
      }
    }
    return { ran, failed };
  }

  /** Runs one scheduled job immediately (as its scheduler would). */
  async runScheduled(id: string): Promise<void> {
    const s = this.schedules.find((x) => x.id === id);
    if (!s) throw new Error(`No scheduled job "${id}"`);
    const policy = JOB_POLICIES[s.job];
    await this.handlerFor(s.job)(this.getCtx(), s.data as never, { jobId: `schedule-${id}`, attempt: 1, maxAttempts: policy.attempts });
  }

  clear(): void {
    this.pending = [];
    this.history.length = 0;
  }

  async close(): Promise<void> {
    this.clear();
  }

  private handlerFor<N extends JobName>(name: N): JobHandler<N> {
    return (this.handlers[name] ?? jobHandlers[name]) as JobHandler<N>;
  }
}
