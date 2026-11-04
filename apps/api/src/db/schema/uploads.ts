import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { uploadPurposeEnum } from "./enums";
import { tenantScoped } from "./helpers";
import { users } from "./users";

/**
 * Every file the upload route stored, so the API can tell whose photo a URL is: a profile photo must be the member's own
 * avatar upload, and a replaced one can be deleted. The row outlives its uploader (user_id becomes null).
 */
export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** The storage provider's key, `<tenantId>/<uuid>.<ext>`. */
    storageKey: text("storage_key").notNull().unique(),
    purpose: uploadPurposeEnum("purpose").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("uploads_user_purpose_idx").on(t.userId, t.purpose)],
);
