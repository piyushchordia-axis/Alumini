import { sql } from "drizzle-orm";
import { bigint, char, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { paymentOrderStatusEnum, paymentPurposeEnum, paymentRefundStatusEnum } from "./enums";
import { timestamps } from "./helpers";
import { memberships } from "./memberships";
import { tenants } from "./tenants";
import { users } from "./users";

const ts = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

/**
 * A payment a member makes for something (an event ticket, a donation). Created before checkout; the provider order is
 * attached once created. Purpose handlers (services/payments/purposes.ts) price it and act once it is paid.
 */
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    purpose: paymentPurposeEnum("purpose").notNull(),
    /** The thing paid for, e.g. the ticket type or campaign id. */
    referenceId: text("reference_id").notNull(),
    payerMembershipId: uuid("payer_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    payerUserId: uuid("payer_user_id").references(() => users.id, { onDelete: "set null" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    amountRefundedMinor: bigint("amount_refunded_minor", { mode: "number" }).notNull().default(0),
    status: paymentOrderStatusEnum("status").notNull().default("CREATED"),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    /** Our reference sent to the provider (≤ 40 chars). */
    receipt: text("receipt").notNull(),
    description: text("description"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    failureCode: text("failure_code"),
    failureReason: text("failure_reason"),
    expiresAt: ts("expires_at"),
    paidAt: ts("paid_at"),
    refundedAt: ts("refunded_at"),
    ...timestamps(),
  },
  (t) => [
    check("payment_orders_amount_positive", sql`${t.amountMinor} > 0`),
    uniqueIndex("payment_orders_provider_order_uq").on(t.provider, t.providerOrderId).where(sql`${t.providerOrderId} is not null`),
    uniqueIndex("payment_orders_provider_payment_uq").on(t.provider, t.providerPaymentId).where(sql`${t.providerPaymentId} is not null`),
    index("payment_orders_reference_idx").on(t.tenantId, t.purpose, t.referenceId),
    index("payment_orders_payer_idx").on(t.payerMembershipId, t.createdAt),
  ],
);

export const paymentRefunds = pgTable(
  "payment_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => paymentOrders.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerRefundId: text("provider_refund_id").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    status: paymentRefundStatusEnum("status").notNull().default("PENDING"),
    reason: text("reason"),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
    processedAt: ts("processed_at"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("payment_refunds_provider_refund_uq").on(t.provider, t.providerRefundId), index("payment_refunds_order_idx").on(t.orderId)],
);

/** Every provider webhook received, once per event id (providers retry deliveries). */
export const paymentWebhookEvents = pgTable(
  "payment_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [uniqueIndex("payment_webhook_events_uq").on(t.provider, t.eventId)],
);
