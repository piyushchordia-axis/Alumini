import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { PaymentRefundStatus } from "@illuminize/shared";
import type { Logger } from "../../lib/logger";
import { PaymentProviderError, type NormalizedWebhookEvent, type PaymentProvider, type ProviderPayment, type ProviderRefund } from "./PaymentProvider";
import { hmacSha256Hex, signaturesMatch } from "./signatures";

const API = "https://api.razorpay.com/v1";

interface RazorpayPayment {
  id: string;
  order_id: string | null;
  status: ProviderPayment["status"];
  amount: number;
  currency: string;
  error_code?: string | null;
  error_description?: string | null;
}
interface RazorpayRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: "pending" | "processed" | "failed";
}

const toPayment = (p: RazorpayPayment): ProviderPayment => ({
  id: p.id,
  orderId: p.order_id ?? null,
  status: p.status,
  amountMinor: p.amount,
  currency: p.currency,
  errorCode: p.error_code ?? null,
  errorDescription: p.error_description ?? null,
});
const refundStatus = (s: RazorpayRefund["status"]): PaymentRefundStatus => (s === "processed" ? "PROCESSED" : s === "failed" ? "FAILED" : "PENDING");
const toRefund = (r: RazorpayRefund): ProviderRefund => ({ id: r.id, paymentId: r.payment_id, amountMinor: r.amount, status: refundStatus(r.status) });

/**
 * Razorpay over its REST API (no SDK). Orders are created server-side; the checkout returns a payment id and a
 * signature, verified here and then confirmed by fetching the payment. Webhooks are signed over the raw body.
 * Enable auto-capture in the Razorpay dashboard so payments end up "captured".
 * Docs: https://razorpay.com/docs/api/orders/ · https://razorpay.com/docs/webhooks/validate-test/
 */
export class RazorpayProvider implements PaymentProvider {
  readonly name = "razorpay" as const;
  readonly publicKeyId: string;

  constructor(
    private readonly cfg: { keyId: string; keySecret: string; webhookSecret: string },
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.publicKeyId = cfg.keyId;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError(this.name, "network error", true);
    }
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } } & T;
    if (!res.ok) {
      this.logger.warn({ status: res.status, error: json.error }, "Razorpay API error");
      throw new PaymentProviderError(this.name, json.error?.description ?? `HTTP ${res.status}`, res.status === 429 || res.status >= 500, res.status);
    }
    return json;
  }

  async createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }) {
    const order = await this.call<{ id: string }>("POST", "/orders", { amount: input.amountMinor, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: input.notes });
    return { providerOrderId: order.id };
  }

  async fetchPayment(providerPaymentId: string): Promise<ProviderPayment> {
    return toPayment(await this.call<RazorpayPayment>("GET", `/payments/${encodeURIComponent(providerPaymentId)}`));
  }

  async refund(input: { providerPaymentId: string; amountMinor?: number; notes?: Record<string, string> }): Promise<ProviderRefund> {
    return toRefund(
      await this.call<RazorpayRefund>("POST", `/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
        ...(input.amountMinor ? { amount: input.amountMinor } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
      }),
    );
  }

  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean {
    return signaturesMatch(hmacSha256Hex(this.cfg.keySecret, `${input.providerOrderId}|${input.providerPaymentId}`), input.signature);
  }

  verifyWebhook(raw: Buffer, headers: IncomingHttpHeaders): boolean {
    const given = headers["x-razorpay-signature"];
    return typeof given === "string" && signaturesMatch(hmacSha256Hex(this.cfg.webhookSecret, raw), given);
  }

  webhookEventId(raw: Buffer, headers: IncomingHttpHeaders): string {
    const id = headers["x-razorpay-event-id"];
    return typeof id === "string" && id ? id : `sha256:${createHash("sha256").update(raw).digest("hex")}`;
  }

  normalizeWebhook(payload: unknown): NormalizedWebhookEvent {
    const p = payload as { event?: string; payload?: { payment?: { entity?: RazorpayPayment }; refund?: { entity?: RazorpayRefund } } };
    const payment = p.payload?.payment?.entity;
    const refund = p.payload?.refund?.entity;
    return { type: p.event ?? "unknown", ...(payment ? { payment: toPayment(payment) } : {}), ...(refund ? { refund: toRefund(refund) } : {}) };
  }
}
