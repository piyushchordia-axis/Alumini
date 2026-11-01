import { createHash, randomUUID } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { NormalizedWebhookEvent, PaymentProvider, ProviderPayment, ProviderRefund } from "./PaymentProvider";
import { hmacSha256Hex, signaturesMatch } from "./signatures";

const KEY_SECRET = "mock-key-secret";
export const MOCK_WEBHOOK_SECRET = "mock-webhook-secret";


/**
 * Development and test stand-in for Razorpay with the same contract. Stateless: the payment id encodes its order,
 * amount, currency and status, so the API and a separate worker agree without sharing memory. Never used in production.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock" as const;
  readonly publicKeyId = "mock_key";

  async createOrder(input: { amountMinor: number; currency: string; receipt: string }) {
    return { providerOrderId: `mock_order_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
  }

  /** What a successful checkout would return for an order (status defaults to captured). */
  simulateCheckout(order: { providerOrderId: string; amountMinor: number; currency: string }, status: ProviderPayment["status"] = "captured") {
    // "order|amount|currency|status", kept short like real payment ids.
    const providerPaymentId = `mock_pay_${Buffer.from([order.providerOrderId, order.amountMinor, order.currency, status].join("|")).toString("base64url")}`;
    return { providerPaymentId, signature: hmacSha256Hex(KEY_SECRET, `${order.providerOrderId}|${providerPaymentId}`) };
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    const [orderId, amount, currency, status] = Buffer.from(providerPaymentId.replace(/^mock_pay_/, ""), "base64url").toString().split("|");
    return { id: providerPaymentId, orderId: orderId ?? null, status: (status ?? "failed") as ProviderPayment["status"], amountMinor: Number(amount), currency: currency ?? "INR" };
  }

  async refund(input: { providerPaymentId: string; amountMinor?: number }): Promise<ProviderRefund> {
    const payment = await this.fetchPayment(input.providerPaymentId);
    return { id: `mock_rfnd_${randomUUID().slice(0, 8)}`, paymentId: payment.id, amountMinor: input.amountMinor ?? payment.amountMinor, status: "PROCESSED" };
  }

  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return signaturesMatch(hmacSha256Hex(KEY_SECRET, `${input.providerOrderId}|${input.providerPaymentId}`), input.signature);
  }

  verifyWebhook(raw: Buffer, headers: IncomingHttpHeaders): boolean {
    const given = headers["x-mock-signature"];
    return typeof given === "string" && signaturesMatch(hmacSha256Hex(MOCK_WEBHOOK_SECRET, raw), given);
  }

  webhookEventId(raw: Buffer, headers: IncomingHttpHeaders): string {
    const id = headers["x-mock-event-id"];
    return typeof id === "string" && id ? id : createHash("sha256").update(raw).digest("hex");
  }

  normalizeWebhook(payload: unknown): NormalizedWebhookEvent {
    return payload as NormalizedWebhookEvent;
  }
}
