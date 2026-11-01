import { customType, text, timestamp, uuid } from "drizzle-orm/pg-core";
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

/**
 * A jsonb column that holds any JSON value, including bare strings. Drizzle's jsonb() re-parses string values it gets
 * back (so a stored "42" or "true" would come back as a number or boolean); node-postgres has already parsed the
 * JSON, so this type passes the value through unchanged.
 */
export const jsonValue = <T>(name: string) =>
  customType<{ data: T; driverData: unknown }>({
    dataType: () => "jsonb",
    toDriver: (value) => JSON.stringify(value),
    fromDriver: (value) => value as T,
  })(name);
