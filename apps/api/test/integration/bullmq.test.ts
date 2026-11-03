import { randomUUID } from "node:crypto";
import { QueueEvents } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context";
import { BullJobQueue } from "../../src/jobs/BullJobQueue";
import { createBullConnection } from "../../src/jobs/connection";
import { PermanentJobError, type JobHandlers } from "../../src/jobs/JobQueue";
import { startWorkers, syncSchedules, type RunningWorkers } from "../../src/jobs/runWorkers";
import { queueConversationPush } from "../../src/services/chat/fanout";
import type { ScheduledJob } from "../../src/jobs/schedules";
import { loadConfig } from "../../src/config/env";
import { createLogger } from "../../src/lib/logger";
import { isRealRedisAvailable, realRedisUrl } from "../helpers/realRedis";

const redisAvailable = await isRealRedisAvailable();

/** Polls until `check` passes (BullMQ processes asynchronously). */
async function eventually(check: () => void, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      check();
      return;
    } catch (err) {
      if (Date.now() - start > timeoutMs) throw err;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe.skipIf(!redisAvailable)("BullMQ job queue (real Redis)", () => {
  const prefix = `test-${randomUUID()}`;
  const config = loadConfig({ NODE_ENV: "test", DATABASE_URL: "postgres://unused" });
  const ctx = { config, logger: createLogger("silent", false) } as AppContext;
  const calls: Array<{ name: string; attempt: number; data: unknown }> = [];
  let failNTimes = 0;
  const handlers: Partial<JobHandlers> = {
    "notifications.dispatch": async (_c, data, meta) => {
      calls.push({ name: "dispatch", attempt: meta.attempt, data });
      if (failNTimes > 0) {
        failNTimes -= 1;
        throw new Error("transient");
      }
    },
    "push.send": async (_c, data, meta) => {
      calls.push({ name: "push", attempt: meta.attempt, data });
      throw new PermanentJobError("bad batch");
    },
    "push.checkReceipts": async (_c, data, meta) => {
      calls.push({ name: "receipts", attempt: meta.attempt, data });
    },
    "chat.pushConversation": async (_c, data, meta) => {
      calls.push({ name: "chat", attempt: meta.attempt, data });
    },
  };
  const producer = createBullConnection(realRedisUrl(), "producer");
  const queue = new BullJobQueue({
    connection: producer,
    prefix,
    // Fast retries for the test.
    policies: { "notifications.dispatch": { queue: "jobs", attempts: 3, backoff: { type: "fixed", delayMs: 10 } } },
  });
  let workers: RunningWorkers;

  beforeAll(async () => {
    workers = await startWorkers(ctx, { redisUrl: realRedisUrl(), prefix, concurrency: 2, handlers, schedules: [] });
  });
  afterAll(async () => {
    await workers?.close();
    for (const name of ["jobs", "messages", "chat"] as const) await queue.queue(name).obliterate({ force: true });
    await queue.close();
    await producer.quit();
  });

  it("processes jobs and retries transient failures", async () => {
    failNTimes = 2;
    await queue.enqueue("notifications.dispatch", { tenantId: "t", notificationIds: ["n1"] });
    await eventually(() => expect(calls.filter((c) => c.name === "dispatch").map((c) => c.attempt)).toEqual([1, 2, 3]));
  });

  it("does not retry permanent failures", async () => {
    const events = new QueueEvents("jobs", { connection: createBullConnection(realRedisUrl(), "worker"), prefix });
    await events.waitUntilReady();
    const failed = new Promise<string>((resolve) => events.on("failed", ({ failedReason }) => resolve(failedReason)));
    await queue.enqueue("push.send", { messages: [] });
    expect(await failed).toBe("bad batch");
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.filter((c) => c.name === "push")).toHaveLength(1);
    await events.close();
  });

  it("adds jobs in bulk with priorities and job ids", async () => {
    const before = calls.filter((c) => c.name === "receipts").length;
    await queue.enqueueBulk([
      { name: "push.checkReceipts", data: {}, opts: { jobId: "bulk-a", priority: 5 } },
      { name: "push.checkReceipts", data: {}, opts: { jobId: "bulk-b", priority: 1 } },
      { name: "push.checkReceipts", data: {}, opts: { jobId: "bulk-a", priority: 5 } },
    ]);
    await eventually(() => expect(calls.filter((c) => c.name === "receipts").length - before).toBe(2));
  });

  it("dedupes jobs with the same id", async () => {
    const before = calls.filter((c) => c.name === "receipts").length;
    const q = queue.queue("jobs");
    await q.pause();
    await queue.enqueue("push.checkReceipts", {}, { jobId: "once" });
    await queue.enqueue("push.checkReceipts", {}, { jobId: "once" });
    await q.resume();
    await eventually(() => expect(calls.filter((c) => c.name === "receipts").length).toBe(before + 1));
    await new Promise((r) => setTimeout(r, 200));
    expect(calls.filter((c) => c.name === "receipts").length).toBe(before + 1);
  });

  describe("a chat push bucket", () => {
    const window = { windowMs: 200, quietSec: 1 };
    const chatCalls = () => calls.filter((c) => c.name === "chat").length;
    const push = (conversationId: string, now: number) => queueConversationPush({ jobs: queue }, { tenantId: "t", conversationId }, window, now);

    it("holds its id after completing, and doesn't stop the next bucket", async () => {
      const before = chatCalls();
      const now = Date.now();
      await push("c-1", now);
      await eventually(() => expect(chatCalls()).toBe(before + 1));
      const bucket = Math.floor(now / window.windowMs);
      const finished = await queue.queue("chat").getJob(`chatpush-c-1-${bucket}`);
      expect(await finished!.isCompleted()).toBe(true);

      // This is the trap: BullMQ still refuses the finished id, so a constant id here would mean no more pushes for a day.
      await push("c-1", now);
      await new Promise((r) => setTimeout(r, window.windowMs * 3));
      expect(chatCalls()).toBe(before + 1);

      await push("c-1", now + window.windowMs);
      await eventually(() => expect(chatCalls()).toBe(before + 2));
    });

    it("merges everything queued in one bucket into one run, which waits for the end of the next", async () => {
      const before = chatCalls();
      const now = Date.now();
      const q = queue.queue("chat");
      await q.pause();
      await push("c-2", now);
      await push("c-2", now);
      const bucket = Math.floor(now / window.windowMs);
      const job = await q.getJob(`chatpush-c-2-${bucket}`);
      expect(job!.opts.delay).toBe((bucket + 2) * window.windowMs - now);
      expect(job!.queueName).toBe("chat");
      await q.resume();
      await eventually(() => expect(chatCalls()).toBe(before + 1));
      await new Promise((r) => setTimeout(r, window.windowMs));
      expect(chatCalls()).toBe(before + 1);
    });

    it("keeps conversations apart", async () => {
      const before = chatCalls();
      const now = Date.now();
      await push("c-3", now);
      await push("c-4", now);
      await eventually(() => expect(chatCalls()).toBe(before + 2));
    });
  });

  it("syncs scheduled jobs from the registry and runs them", async () => {
    const schedules: ScheduledJob[] = [{ id: "test-receipts", job: "push.checkReceipts", data: {}, repeat: { every: 200 } }];
    const before = calls.filter((c) => c.name === "receipts").length;
    await syncSchedules(queue, schedules, config);
    expect((await queue.queue("jobs").getJobSchedulers()).map((s) => s.key)).toEqual(["test-receipts"]);
    await eventually(() => expect(calls.filter((c) => c.name === "receipts").length).toBeGreaterThanOrEqual(before + 2));
    // Removing it from the registry removes the scheduler.
    await syncSchedules(queue, [], config);
    expect(await queue.queue("jobs").getJobSchedulers()).toEqual([]);
  });
});
