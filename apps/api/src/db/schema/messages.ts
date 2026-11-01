import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { messageChannelEnum, outboundMessageStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { users } from "./users";

export interface OutboundMessageError {
  at: string;
  channel: string;
  provider: string;
  error: string;
  retryable: boolean;
}

/**
 * Every WhatsApp/SMS/email message the platform sends (not OTPs, which have their own path). The row is written
 * before sending, so it doubles as an outbox: a sweeper re-queues rows a crash left behind. `payload` holds the
 * template parameters, never the rendered text.
 */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    /** Message type from the template registry (services/messages/templates.ts). */
    type: text("type").notNull(),
    status: outboundMessageStatusEnum("status").notNull().default("QUEUED"),
    /** Channels to try, in order. */
    channels: messageChannelEnum("channels").array().notNull(),
    /** The channel that delivered, or the last one tried. */
    channel: messageChannelEnum("channel"),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    toPhone: text("to_phone"),
    toEmail: text("to_email"),
    toName: text("to_name"),
    recipientUserId: uuid("recipient_user_id").references(() => users.id, { onDelete: "set null" }),
    /** What the message is about, e.g. ("invite", invitation id). */
    contextType: text("context_type"),
    contextId: text("context_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** Prevents sending the same thing twice (e.g. "invite-<id>-1"). */
    dedupeKey: text("dedupe_key"),
    attempts: integer("attempts").notNull().default(0),
    errors: jsonb("errors").$type<OutboundMessageError[]>().notNull().default([]),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true, precision: 3 }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true, precision: 3 }),
    failedAt: timestamp("failed_at", { withTimezone: true, precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    /** Set explicitly on every change (the sweeper looks for rows stuck in QUEUED/SENDING). */
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outbound_messages_dedupe_uq").on(t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    uniqueIndex("outbound_messages_provider_id_uq").on(t.provider, t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
    index("outbound_messages_tenant_created_idx").on(t.tenantId, t.createdAt),
    index("outbound_messages_context_idx").on(t.contextType, t.contextId),
    index("outbound_messages_pending_idx").on(t.status, t.updatedAt).where(sql`${t.status} in ('QUEUED', 'SENDING')`),
    // Billing usage: delivered messages per tenant and period.
    index("outbound_messages_tenant_sent_idx").on(t.tenantId, t.sentAt).where(sql`${t.status} in ('SENT', 'DELIVERED', 'READ')`),
  ],
);
