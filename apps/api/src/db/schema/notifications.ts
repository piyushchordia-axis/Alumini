import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    index("notifications_recipient_created_idx").on(t.recipientMembershipId, t.createdAt),
    index("notifications_recipient_unread_idx")
      .on(t.recipientMembershipId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);
