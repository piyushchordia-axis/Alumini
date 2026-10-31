import { describe, expect, it } from "vitest";
import type { AppContext } from "../../src/context";
import { MemoryJobQueue } from "../../src/jobs/MemoryJobQueue";
import { PermanentJobError, type JobHandlers } from "../../src/jobs/JobQueue";

const ctx = {} as AppContext;
type Calls = Array<{ name: string; data: unknown; attempt: number }>;

function queueWith(handlers: Partial<JobHandlers>) {
  return new MemoryJobQueue(() => ctx, handlers, []);
}

describe("MemoryJobQueue", () => {
  it("runs jobs first in, first out, including jobs that handlers enqueue", async () => {
    const calls: Calls = [];
    const q: MemoryJobQueue = queueWith({
      "notifications.dispatch": async (_c, data, meta) => {
        calls.push({ name: "dispatch", data, attempt: meta.attempt });
        await q.enqueue("push.send", { messages: [] });
      },
      "push.send": async (_c, data, meta) => {
        calls.push({ name: "push", data, attempt: meta.attempt });
      },
    });
    await q.enqueue("notifications.dispatch", { tenantId: "t1", notificationIds: ["a"] });
    await q.enqueue("notifications.dispatch", { tenantId: "t2", notificationIds: ["b"] });
    expect(q.peek()).toHaveLength(2);
    const result = await q.drain();
    expect(result).toEqual({ ran: 4, failed: [] });
    expect(calls.map((c) => c.name)).toEqual(["dispatch", "dispatch", "push", "push"]);
  });

  it("retries failures up to the job's attempts, but not permanent errors", async () => {
    let tries = 0;
    const q = queueWith({
      // notifications.dispatch allows 3 attempts
      "notifications.dispatch": async () => {
        tries += 1;
        throw new Error("flaky");
      },
      "push.send": async () => {
        throw new PermanentJobError("bad input");
      },
    });
    await q.enqueue("notifications.dispatch", { tenantId: "t", notificationIds: [] });
    await q.enqueue("push.send", { messages: [] });
    const result = await q.drain();
    expect(tries).toBe(3);
    expect(result.failed.map((f) => f.name).sort()).toEqual(["notifications.dispatch", "push.send"]);
  });

  it("dedupes pending jobs by id and holds delayed jobs until asked", async () => {
    let runs = 0;
    const q = queueWith({ "push.checkReceipts": async () => void (runs += 1) });
    await q.enqueue("push.checkReceipts", {}, { jobId: "receipts" });
    await q.enqueue("push.checkReceipts", {}, { jobId: "receipts" });
    await q.enqueue("push.checkReceipts", {}, { delayMs: 60_000 });
    expect(q.history).toHaveLength(3);
    await q.drain();
    expect(runs).toBe(1);
    await q.drain({ includeDelayed: true });
    expect(runs).toBe(2);
  });
});
