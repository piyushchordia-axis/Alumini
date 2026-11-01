import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../src/lib/logger";
import { MockPaymentProvider, PaymentProviderError, RazorpayProvider } from "../../src/services/payments";

const cfg = { keyId: "rzp_test_123", keySecret: "key-secret", webhookSecret: "hook-secret" };
const logger = createLogger("silent", false);
const hmac = (secret: string, data: string) => createHmac("sha256", secret).update(data).digest("hex");

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = handler(String(url), init ?? {});
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { calls, impl };
}

describe("Razorpay provider", () => {
  it("verifies checkout signatures computed as Razorpay does", () => {
    const rp = new RazorpayProvider(cfg, logger);
    const signature = hmac("key-secret", "order_A|pay_B");
    expect(rp.verifyCheckoutSignature({ providerOrderId: "order_A", providerPaymentId: "pay_B", signature })).toBe(true);
    expect(rp.verifyCheckoutSignature({ providerOrderId: "order_A", providerPaymentId: "pay_C", signature })).toBe(false);
    expect(rp.verifyCheckoutSignature({ providerOrderId: "order_A", providerPaymentId: "pay_B", signature: signature.slice(0, -2) })).toBe(false);
    expect(rp.verifyCheckoutSignature({ providerOrderId: "order_A", providerPaymentId: "pay_B", signature: hmac("wrong", "order_A|pay_B") })).toBe(false);
  });

  it("verifies webhook signatures over the exact raw body", () => {
    const rp = new RazorpayProvider(cfg, logger);
    const raw = Buffer.from('{"event":"payment.captured",  "payload":{}}');
    expect(rp.verifyWebhook(raw, { "x-razorpay-signature": hmac("hook-secret", raw.toString()) })).toBe(true);
    // Re-serialising the JSON (dropping the extra spaces) breaks the signature.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(raw.toString())));
    expect(rp.verifyWebhook(reserialised, { "x-razorpay-signature": hmac("hook-secret", raw.toString()) })).toBe(false);
    expect(rp.verifyWebhook(raw, {})).toBe(false);
    expect(rp.webhookEventId(raw, { "x-razorpay-event-id": "evt_1" })).toBe("evt_1");
    expect(rp.webhookEventId(raw, {})).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("creates orders with basic auth and the amount in paise", async () => {
    const f = fakeFetch(() => ({ status: 200, body: { id: "order_NEW" } }));
    const rp = new RazorpayProvider(cfg, logger, f.impl);
    const receipt = `po_${"a".repeat(60)}`;
    expect(await rp.createOrder({ amountMinor: 49900, currency: "INR", receipt, notes: { paymentOrderId: "x" } })).toEqual({ providerOrderId: "order_NEW" });
    expect(f.calls[0]!.url).toBe("https://api.razorpay.com/v1/orders");
    expect(f.calls[0]!.init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from("rzp_test_123:key-secret").toString("base64")}` });
    const body = JSON.parse(String(f.calls[0]!.init.body));
    expect(body).toMatchObject({ amount: 49900, currency: "INR", notes: { paymentOrderId: "x" } });
    expect(body.receipt.length).toBeLessThanOrEqual(40);
  });

  it("maps payments and refunds, and classifies errors", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/refund")
        ? { status: 200, body: { id: "rfnd_1", payment_id: "pay_1", amount: 100, status: "processed" } }
        : { status: 200, body: { id: "pay_1", order_id: "order_1", status: "captured", amount: 49900, currency: "INR" } },
    );
    const rp = new RazorpayProvider(cfg, logger, f.impl);
    expect(await rp.fetchPayment("pay_1")).toMatchObject({ id: "pay_1", orderId: "order_1", status: "captured", amountMinor: 49900 });
    expect(await rp.refund({ providerPaymentId: "pay_1", amountMinor: 100 })).toEqual({ id: "rfnd_1", paymentId: "pay_1", amountMinor: 100, status: "PROCESSED" });

    const fail = async (status: number) => new RazorpayProvider(cfg, logger, fakeFetch(() => ({ status, body: { error: { description: "nope" } } })).impl).fetchPayment("pay_x").catch((e: unknown) => e);
    expect(await fail(503)).toMatchObject({ retryable: true });
    expect(await fail(400)).toMatchObject({ retryable: false, message: "razorpay: nope" });
    const offline = await new RazorpayProvider(cfg, logger, (async () => Promise.reject(new Error("down"))) as typeof fetch).fetchPayment("p").catch((e: unknown) => e);
    expect(offline).toBeInstanceOf(PaymentProviderError);
    expect((offline as PaymentProviderError).retryable).toBe(true);
  });

  it("normalises webhook payloads", () => {
    const rp = new RazorpayProvider(cfg, logger);
    expect(rp.normalizeWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", order_id: "order_1", status: "captured", amount: 500, currency: "INR" } } } })).toEqual({
      type: "payment.captured",
      payment: { id: "pay_1", orderId: "order_1", status: "captured", amountMinor: 500, currency: "INR", errorCode: null, errorDescription: null },
    });
    expect(rp.normalizeWebhook({ event: "refund.processed", payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_1", amount: 200, status: "processed" } } } })).toMatchObject({
      type: "refund.processed",
      refund: { id: "rfnd_1", paymentId: "pay_1", amountMinor: 200, status: "PROCESSED" },
    });
  });
});

describe("mock payment provider", () => {
  it("round-trips a simulated checkout without shared state", async () => {
    const mock = new MockPaymentProvider();
    const { providerOrderId } = await mock.createOrder({ amountMinor: 1000, currency: "INR", receipt: "r" });
    const checkout = mock.simulateCheckout({ providerOrderId, amountMinor: 1000, currency: "INR" });
    expect(mock.verifyCheckoutSignature({ providerOrderId, ...checkout })).toBe(true);
    expect(await new MockPaymentProvider().fetchPayment(checkout.providerPaymentId)).toMatchObject({ orderId: providerOrderId, amountMinor: 1000, status: "captured" });
  });
});
