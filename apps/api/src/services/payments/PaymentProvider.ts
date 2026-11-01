import type { IncomingHttpHeaders } from "node:http";
import type { PaymentRefundStatus } from "@illuminize/shared";

/** A payment as the provider reports it. */
export interface ProviderPayment {
  id: string;
  orderId: string | null;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  amountMinor: number;
  currency: string;
  errorCode?: string | null;
  errorDescription?: string | null;
}

export interface ProviderRefund {
  id: string;
  paymentId: string;
  amountMinor: number;
  status: PaymentRefundStatus;
}

/** A webhook reduced to what the payment service needs. */
export interface NormalizedWebhookEvent {
  type: string;
  payment?: ProviderPayment;
  refund?: ProviderRefund;
}

export interface PaymentProvider {
  readonly name: "razorpay" | "mock";
  /** Public key the checkout needs (Razorpay key id). */
  readonly publicKeyId: string;
  createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<{ providerOrderId: string }>;
  fetchPayment(providerPaymentId: string): Promise<ProviderPayment>;
  refund(input: { providerPaymentId: string; amountMinor?: number; notes?: Record<string, string> }): Promise<ProviderRefund>;
  /** The signature the checkout returns for (order, payment). */
  verifyCheckoutSignature(input: { providerOrderId: string; providerPaymentId: string; signature: string }): boolean;
  /** Checks the webhook signature over the exact raw body. */
  verifyWebhook(raw: Buffer, headers: IncomingHttpHeaders): boolean;
  /** Stable id for the delivery (providers retry; we process each event once). */
  webhookEventId(raw: Buffer, headers: IncomingHttpHeaders): string;
  /** Normalises a stored webhook payload. */
  normalizeWebhook(payload: unknown): NormalizedWebhookEvent;
}

/** A provider API failure; retryable ones (network, 429, 5xx) are worth trying again. */
export class PaymentProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(`${provider}: ${message}`);
    this.name = "PaymentProviderError";
  }
}
