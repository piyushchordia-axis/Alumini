import type { AppContext } from "../context";
import type { JobName, JobPayloads } from "./definitions";

export interface EnqueueOptions {
  /**
   * Deduplicates: a job with the same id that is still waiting, delayed or active is not added again. Use "-" as the
   * separator (BullMQ reserves ":").
   */
  jobId?: string;
  delayMs?: number;
  /**
   * 1 (most urgent) to 1000. Within a queue, lower numbers run first; give every job on a queue a priority, because
   * BullMQ runs jobs without one before all prioritised jobs.
   */
  priority?: number;
}

export interface BulkJob<N extends JobName = JobName> {
  name: N;
  data: JobPayloads[N];
  opts?: EnqueueOptions;
}

/** Where request handlers and jobs put background work. BullMQ in the app, in memory in tests. */
export interface JobQueue {
  readonly kind: "bullmq" | "memory";
  enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts?: EnqueueOptions): Promise<void>;
  /** Adds many jobs in one round trip (fan-outs). Same semantics as enqueue for each job. */
  enqueueBulk(jobs: BulkJob[]): Promise<void>;
  close(): Promise<void>;
}

export interface JobMeta {
  jobId?: string;
  /** 1-based attempt number. */
  attempt: number;
  maxAttempts: number;
}

export type JobHandler<N extends JobName> = (ctx: AppContext, data: JobPayloads[N], meta: JobMeta) => Promise<void>;
export type JobHandlers = { [N in JobName]: JobHandler<N> };

/** Throw from a handler when retrying cannot help (bad input, record gone). The job fails without further attempts. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}
