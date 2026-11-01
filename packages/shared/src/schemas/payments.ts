import { z } from "zod";

/** Sent by the app after the checkout succeeds; the server verifies the signature and the payment with the provider. */
export const paymentConfirmSchema = z.object({
  providerPaymentId: z.string().trim().min(1).max(100),
  signature: z.string().trim().min(1).max(200),
});
export type PaymentConfirmInput = z.infer<typeof paymentConfirmSchema>;
