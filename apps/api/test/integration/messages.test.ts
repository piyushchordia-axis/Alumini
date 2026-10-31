import type { MessageChannel } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outboundMessages } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { findMessage } from "../../src/repositories/messages.repo";
import { queueMessage, sweepMessages } from "../../src/services/messages/message.service";
import { MessageSendError, type ChannelSender, type RenderedMessage } from "../../src/services/messages/types";
import { auth, loginAs } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** Records what it "sends"; queue errors to make the next sends fail. */
class CapturingSender<C extends MessageChannel> implements ChannelSender<C> {
  readonly provider = "capture";
  readonly sent: RenderedMessage[] = [];
  readonly failures: MessageSendError[] = [];
  constructor(readonly channel: C) {}
  async send(m: Extract<RenderedMessage, { channel: C }>) {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(m);
    return { providerMessageId: `${this.channel}-${this.sent.length}` };
  }
}

describe.skipIf(!dbAvailable)("outbound messages", () => {
  let ctx: TestContext;
  const senders = { WHATSAPP: new CapturingSender("WHATSAPP"), SMS: new CapturingSender("SMS"), EMAIL: new CapturingSender("EMAIL") };
  beforeAll(async () => {
    ctx = await createTestContext({ MSG91_FLOW_TEMPLATE_IDS: "PLATFORM_TEST=flow-1" }, { messageSenders: senders });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    for (const s of Object.values(senders)) {
      s.sent.length = 0;
      s.failures.length = 0;
    }
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const to = { phoneE164: "+919876543210", email: "asha@example.com", name: "Asha" };

  it("sends over the first channel that works and records the result", async () => {
    const row = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" } });
    expect(row).toMatchObject({ status: "QUEUED", channels: ["WHATSAPP", "SMS", "EMAIL"] });
    expect(senders.WHATSAPP.sent).toHaveLength(0); // nothing is sent inside the request
    await ctx.jobs.drain();
    expect(senders.WHATSAPP.sent).toHaveLength(1);
    expect(await findMessage(ctx.db, row.id)).toMatchObject({ status: "SENT", channel: "WHATSAPP", provider: "capture", providerMessageId: "WHATSAPP-1", attempts: 1 });
  });

  it("falls back to SMS when WhatsApp rejects the message for good", async () => {
    senders.WHATSAPP.failures.push(new MessageSendError("whatsapp", "HTTP 400", false));
    const row = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" } });
    await ctx.jobs.drain();
    const saved = await findMessage(ctx.db, row.id);
    expect(saved).toMatchObject({ status: "SENT", channel: "SMS" });
    expect(saved!.errors).toEqual([expect.objectContaining({ channel: "WHATSAPP", error: "whatsapp: HTTP 400", retryable: false })]);
    expect(senders.SMS.sent[0]).toMatchObject({ channel: "SMS", flowTemplateId: "flow-1" });
  });

  it("retries temporary failures and marks the message failed after the last attempt", async () => {
    // Email only, failing every time (5 attempts).
    for (let i = 0; i < 5; i++) senders.EMAIL.failures.push(new MessageSendError("smtp", "SMTP 451", true));
    const row = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" }, channels: ["EMAIL"] });
    const result = await ctx.jobs.drain();
    expect(result.failed).toEqual([]);
    const saved = await findMessage(ctx.db, row.id);
    expect(saved).toMatchObject({ status: "FAILED", attempts: 5, lastError: "smtp: SMTP 451" });
    expect(saved!.errors).toHaveLength(5);
    expect(saved!.failedAt).not.toBeNull();
  });

  it("succeeds on a later attempt after a temporary failure", async () => {
    senders.EMAIL.failures.push(new MessageSendError("smtp", "SMTP 421", true));
    const row = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" }, channels: ["EMAIL"] });
    await ctx.jobs.drain();
    expect(await findMessage(ctx.db, row.id)).toMatchObject({ status: "SENT", attempts: 2, channel: "EMAIL" });
  });

  it("does not send a message twice", async () => {
    const first = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" }, dedupeKey: "test-1" });
    const again = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" }, dedupeKey: "test-1" });
    expect(again.id).toBe(first.id);
    await ctx.jobs.drain();
    // Re-running the job for a sent message is a no-op.
    await ctx.jobs.enqueue("messages.send", { messageId: first.id });
    await ctx.jobs.drain();
    expect(senders.WHATSAPP.sent).toHaveLength(1);
  });

  it("drops a message queued in a transaction that rolls back", async () => {
    await expect(
      runInTransaction(ctx, async (tx) => {
        await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" } }, tx);
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await ctx.db.select().from(outboundMessages)).toHaveLength(0);
    expect(ctx.jobs.peek("messages.send")).toHaveLength(0);
  });

  it("re-queues messages a crash left behind", async () => {
    const row = await queueMessage(ctx, { type: "PLATFORM_TEST", to, payload: { sentBy: "Staff" } });
    ctx.jobs.clear(); // the job was lost
    await ctx.db.update(outboundMessages).set({ updatedAt: new Date(Date.now() - 10 * 60_000) }).where(eq(outboundMessages.id, row.id));
    expect(await sweepMessages(ctx)).toBe(1);
    await ctx.jobs.drain();
    expect(await findMessage(ctx.db, row.id)).toMatchObject({ status: "SENT" });
  });

  it("lets staff send a test message and follow it", async () => {
    const staff = auth((await loginAs(ctx, "+919999999999")).accessToken);
    const res = await request(ctx.app).post("/api/v1/platform/messages/test").set(staff).send({ email: "ops@example.com", channels: ["EMAIL"] });
    expect(res.status).toBe(202);
    expect(res.body.data).toMatchObject({ type: "PLATFORM_TEST", status: "QUEUED", channels: ["EMAIL"], toEmail: "ops@example.com" });
    await ctx.jobs.drain();
    const status = await request(ctx.app).get(`/api/v1/platform/messages/${res.body.data.id}`).set(staff);
    expect(status.body.data).toMatchObject({ status: "SENT", channel: "EMAIL" });
    expect((await request(ctx.app).post("/api/v1/platform/messages/test").set(staff).send({})).status).toBe(400);
    const member = auth((await loginAs(ctx, "+919811111111")).accessToken);
    expect((await request(ctx.app).post("/api/v1/platform/messages/test").set(member).send({ email: "x@y.z" })).status).toBe(403);
  });
});
