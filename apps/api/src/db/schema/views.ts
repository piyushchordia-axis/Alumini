import { boolean, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contentTypeEnum, moderationStatusEnum, postKindEnum } from "./enums";

/**
 * Union of all moderatable content. Created by the hand-written migration
 * `0001_extensions_views.sql`, last redefined by `0019_wave2_businesses.sql`; declared here as an existing view so
 * Drizzle can query it.
 */
export const moderationItems = pgView("moderation_items", {
  contentType: contentTypeEnum("content_type").notNull(),
  id: uuid("id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  authorMembershipId: uuid("author_membership_id"),
  title: text("title"),
  excerpt: text("excerpt"),
  moderationStatus: moderationStatusEnum("moderation_status").notNull(),
  moderatedAt: timestamp("moderated_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull(),
  isPinned: boolean("is_pinned").notNull(),
  /** Posts only (null for other content). */
  kind: postKindEnum("kind"),
}).existing();
