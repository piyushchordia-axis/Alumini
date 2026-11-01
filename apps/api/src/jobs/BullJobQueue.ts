import { Queue } from "bullmq";
import type Redis from "ioredis";
import { JOB_POLICIES, QUEUE_NAMES, type JobName, type JobPayloads, type JobPolicy, type QueueName } from "./definitions";
import type { BulkJob, EnqueueOptions, JobQueue } from "./JobQueue";

export const DEFAULT_JOB_PREFIX = "bull";

/** The production queue: one BullMQ Queue per QueueName on a shared producer connection. */
export class BullJobQueue implements JobQueue {
  readonly kind = "bullmq" as const;
  readonly prefix: string;
  private readonly queues: Map<QueueName, Queue>;
  private readonly policies: { [N in JobName]: JobPolicy };

  constructor(opts: { connection: Redis; prefix?: string; policies?: Partial<{ [N in JobName]: JobPolicy }> }) {
    this.prefix = opts.prefix ?? DEFAULT_JOB_PREFIX;
    this.policies = { ...JOB_POLICIES, ...opts.policies };
    this.queues = new Map(
      QUEUE_NAMES.map((name) => [
        name,
        new Queue(name, {
          connection: opts.connection,
          prefix: this.prefix,
          defaultJobOptions: { removeOnComplete: { age: 24 * 3600, count: 1000 }, removeOnFail: { age: 7 * 24 * 3600 } },
        }),
      ]),
    );
  }

  queue(name: QueueName): Queue {
    return this.queues.get(name)!;
  }

  async enqueue<N extends JobName>(name: N, data: JobPayloads[N], opts: EnqueueOptions = {}): Promise<void> {
    await this.queue(this.policies[name].queue).add(name, data, this.jobOptions(name, opts));
  }

  async enqueueBulk(jobs: BulkJob[]): Promise<void> {
    const byQueue = new Map<QueueName, Array<{ name: string; data: unknown; opts: ReturnType<BullJobQueue["jobOptions"]> }>>();
    for (const job of jobs) {
      const queue = this.policies[job.name].queue;
      const list = byQueue.get(queue) ?? [];
      list.push({ name: job.name, data: job.data, opts: this.jobOptions(job.name, job.opts ?? {}) });
      byQueue.set(queue, list);
    }
    for (const [queue, list] of byQueue) {
      for (let i = 0; i < list.length; i += 500) await this.queue(queue).addBulk(list.slice(i, i + 500));
    }
  }

  private jobOptions(name: JobName, opts: EnqueueOptions) {
    const policy = this.policies[name];
    return {
      jobId: opts.jobId,
      delay: opts.delayMs,
      ...(opts.priority ? { priority: opts.priority } : {}),
      attempts: policy.attempts,
      ...(policy.backoff ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } } : {}),
    };
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
