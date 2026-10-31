import { boolean, char, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pushPlatformEnum } from "./enums";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneE164: text("phone_e164").notNull().unique(),
  phoneRegion: char("phone_region", { length: 2 }),
  displayName: text("display_name"),
  isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    platform: pushPlatformEnum("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("push_tokens_user_idx").on(t.userId)],
);
