import { UnrecoverableError, Worker, type Job } from "bullmq";
import type { Config } from "../config/env";
import type { AppContext } from "../context";
import { BullJobQueue } from "./BullJobQueue";
import { createBullConnection } from "./connection";
import { JOB_POLICIES, QUEUE_NAMES, type JobName } from "./definitions";
import { jobHandlers } from "./handlers";
import { PermanentJobError, type JobHandler, type JobHandlers } from "./JobQueue";
import { scheduledJobs, type ScheduledJob } from "./schedules";

export interface RunningWorkers {
  close(): Promise<void>;
}

/**
 * Starts one BullMQ worker per queue (in the API process when WORKER_MODE=inline, or in `pnpm worker`) and syncs the
 * scheduled jobs. Handlers receive the same AppContext as request handlers.
 */
export async function startWorkers(
  ctx: AppContext,
  opts: { redisUrl: string; prefix?: string; concurrency: number; handlers?: Partial<JobHandlers>; schedules?: ScheduledJob[] },
): Promise<RunningWorkers> {
  const handlers: Partial<JobHandlers> = { ...jobHandlers, ...opts.handlers };
  const connection = createBullConnection(opts.redisUrl, "worker");
  const prefix = opts.prefix;

  const processor = async (job: Job) => {
    const name = job.name as JobName;
    const handler = handlers[name] as JobHandler<JobName> | undefined;
    if (!handler) throw new UnrecoverableError(`No handler for job "${job.name}"`);
    try {
      await handler(ctx, job.data as never, { jobId: job.id, attempt: job.attemptsMade + 1, maxAttempts: job.opts.attempts ?? JOB_POLICIES[name]?.attempts ?? 1 });
    } catch (err) {
      if (err instanceof PermanentJobError) throw new UnrecoverableError(err.message);
      throw err;
    }
  };

  const workers = QUEUE_NAMES.map((queue) => {
    const worker = new Worker(queue, processor, {
      connection,
      prefix,
      concurrency: queue === "messages" ? Math.min(opts.concurrency, 5) : opts.concurrency,
      // Provider rate limits (WhatsApp, MSG91, SMTP): at most 20 sends a second across all workers.
      ...(queue === "messages" ? { limiter: { max: 20, duration: 1000 } } : {}),
    });
    worker.on("failed", (job, err) => ctx.logger.warn({ err, job: job?.name, jobId: job?.id, attempt: job?.attemptsMade }, "Job failed"));
    worker.on("error", (err) => ctx.logger.error({ err, queue }, "Worker error"));
    return worker;
  });

  const scheduler = new BullJobQueue({ connection, prefix });
  await syncSchedules(scheduler, opts.schedules ?? scheduledJobs, ctx.config);
  ctx.logger.info({ queues: QUEUE_NAMES, concurrency: opts.concurrency }, "Background workers started");

  return {
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await scheduler.close();
      await connection.quit().catch(() => undefined);
    },
  };
}

/** Makes the queues' job schedulers match the registry (add/update listed ones, remove the rest). */
export async function syncSchedules(queue: BullJobQueue, schedules: ScheduledJob[], config: Config): Promise<void> {
  const active = schedules.filter((s) => s.enabled?.(config) ?? true);
  for (const name of QUEUE_NAMES) {
    const q = queue.queue(name);
    const wanted = active.filter((s) => JOB_POLICIES[s.job].queue === name);
    const existing = await q.getJobSchedulers();
    for (const s of existing) {
      if (!wanted.some((w) => w.id === s.key)) await q.removeJobScheduler(s.key);
    }
    for (const s of wanted) {
      const policy = JOB_POLICIES[s.job];
      await q.upsertJobScheduler(s.id, s.repeat, {
        name: s.job,
        data: s.data,
        opts: { attempts: policy.attempts, ...(policy.backoff ? { backoff: { type: policy.backoff.type, delay: policy.backoff.delayMs } } : {}) },
      });
    }
  }
}
