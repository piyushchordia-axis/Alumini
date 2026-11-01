import type { NotificationPrefs } from "@illuminize/shared";
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { notificationTypeEnum } from "./enums";
import { tenantScoped } from "./helpers";
import { memberships } from "./memberships";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    recipientMembershipId: uuid("recipient_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    readAt: timestamp("read_at", { withTimezone: true, precision: 3 }),
    /**
     * Makes a notification idempotent per recipient (e.g. "ann-<postId>"): a retried fan-out inserts nothing new, and a
     * merge (several wishes on one day) updates the existing row instead of adding another.
     */
    dedupeKey: text("dedupe_key"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_recipient_dedupe_uq")
      .on(t.recipientMembershipId, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL`),
    index("notifications_recipient_created_idx").on(t.recipientMembershipId, t.createdAt),
    index("notifications_recipient_unread_idx")
      .on(t.recipientMembershipId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/** A member's notification choices in one institution (shared NotificationPrefs; missing keys take the defaults). */
export const notificationPrefs = pgTable("notification_prefs", {
  membershipId: uuid("membership_id")
    .primaryKey()
    .references(() => memberships.id, { onDelete: "cascade" }),
  ...tenantScoped(),
  prefs: jsonb("prefs").$type<NotificationPrefs>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});
