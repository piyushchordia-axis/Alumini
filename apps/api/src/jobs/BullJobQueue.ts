import { Queue } from "bullmq";
import type Redis from "ioredis";
import { JOB_POLICIES, QUEUE_NAMES, type JobName, type JobPayloads, type JobPolicy, type QueueName } from "./definitions";
import type { EnqueueOptions, JobQueue } from "./JobQueue";

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
    const policy = this.policies[name];
    await this.queue(policy.queue).add(name, data, {
      jobId: opts.jobId,
      delay: opts.delayMs,
      attempts: policy.attempts,
      ...(policy.backoff ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } } : {}),
    });
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
