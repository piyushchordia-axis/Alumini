import type { PaymentPurpose } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import type { PaymentOrderRow, PaymentRefundRow } from "../../repositories/payments.repo";
import type { TenantContext } from "../../types/request";
import type { ContentActor } from "../content.common";

export interface PaymentQuote {
  amountMinor: number;
  currency: string;
  /** Shown in the checkout and on receipts. */
  description: string;
  metadata?: Record<string, unknown>;
  expiresAt?: Date | null;
}

/**
 * What a payment purpose does. Each runs inside a transaction: quote() prices the order (and may hold capacity),
 * onPaid() fulfils it (called exactly once), onFailed() releases holds, onRefunded() reverses fulfilment.
 */
export interface PaymentPurposeHandler {
  readonly purpose: PaymentPurpose;
  quote(ctx: AppContext, input: { tenantCtx: TenantContext; actor: ContentActor; referenceId: string; body: unknown }, tx: Tx): Promise<PaymentQuote>;
  onPaid(ctx: AppContext, order: PaymentOrderRow, tx: Tx): Promise<void>;
  onFailed?(ctx: AppContext, order: PaymentOrderRow, tx: Tx): Promise<void>;
  onRefunded?(ctx: AppContext, order: PaymentOrderRow, refund: PaymentRefundRow, tx: Tx): Promise<void>;
}

export type PaymentPurposeRegistry = Partial<Record<PaymentPurpose, PaymentPurposeHandler>>;

/** Registered purposes. Wave 3 adds EVENT_TICKET (ticketed events) and DONATION (giving campaigns). */
export const paymentPurposeHandlers: PaymentPurposeRegistry = {};
