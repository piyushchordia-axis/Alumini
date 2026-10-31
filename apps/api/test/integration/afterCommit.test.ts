import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { afterCommit, runInTransaction } from "../../src/lib/transaction";
import { notify } from "../../src/services/notifications/notification.service";
import { createMembership, createTenant, createUser } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("work queued after commit", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function member() {
    const { tenant } = await createTenant(ctx);
    const user = await createUser(ctx);
    const m = await createMembership(ctx, tenant.id, user.id);
    return { tenant, m };
  }
  const dispatches = () => ctx.jobs.history.filter((j) => j.name === "notifications.dispatch");

  it("queues delivery straight away outside a transaction", async () => {
    const { tenant, m } = await member();
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.id, m.id], type: "SYSTEM", title: "Hello" });
    expect(dispatches()).toHaveLength(1);
    expect((dispatches()[0]!.data as { notificationIds: string[] }).notificationIds).toHaveLength(1);
  });

  it("queues only after a runInTransaction() commit, and nothing on rollback", async () => {
    const { tenant, m } = await member();
    await runInTransaction(ctx, async (tx) => {
      await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.id], type: "SYSTEM", title: "Committed" }, tx);
      expect(dispatches()).toHaveLength(0);
    });
    expect(dispatches()).toHaveLength(1);

    await expect(
      runInTransaction(ctx, async (tx) => {
        await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.id], type: "SYSTEM", title: "Rolled back" }, tx);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(dispatches()).toHaveLength(1);
  });

  it("refuses transactions not started with runInTransaction()", async () => {
    const { tenant, m } = await member();
    // eslint-disable-next-line no-restricted-syntax -- the point of the test
    const raw = ctx.db.transaction(async (tx) => notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.id], type: "SYSTEM", title: "x" }, tx));
    await expect(raw).rejects.toThrow(/runInTransaction/);
  });

  it("logs and swallows hook failures so the request still succeeds", async () => {
    await expect(afterCommit(ctx, ctx.db, async () => Promise.reject(new Error("redis down")))).resolves.toBeUndefined();
  });
});
