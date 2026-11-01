import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { emailVerifications, outboundMessages, users } from "../../src/db/schema";
import { findMessage } from "../../src/repositories/messages.repo";
import type { ChannelSender, MessageSendError, RenderedMessage } from "../../src/services/messages/types";
import { auth, loginAs } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

class CapturingEmail implements ChannelSender<"EMAIL"> {
  readonly channel = "EMAIL" as const;
  readonly provider = "capture";
  readonly sent: Array<Extract<RenderedMessage, { channel: "EMAIL" }>> = [];
  readonly failures: MessageSendError[] = [];
  async send(m: Extract<RenderedMessage, { channel: "EMAIL" }>) {
    const f = this.failures.shift();
    if (f) throw f;
    this.sent.push(m);
    return { providerMessageId: `email-${this.sent.length}` };
  }
}

const tokenFrom = (m: { text: string }) => decodeURIComponent(/token=([^\s&]+)/.exec(m.text)![1]!);

describe.skipIf(!dbAvailable)("member email", () => {
  let ctx: TestContext;
  const email = new CapturingEmail();
  beforeAll(async () => {
    ctx = await createTestContext({}, { messageSenders: { EMAIL: email } });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    email.sent.length = 0;
    email.failures.length = 0;
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function signIn(phone = "+919811100001") {
    const s = await loginAs(ctx, phone);
    return { token: s.accessToken, user: s.user, h: auth(s.accessToken) };
  }

  it("sends a confirmation link and only sets the address once it is opened", async () => {
    const { h, user } = await signIn();
    const res = await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "  Asha@Example.COM " });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ email: null, verifiedAt: null, pending: { email: "asha@example.com" } });
    expect(email.sent).toHaveLength(0); // sent by a job, not inside the request

    await ctx.jobs.drain();
    expect(email.sent).toHaveLength(1);
    const sent = email.sent[0]!;
    expect(sent.to).toBe("asha@example.com");
    expect(sent.text).toContain("http://localhost:5173/verify-email?token=");
    expect(sent.html).toContain("Confirm email address");

    // The link is wiped from the stored payload once sent.
    const [row] = await ctx.db.select().from(outboundMessages).where(eq(outboundMessages.type, "EMAIL_VERIFY"));
    expect(row!.status).toBe("SENT");
    expect(row!.payload).not.toHaveProperty("link");
    expect(row!.payload).toHaveProperty("verificationId");

    const verify = await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: tokenFrom(sent) });
    expect(verify.status).toBe(200);
    expect(verify.body.data).toEqual({ email: "asha@example.com" });

    const me = await request(ctx.app).get("/api/v1/me").set(h);
    expect(me.body.data.user).toMatchObject({ email: "asha@example.com", emailVerifiedAt: expect.any(String) });
    const status = await request(ctx.app).get("/api/v1/me/email").set(h);
    expect(status.body.data).toMatchObject({ email: "asha@example.com", pending: null });
    const [u] = await ctx.db.select().from(users).where(eq(users.id, user.id));
    expect(u!.email).toBe("asha@example.com");
  });

  it("rejects a used, expired or unknown token", async () => {
    const { h } = await signIn();
    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "a@example.com" });
    await ctx.jobs.drain();
    const token = tokenFrom(email.sent[0]!);
    expect((await request(ctx.app).post("/api/v1/auth/email/verify").send({ token })).status).toBe(200);
    const again = await request(ctx.app).post("/api/v1/auth/email/verify").send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("EMAIL_TOKEN_INVALID");
    expect((await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: "x".repeat(43) })).body.error.code).toBe("EMAIL_TOKEN_INVALID");

    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "b@example.com" });
    await ctx.jobs.drain();
    await ctx.db.update(emailVerifications).set({ expiresAt: new Date(Date.now() - 1000) });
    const expired = await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: tokenFrom(email.sent[1]!) });
    expect(expired.body.error.code).toBe("EMAIL_TOKEN_INVALID");
  });

  it("keeps the confirmed address until a new one is confirmed, and a newer request voids the older link", async () => {
    const { h } = await signIn();
    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "old@example.com" });
    await ctx.jobs.drain();
    await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: tokenFrom(email.sent[0]!) });

    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "first@example.com" });
    await ctx.jobs.drain();
    const firstToken = tokenFrom(email.sent[1]!);
    const second = await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "second@example.com" });
    expect(second.body.data).toMatchObject({ email: "old@example.com", pending: { email: "second@example.com" } });

    expect((await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: firstToken })).status).toBe(400);
    await ctx.jobs.drain();
    const secondToken = tokenFrom(email.sent[2]!);
    expect((await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: secondToken })).body.data.email).toBe("second@example.com");
  });

  it("cancels a queued confirmation that a newer request replaced before it was sent", async () => {
    const { h } = await signIn();
    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "one@example.com" });
    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "two@example.com" });
    await ctx.jobs.drain();
    expect(email.sent.map((m) => m.to)).toEqual(["two@example.com"]);
    const rows = await ctx.db.select().from(outboundMessages);
    expect(rows.map((r) => r.status).sort()).toEqual(["CANCELLED", "SENT"]);
    const cancelled = rows.find((r) => r.status === "CANCELLED")!;
    expect(cancelled.payload).not.toHaveProperty("link");
    expect((await findMessage(ctx.db, cancelled.id))!.lastError).toBe("confirmation no longer pending");
  });

  it("asking for the already confirmed address sends nothing; removing clears it", async () => {
    const { h } = await signIn();
    await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "a@example.com" });
    await ctx.jobs.drain();
    await request(ctx.app).post("/api/v1/auth/email/verify").send({ token: tokenFrom(email.sent[0]!) });
    const same = await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "A@example.com" });
    expect(same.body.data).toMatchObject({ email: "a@example.com", pending: null });
    await ctx.jobs.drain();
    expect(email.sent).toHaveLength(1);

    const removed = await request(ctx.app).delete("/api/v1/me/email").set(h);
    expect(removed.body.data).toEqual({ email: null, verifiedAt: null, pending: null });
  });

  it("validates the address and requires sign-in", async () => {
    const { h } = await signIn();
    expect((await request(ctx.app).post("/api/v1/me/email").set(h).send({ email: "not-an-email" })).status).toBe(400);
    expect((await request(ctx.app).post("/api/v1/me/email").send({ email: "a@example.com" })).status).toBe(401);
  });

  it("limits confirmation emails per address and per user", async () => {
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      const a = await signIn("+919811100002");
      for (let i = 0; i < 3; i++) expect((await request(ctx.app).post("/api/v1/me/email").set(a.h).send({ email: `u${i}@example.com` })).status).toBe(200);
      const fourth = await request(ctx.app).post("/api/v1/me/email").set(a.h).send({ email: "u4@example.com" });
      expect(fourth.status).toBe(429); // 3 per user per hour

      const b = await signIn("+919811100003");
      const c = await signIn("+919811100004");
      // Same address requested by different accounts: 3 per address per day across all of them (u0 was used once above).
      expect((await request(ctx.app).post("/api/v1/me/email").set(b.h).send({ email: "u0@example.com" })).status).toBe(200);
      expect((await request(ctx.app).post("/api/v1/me/email").set(c.h).send({ email: "u0@example.com" })).status).toBe(200);
      expect((await request(ctx.app).post("/api/v1/me/email").set(c.h).send({ email: "u0@example.com" })).status).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});

describe.skipIf(!dbAvailable)("member email without an email provider", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({}, { messageSenders: {} });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("answers 503 EMAIL_NOT_CONFIGURED", async () => {
    await ctx.truncateAll();
    const { accessToken } = await loginAs(ctx, "+919811100009");
    const res = await request(ctx.app).post("/api/v1/me/email").set(auth(accessToken)).send({ email: "a@example.com" });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("EMAIL_NOT_CONFIGURED");
  });
});
