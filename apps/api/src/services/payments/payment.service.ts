import { randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { PaymentOrderDto, PaymentPurpose } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { toPaymentOrderDto } from "../../dto/payments.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import {
  findPaymentOrder,
  findPaymentOrderById,
  findPaymentOrderByProviderOrderId,
  findPaymentOrderByProviderPaymentId,
  findWebhookEvent,
  insertPaymentOrder,
  insertWebhookEvent,
  SETTLED_STATUSES,
  sumProcessedRefunds,
  transitionPaymentOrder,
  updatePaymentOrder,
  updateWebhookEvent,
  upsertRefund,
  type PaymentOrderRow,
  type PaymentRefundRow,
} from "../../repositories/payments.repo";
import type { TenantContext } from "../../types/request";
import type { ContentActor } from "../content.common";
import { PaymentProviderError, type PaymentProvider, type ProviderPayment, type ProviderRefund } from "./PaymentProvider";

function requireProvider(ctx: AppContext): PaymentProvider {
  if (!ctx.payments.provider) throw new AppError(503, "PAYMENTS_DISABLED", "Online payments are not enabled");
  return ctx.payments.provider;
}

function providerError(err: unknown): AppError {
  if (err instanceof PaymentProviderError) return new AppError(502, "PAYMENT_PROVIDER_ERROR", "The payment provider could not be reached. Please try again.");
  return err as AppError;
}

/**
 * Starts a payment: the purpose prices it inside a transaction, then the provider order is created outside it (no
 * external calls while holding locks). Returns the order with the parameters the checkout needs.
 */
export async function createPaymentOrder(
  ctx: AppContext,
  input: { tenantCtx: TenantContext; actor: ContentActor; purpose: PaymentPurpose; referenceId: string; body?: unknown },
): Promise<PaymentOrderDto> {
  const provider = requireProvider(ctx);
  const handler = ctx.payments.purposes[input.purpose];
  if (!handler) throw AppError.badRequest("Payments for this are not available");
  const tenantId = input.tenantCtx.tenant.id;

  const order = await runInTransaction(ctx, async (tx) => {
    const quote = await handler.quote(ctx, { tenantCtx: input.tenantCtx, actor: input.actor, referenceId: input.referenceId, body: input.body }, tx);
    if (!Number.isInteger(quote.amountMinor) || quote.amountMinor <= 0) throw AppError.badRequest("Nothing to pay");
    return insertPaymentOrder(tx, {
      tenantId,
      purpose: input.purpose,
      referenceId: input.referenceId,
      payerMembershipId: input.actor.membership.id,
      payerUserId: input.actor.userId,
      amountMinor: quote.amountMinor,
      currency: quote.currency,
      provider: provider.name,
      receipt: `po_${randomBytes(12).toString("hex")}`,
      description: quote.description,
      metadata: quote.metadata ?? {},
      expiresAt: quote.expiresAt ?? null,
    });
  });

  try {
    const { providerOrderId } = await provider.createOrder({
      amountMinor: order.amountMinor,
      currency: order.currency,
      receipt: order.receipt,
      notes: { paymentOrderId: order.id, tenantId, purpose: order.purpose },
    });
    const saved = (await updatePaymentOrder(ctx.db, order.id, { providerOrderId }))!;
    return toPaymentOrderDto(saved, provider, input.tenantCtx.tenant.name);
  } catch (err) {
    await markFailed(ctx, order.id, { code: "PROVIDER_ORDER_FAILED", reason: err instanceof Error ? err.message : "order creation failed" });
    throw providerError(err);
  }
}

export async function getPaymentOrder(ctx: AppContext, tenantCtx: TenantContext, payerMembershipId: string, orderId: string): Promise<PaymentOrderDto> {
  const order = await findPaymentOrder(ctx.db, tenantCtx.tenant.id, orderId);
  if (!order || order.payerMembershipId !== payerMembershipId) throw AppError.notFound("Payment not found");
  return toPaymentOrderDto(order, ctx.payments.provider, tenantCtx.tenant.name);
}

/**
 * Called by the app after the checkout succeeds. Verifies the signature, then asks the provider for the payment and
 * checks it belongs to this order with the same amount. Only a captured payment marks the order paid; an authorised
 * one waits for the provider's webhook. Safe to call more than once.
 */
export async function confirmPayment(
  ctx: AppContext,
  input: { tenantCtx: TenantContext; payerMembershipId: string; orderId: string; providerPaymentId: string; signature: string },
): Promise<PaymentOrderDto> {
  const provider = requireProvider(ctx);
  const order = await findPaymentOrder(ctx.db, input.tenantCtx.tenant.id, input.orderId);
  if (!order || order.payerMembershipId !== input.payerMembershipId) throw AppError.notFound("Payment not found");
  const dto = async () => toPaymentOrderDto((await findPaymentOrderById(ctx.db, order.id))!, provider, input.tenantCtx.tenant.name);
  if (SETTLED_STATUSES.includes(order.status)) return dto();
  if (!order.providerOrderId || order.provider !== provider.name) throw AppError.conflict("This payment cannot be confirmed");
  if (!provider.verifyCheckoutSignature({ providerOrderId: order.providerOrderId, providerPaymentId: input.providerPaymentId, signature: input.signature })) {
    throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "The payment could not be verified");
  }
  let payment: ProviderPayment;
  try {
    payment = await provider.fetchPayment(input.providerPaymentId);
  } catch (err) {
    throw providerError(err);
  }
  await applyProviderPayment(ctx, order, payment);
  return dto();
}

/** Brings an order in line with what the provider says about one of its payments. */
async function applyProviderPayment(ctx: AppContext, order: PaymentOrderRow, payment: ProviderPayment): Promise<void> {
  if (payment.orderId !== order.providerOrderId || payment.amountMinor !== order.amountMinor || payment.currency !== order.currency) {
    ctx.logger.warn({ orderId: order.id, payment }, "Provider payment does not match the order");
    await updatePaymentOrder(ctx.db, order.id, { failureCode: "MISMATCH", failureReason: "Payment does not match the order" });
    throw AppError.badRequest("The payment does not match this order");
  }
  switch (payment.status) {
    case "captured":
      await markPaid(ctx, order.id, payment);
      return;
    case "authorized":
      await transitionPaymentOrder(ctx.db, order.id, { from: ["CREATED"] }, { status: "ATTEMPTED", providerPaymentId: payment.id });
      return;
    case "failed":
      await markFailed(ctx, order.id, { code: payment.errorCode ?? "FAILED", reason: payment.errorDescription ?? "Payment failed", providerPaymentId: payment.id });
      return;
    default:
      return;
  }
}

/** Marks the order paid and fulfils it, exactly once however many confirms and webhooks arrive. */
export async function markPaid(ctx: AppContext, orderId: string, payment: ProviderPayment): Promise<boolean> {
  return runInTransaction(ctx, async (tx) => {
    const order = await transitionPaymentOrder(
      tx,
      orderId,
      { notFrom: SETTLED_STATUSES },
      { status: "PAID", providerPaymentId: payment.id, paidAt: new Date(), failureCode: null, failureReason: null },
    );
    if (!order) return false;
    await ctx.payments.purposes[order.purpose]?.onPaid(ctx, order, tx);
    return true;
  });
}

async function markFailed(ctx: AppContext, orderId: string, f: { code: string; reason: string; providerPaymentId?: string }): Promise<void> {
  await runInTransaction(ctx, async (tx) => {
    const order = await transitionPaymentOrder(
      tx,
      orderId,
      { from: ["CREATED", "ATTEMPTED"] },
      { status: "FAILED", failureCode: f.code, failureReason: f.reason, ...(f.providerPaymentId ? { providerPaymentId: f.providerPaymentId } : {}) },
    );
    if (order) await ctx.payments.purposes[order.purpose]?.onFailed?.(ctx, order, tx);
  });
}

/**
 * Stores a provider webhook (once per event id) after checking its signature over the raw body, and queues it for
 * processing. Returns whether it was a repeat delivery.
 */
export async function recordPaymentWebhook(ctx: AppContext, providerName: string, raw: Buffer, headers: IncomingHttpHeaders): Promise<{ duplicate: boolean }> {
  const provider = ctx.payments.provider;
  if (!provider || provider.name !== providerName) throw AppError.notFound("Unknown webhook");
  if (!provider.verifyWebhook(raw, headers)) throw new AppError(400, "PAYMENT_SIGNATURE_INVALID", "Invalid webhook signature");
  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8"));
  } catch {
    throw AppError.badRequest("Webhook body is not JSON");
  }
  const event = await insertWebhookEvent(ctx.db, {
    provider: provider.name,
    eventId: provider.webhookEventId(raw, headers),
    eventType: provider.normalizeWebhook(payload).type,
    payload,
  });
  if (!event) return { duplicate: true };
  await ctx.jobs.enqueue("payments.webhook", { webhookEventId: event.id }, { jobId: `pwh-${event.id}` });
  return { duplicate: false };
}

/** The payments.webhook job: applies one stored webhook to its order. */
export async function processPaymentWebhook(ctx: AppContext, webhookEventId: string): Promise<void> {
  const row = await findWebhookEvent(ctx.db, webhookEventId);
  if (!row || row.processedAt) return;
  const provider = ctx.payments.provider;
  if (!provider || provider.name !== row.provider) return;
  try {
    const event = provider.normalizeWebhook(row.payload);
    if (event.refund) await applyProviderRefund(ctx, provider, event.refund);
    else if (event.payment?.orderId) {
      const order = await findPaymentOrderByProviderOrderId(ctx.db, provider.name, event.payment.orderId);
      if (order) await applyProviderPayment(ctx, order, event.payment).catch((err) => (err instanceof AppError ? undefined : Promise.reject(err)));
      else ctx.logger.warn({ event: row.eventType, providerOrderId: event.payment.orderId }, "Payment webhook for an unknown order");
    }
    await updateWebhookEvent(ctx.db, row.id, { processedAt: new Date(), attempts: row.attempts + 1, lastError: null });
  } catch (err) {
    await updateWebhookEvent(ctx.db, row.id, { attempts: row.attempts + 1, lastError: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

/** Records a refund and updates the order's refunded amount and status. */
async function applyProviderRefund(ctx: AppContext, provider: PaymentProvider, refund: ProviderRefund, requestedByUserId?: string | null): Promise<PaymentRefundRow | null> {
  const order = await findPaymentOrderByProviderPaymentId(ctx.db, provider.name, refund.paymentId);
  if (!order) {
    ctx.logger.warn({ refund }, "Refund for an unknown payment");
    return null;
  }
  return runInTransaction(ctx, async (tx) => {
    const { refund: row, statusChanged } = await upsertRefund(tx, {
      tenantId: order.tenantId,
      orderId: order.id,
      provider: provider.name,
      providerRefundId: refund.id,
      amountMinor: refund.amountMinor,
      status: refund.status,
      requestedByUserId: requestedByUserId ?? null,
      processedAt: refund.status === "PROCESSED" ? new Date() : null,
    });
    if (statusChanged && row.status === "PROCESSED") {
      const refunded = await sumProcessedRefunds(tx, order.id);
      const updated = (await updatePaymentOrder(tx, order.id, {
        amountRefundedMinor: refunded,
        status: refunded >= order.amountMinor ? "REFUNDED" : "PARTIALLY_REFUNDED",
        refundedAt: new Date(),
      }))!;
      await ctx.payments.purposes[order.purpose]?.onRefunded?.(ctx, updated, row, tx);
    }
    return row;
  });
}

/** Refunds a paid order in full or in part (admin action; the route arrives with ticketing in Wave 3). */
export async function refundPayment(ctx: AppContext, input: { orderId: string; amountMinor?: number; reason?: string; actorUserId: string }): Promise<PaymentRefundRow | null> {
  const provider = requireProvider(ctx);
  const order = await findPaymentOrderById(ctx.db, input.orderId);
  if (!order || !order.providerPaymentId || !["PAID", "PARTIALLY_REFUNDED"].includes(order.status)) throw AppError.conflict("Only paid orders can be refunded");
  const remaining = order.amountMinor - order.amountRefundedMinor;
  const amount = input.amountMinor ?? remaining;
  if (amount <= 0 || amount > remaining) throw AppError.badRequest(`You can refund at most ${remaining}`);
  let refund: ProviderRefund;
  try {
    refund = await provider.refund({ providerPaymentId: order.providerPaymentId, amountMinor: amount, notes: { paymentOrderId: order.id, ...(input.reason ? { reason: input.reason } : {}) } });
  } catch (err) {
    throw providerError(err);
  }
  return applyProviderRefund(ctx, provider, refund, input.actorUserId);
}

/** For the mock provider in development: what a successful checkout of this order would return. */
export function mockCheckoutFor(order: PaymentOrderRow, provider: PaymentProvider) {
  if (provider.name !== "mock" || !("simulateCheckout" in provider) || !order.providerOrderId) throw AppError.forbidden("Mock checkout is only available with the mock payment provider");
  return (provider as unknown as { simulateCheckout: (o: { providerOrderId: string; amountMinor: number; currency: string }) => { providerPaymentId: string; signature: string } }).simulateCheckout({
    providerOrderId: order.providerOrderId,
    amountMinor: order.amountMinor,
    currency: order.currency,
  });
}
