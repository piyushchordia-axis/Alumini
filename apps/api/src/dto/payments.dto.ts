import type { PaymentOrderDto } from "@illuminize/shared";
import type { PaymentOrderRow } from "../repositories/payments.repo";
import type { PaymentProvider } from "../services/payments/PaymentProvider";

const PAYABLE = new Set(["CREATED", "ATTEMPTED"]);

/** The order as the payer sees it, with checkout parameters while it can still be paid. */
export function toPaymentOrderDto(o: PaymentOrderRow, provider: PaymentProvider | null, merchantName: string): PaymentOrderDto {
  const payable = PAYABLE.has(o.status) && !!o.providerOrderId && !!provider && provider.name === o.provider && (!o.expiresAt || o.expiresAt > new Date());
  return {
    id: o.id,
    purpose: o.purpose,
    referenceId: o.referenceId,
    amountMinor: o.amountMinor,
    currency: o.currency,
    status: o.status,
    amountRefundedMinor: o.amountRefundedMinor,
    description: o.description,
    paidAt: o.paidAt ? o.paidAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    checkout: payable
      ? {
          provider: provider!.name,
          keyId: provider!.publicKeyId,
          orderId: o.providerOrderId!,
          amount: o.amountMinor,
          currency: o.currency,
          name: merchantName,
          description: o.description ?? "",
          notes: { paymentOrderId: o.id },
        }
      : null,
  };
}
