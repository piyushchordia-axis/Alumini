import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { reactionTypeEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";
import { tenants } from "./tenants";

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    imageUrls: text("image_urls")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    commentCount: integer("comment_count").notNull().default(0),
    reactionCount: integer("reaction_count").notNull().default(0),
    isPinned: boolean("is_pinned").notNull().default(false),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("posts_tenant_status_pinned_created_idx").on(t.tenantId, t.moderationStatus, t.isPinned, t.createdAt),
    index("posts_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
  ],
);

export const postComments = pgTable(
  "post_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("post_comments_post_created_idx").on(t.postId, t.createdAt),
    index("post_comments_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
  ],
);

export const postReactions = pgTable(
  "post_reactions",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    type: reactionTypeEnum("type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.membershipId] }),
    index("post_reactions_tenant_membership_idx").on(t.tenantId, t.membershipId),
  ],
);
