import type { Config } from "../../config/env";
import type { Logger } from "../../lib/logger";
import { MockPaymentProvider } from "./MockPaymentProvider";
import type { PaymentProvider } from "./PaymentProvider";
import { RazorpayProvider } from "./RazorpayProvider";

export * from "./PaymentProvider";
export { MockPaymentProvider, RazorpayProvider };
export { paymentPurposeHandlers, type PaymentPurposeHandler, type PaymentPurposeRegistry, type PaymentQuote } from "./purposes";

/** PAYMENTS_PROVIDER: razorpay (live or test keys), mock (development default) or disabled (production default). */
export function createPaymentProvider(config: Config, logger: Logger, fetchImpl: typeof fetch = fetch): PaymentProvider | null {
  switch (config.paymentsProvider) {
    case "razorpay":
      return new RazorpayProvider({ keyId: config.RAZORPAY_KEY_ID!, keySecret: config.RAZORPAY_KEY_SECRET!, webhookSecret: config.RAZORPAY_WEBHOOK_SECRET! }, logger, fetchImpl);
    case "mock":
      return new MockPaymentProvider();
    default:
      return null;
  }
}
