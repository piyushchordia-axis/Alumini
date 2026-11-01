import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PaymentPurposeHandler } from "../../src/services/payments";
import { MockPaymentProvider, RazorpayProvider } from "../../src/services/payments";
import { createPaymentOrder, refundPayment } from "../../src/services/payments/payment.service";
import { createLogger } from "../../src/lib/logger";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** A donation purpose that records what happened to its orders. */
function donationHandler() {
  const calls = { paid: [] as string[], failed: [] as string[], refunded: [] as string[] };
  const handler: PaymentPurposeHandler = {
    purpose: "DONATION",
    async quote(_ctx, input) {
      const amount = (input.body as { amountMinor?: number } | undefined)?.amountMinor ?? 50_000;
      return { amountMinor: amount, currency: "INR", description: `Donation to ${input.referenceId}` };
    },
    async onPaid(_ctx, order) {
      calls.paid.push(order.id);
    },
    async onFailed(_ctx, order) {
      calls.failed.push(order.id);
    },
    async onRefunded(_ctx, order) {
      calls.refunded.push(order.id);
    },
  };
  return { handler, calls };
}

/** Fake Razorpay API holding payments by id. */
function fakeRazorpay() {
  const payments = new Map<string, { id: string; order_id: string; status: string; amount: number; currency: string }>();
  let orders = 0;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (u.endsWith("/v1/orders")) return json(200, { id: `order_${++orders}` });
    const refund = /\/v1\/payments\/([^/]+)\/refund$/.exec(u);
    if (refund) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { amount?: number };
      return json(200, { id: `rfnd_${Date.now()}`, payment_id: refund[1], amount: body.amount, status: "processed" });
    }
    const pay = /\/v1\/payments\/([^/]+)$/.exec(u);
    if (pay && payments.has(pay[1]!)) return json(200, payments.get(pay[1]!));
    return json(404, { error: { description: "not found" } });
  }) as typeof fetch;
  return { payments, impl };
}

const KEY_SECRET = "key-secret";
const HOOK_SECRET = "hook-secret";
const sign = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

describe.skipIf(!dbAvailable)("payments", () => {
  let ctx: TestContext;
  let donation: ReturnType<typeof donationHandler>;
  let rzp: ReturnType<typeof fakeRazorpay>;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    donation = donationHandler();
    rzp = fakeRazorpay();
    ctx.payments = {
      provider: new RazorpayProvider({ keyId: "rzp_test_1", keySecret: KEY_SECRET, webhookSecret: HOOK_SECRET }, createLogger("silent", false), rzp.impl),
      purposes: { DONATION: donation.handler },
    };
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function startDonation(amountMinor = 50_000) {
    const { tenant, settings } = await createTenant(ctx, { slug: `pay-${Math.random().toString(36).slice(2, 8)}` });
    const member = await memberSession(ctx, tenant.id);
    const tenantCtx = { tenant, settings } as never;
    const order = await createPaymentOrder(ctx, { tenantCtx, actor: { userId: member.user.id, sid: "s", isPlatformAdmin: false, membership: member.membership }, purpose: "DONATION", referenceId: "campaign-1", body: { amountMinor } });
    return { tenant, member, order };
  }
  const capture = (orderId: string, paymentId: string, amount = 50_000, status = "captured") => rzp.payments.set(paymentId, { id: paymentId, order_id: orderId, status, amount, currency: "INR" });

  it("creates an order with checkout parameters", async () => {
    const { order } = await startDonation();
    expect(order).toMatchObject({ status: "CREATED", amountMinor: 50_000, currency: "INR", checkout: { provider: "razorpay", keyId: "rzp_test_1", orderId: "order_1", amount: 50_000 } });
  });

  it("confirms a captured payment once, and only with a valid signature", async () => {
    const { tenant, member, order } = await startDonation();
    capture("order_1", "pay_1");
    const url = `/api/v1/t/${tenant.slug}/payments/${order.id}/confirm`;
    const bad = await request(ctx.app).post(url).set(member.headers).send({ providerPaymentId: "pay_1", signature: "0".repeat(64) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("PAYMENT_SIGNATURE_INVALID");

    const good = { providerPaymentId: "pay_1", signature: sign(KEY_SECRET, "order_1|pay_1") };
    const res = await request(ctx.app).post(url).set(member.headers).send(good);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "PAID", checkout: null });
    expect(res.body.data.paidAt).not.toBeNull();
    expect((await request(ctx.app).post(url).set(member.headers).send(good)).body.data.status).toBe("PAID");
    expect(donation.calls.paid).toEqual([order.id]);
  });

  it("waits for capture on authorised-only payments and refuses mismatched ones", async () => {
    const { tenant, member, order } = await startDonation();
    capture("order_1", "pay_auth", 50_000, "authorized");
    const res = await request(ctx.app)
      .post(`/api/v1/t/${tenant.slug}/payments/${order.id}/confirm`)
      .set(member.headers)
      .send({ providerPaymentId: "pay_auth", signature: sign(KEY_SECRET, "order_1|pay_auth") });
    expect(res.body.data.status).toBe("ATTEMPTED");
    expect(donation.calls.paid).toEqual([]);

    capture("order_1", "pay_cheap", 100);
    const cheap = await request(ctx.app)
      .post(`/api/v1/t/${tenant.slug}/payments/${order.id}/confirm`)
      .set(member.headers)
      .send({ providerPaymentId: "pay_cheap", signature: sign(KEY_SECRET, "order_1|pay_cheap") });
    expect(cheap.status).toBe(400);
    expect(donation.calls.paid).toEqual([]);
  });

  it("shows an order only to its payer", async () => {
    const { tenant, order } = await startDonation();
    const other = await memberSession(ctx, tenant.id);
    expect((await request(ctx.app).get(`/api/v1/t/${tenant.slug}/payments/${order.id}`).set(other.headers)).status).toBe(404);
  });

  it("applies webhooks once per event and keeps fulfilment to a single call", async () => {
    const { tenant, member, order } = await startDonation();
    capture("order_1", "pay_9");
    await request(ctx.app).post(`/api/v1/t/${tenant.slug}/payments/${order.id}/confirm`).set(member.headers).send({ providerPaymentId: "pay_9", signature: sign(KEY_SECRET, "order_1|pay_9") });

    // order.paid arrives afterwards; extra whitespace proves the signature is checked over the raw bytes.
    const raw = `{"event":"order.paid",  "payload":{"payment":{"entity":{"id":"pay_9","order_id":"order_1","status":"captured","amount":50000,"currency":"INR"}}}}`;
    const send = (body: string, signature: string, eventId: string) =>
      request(ctx.app).post("/api/v1/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", signature).set("X-Razorpay-Event-Id", eventId).send(body);
    expect((await send(raw, sign(HOOK_SECRET, raw), "evt_1")).body.data).toEqual({ received: true, duplicate: false });
    expect((await send(raw, sign(HOOK_SECRET, raw), "evt_1")).body.data).toEqual({ received: true, duplicate: true });
    expect((await send(raw, "bad", "evt_2")).status).toBe(400);
    await ctx.jobs.drain();
    expect(donation.calls.paid).toEqual([order.id]);
  });

  it("marks failed then captured payments paid, and refunds through the provider", async () => {
    const { tenant, order } = await startDonation();
    const hook = async (payload: object, eventId: string) => {
      const raw = JSON.stringify(payload);
      await request(ctx.app).post("/api/v1/webhooks/razorpay").set("Content-Type", "application/json").set("X-Razorpay-Signature", sign(HOOK_SECRET, raw)).set("X-Razorpay-Event-Id", eventId).send(raw);
      await ctx.jobs.drain();
    };
    const entity = (status: string, id: string) => ({ payment: { entity: { id, order_id: "order_1", status, amount: 50_000, currency: "INR", error_code: status === "failed" ? "BAD_REQUEST_ERROR" : null } } });
    await hook({ event: "payment.failed", payload: entity("failed", "pay_f") }, "evt_f");
    expect(donation.calls.failed).toEqual([order.id]);
    // A later successful attempt on the same order still pays it.
    await hook({ event: "payment.captured", payload: entity("captured", "pay_ok") }, "evt_ok");
    expect(donation.calls.paid).toEqual([order.id]);

    const refund = await refundPayment(ctx, { orderId: order.id, amountMinor: 20_000, actorUserId: (await memberSession(ctx, tenant.id)).user.id });
    expect(refund).toMatchObject({ amountMinor: 20_000, status: "PROCESSED" });
    const [updated] = await ctx.db.query.paymentOrders.findMany({ where: (o, { eq }) => eq(o.id, order.id) });
    expect(updated).toMatchObject({ status: "PARTIALLY_REFUNDED", amountRefundedMinor: 20_000 });
    expect(donation.calls.refunded).toEqual([order.id]);
    await expect(refundPayment(ctx, { orderId: order.id, amountMinor: 40_000, actorUserId: updated!.payerUserId! })).rejects.toThrow(/at most 30000/);
  });

  it("returns 503 when payments are disabled, and offers a mock checkout in development", async () => {
    const { tenant, member, order } = await startDonation();
    ctx.payments = { provider: null, purposes: {} };
    expect((await request(ctx.app).get(`/api/v1/t/${tenant.slug}/payments/${order.id}`).set(member.headers)).body.error.code).toBe("PAYMENTS_DISABLED");

    ctx.payments = { provider: new MockPaymentProvider(), purposes: { DONATION: donation.handler } };
    const mockOrder = await createPaymentOrder(ctx, {
      tenantCtx: { tenant } as never,
      actor: { userId: member.user.id, sid: "s", isPlatformAdmin: false, membership: member.membership },
      purpose: "DONATION",
      referenceId: "campaign-2",
    });
    const checkout = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/payments/${mockOrder.id}/mock-checkout`).set(member.headers);
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200);
    const confirmed = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/payments/${mockOrder.id}/confirm`).set(member.headers).send(checkout.body.data);
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.status).toBe("PAID");
  });
});
