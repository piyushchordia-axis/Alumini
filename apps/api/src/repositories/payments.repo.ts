import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { PaymentOrderStatus } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { paymentOrders, paymentRefunds, paymentWebhookEvents } from "../db/schema";

export type PaymentOrderRow = typeof paymentOrders.$inferSelect;
export type PaymentOrderInsert = typeof paymentOrders.$inferInsert;
export type PaymentRefundRow = typeof paymentRefunds.$inferSelect;
export type PaymentWebhookEventRow = typeof paymentWebhookEvents.$inferSelect;

/** Statuses an order cannot leave by being paid or failing again. */
export const SETTLED_STATUSES: PaymentOrderStatus[] = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"];

export async function insertPaymentOrder(db: DbClient, values: PaymentOrderInsert): Promise<PaymentOrderRow> {
  const [row] = await db.insert(paymentOrders).values(values).returning();
  return row!;
}

export async function findPaymentOrder(db: DbClient, tenantId: string, id: string): Promise<PaymentOrderRow | undefined> {
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.tenantId, tenantId), eq(paymentOrders.id, id)));
  return row;
}

export async function findPaymentOrderById(db: DbClient, id: string): Promise<PaymentOrderRow | undefined> {
  const [row] = await db.select().from(paymentOrders).where(eq(paymentOrders.id, id));
  return row;
}

export async function findPaymentOrderByProviderOrderId(db: DbClient, provider: string, providerOrderId: string): Promise<PaymentOrderRow | undefined> {
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.provider, provider), eq(paymentOrders.providerOrderId, providerOrderId)));
  return row;
}

export async function findPaymentOrderByProviderPaymentId(db: DbClient, provider: string, providerPaymentId: string): Promise<PaymentOrderRow | undefined> {
  const [row] = await db.select().from(paymentOrders).where(and(eq(paymentOrders.provider, provider), eq(paymentOrders.providerPaymentId, providerPaymentId)));
  return row;
}

export async function updatePaymentOrder(db: DbClient, id: string, values: Partial<PaymentOrderInsert>): Promise<PaymentOrderRow | undefined> {
  const [row] = await db
    .update(paymentOrders)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(paymentOrders.id, id))
    .returning();
  return row;
}

/**
 * Moves an order to a new status only if it is currently in one of `from` (or not in `notFrom`). Returns the row when
 * this call made the change, so side effects (fulfilment) run exactly once even with concurrent confirms and webhooks.
 */
export async function transitionPaymentOrder(
  db: DbClient,
  id: string,
  guard: { from?: PaymentOrderStatus[]; notFrom?: PaymentOrderStatus[] },
  values: Partial<PaymentOrderInsert>,
): Promise<PaymentOrderRow | undefined> {
  const conds = [eq(paymentOrders.id, id)];
  if (guard.from) conds.push(inArray(paymentOrders.status, guard.from));
  if (guard.notFrom) conds.push(notInArray(paymentOrders.status, guard.notFrom));
  const [row] = await db
    .update(paymentOrders)
    .set({ ...values, updatedAt: new Date() })
    .where(and(...conds))
    .returning();
  return row;
}

/** Inserts or updates a refund by provider id; returns it with whether its status changed. */
export async function upsertRefund(
  db: DbClient,
  values: typeof paymentRefunds.$inferInsert,
): Promise<{ refund: PaymentRefundRow; statusChanged: boolean }> {
  const [existing] = await db.select().from(paymentRefunds).where(and(eq(paymentRefunds.provider, values.provider), eq(paymentRefunds.providerRefundId, values.providerRefundId)));
  if (!existing) {
    const [row] = await db.insert(paymentRefunds).values(values).returning();
    return { refund: row!, statusChanged: true };
  }
  if (existing.status === values.status) return { refund: existing, statusChanged: false };
  const [row] = await db
    .update(paymentRefunds)
    .set({ status: values.status, processedAt: values.processedAt ?? existing.processedAt, updatedAt: new Date() })
    .where(eq(paymentRefunds.id, existing.id))
    .returning();
  return { refund: row!, statusChanged: true };
}

export async function sumProcessedRefunds(db: DbClient, orderId: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${paymentRefunds.amountMinor}), 0)::bigint` })
    .from(paymentRefunds)
    .where(and(eq(paymentRefunds.orderId, orderId), eq(paymentRefunds.status, "PROCESSED")));
  return Number(row?.total ?? 0);
}

/** Records a webhook delivery once; returns null for a repeated event id. */
export async function insertWebhookEvent(db: DbClient, values: typeof paymentWebhookEvents.$inferInsert): Promise<PaymentWebhookEventRow | null> {
  const [row] = await db.insert(paymentWebhookEvents).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

export async function findWebhookEvent(db: DbClient, id: string): Promise<PaymentWebhookEventRow | undefined> {
  const [row] = await db.select().from(paymentWebhookEvents).where(eq(paymentWebhookEvents.id, id));
  return row;
}

export async function updateWebhookEvent(db: DbClient, id: string, values: Partial<typeof paymentWebhookEvents.$inferInsert>): Promise<void> {
  await db.update(paymentWebhookEvents).set(values).where(eq(paymentWebhookEvents.id, id));
}
