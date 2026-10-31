import { boolean, pgView, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { contentTypeEnum, moderationStatusEnum } from "./enums";

/**
 * Union of all moderatable content. Created by the hand-written migration
 * `0001_extensions_views.sql`; declared here as an existing view so Drizzle can query it.
 */
export const moderationItems = pgView("moderation_items", {
  contentType: contentTypeEnum("content_type").notNull(),
  id: uuid("id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  authorMembershipId: uuid("author_membership_id").notNull(),
  title: text("title"),
  excerpt: text("excerpt"),
  moderationStatus: moderationStatusEnum("moderation_status").notNull(),
  moderatedAt: timestamp("moderated_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  isPinned: boolean("is_pinned").notNull(),
}).existing();
