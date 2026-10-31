import { text, timestamp, uuid } from "drizzle-orm/pg-core";
import { moderationStatusEnum } from "./enums";
import { tenants } from "./tenants";
import { users } from "./users";

export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const tenantScoped = () => ({
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
});

export const moderationColumns = () => ({
  moderationStatus: moderationStatusEnum("moderation_status").notNull(),
  moderatedByUserId: uuid("moderated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  moderatedAt: timestamp("moderated_at", { withTimezone: true, precision: 3 }),
  moderationNote: text("moderation_note"),
});
