import { sql } from "drizzle-orm";
import { boolean, char, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pushPlatformEnum } from "./enums";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneE164: text("phone_e164").notNull().unique(),
    phoneRegion: char("phone_region", { length: 2 }),
    displayName: text("display_name"),
    /**
     * Confirmed email (lower-cased), set only when a confirmation link is opened. Not unique: two accounts may share an
     * address, and the API never reveals whether another account uses one.
     */
    email: text("email"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true, precision: 3 }),
    isPlatformAdmin: boolean("is_platform_admin").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true, precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("users_email_idx").on(sql`lower(${t.email})`)],
);

/** Pending email confirmations. Only the SHA-256 of the token is stored; a new request replaces older ones. */
export const emailVerifications = pgTable(
  "email_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, precision: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("email_verifications_user_idx").on(t.userId, t.createdAt)],
);

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
