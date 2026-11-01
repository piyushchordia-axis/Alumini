import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { messageChannelEnum, postKindEnum, reactionTypeEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";
import { tenants } from "./tenants";
import { users } from "./users";

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
    kind: postKindEnum("kind").notNull().default("POST"),
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
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.postId, t.membershipId] }),
    index("post_reactions_tenant_membership_idx").on(t.tenantId, t.membershipId),
  ],
);

/** A poll on a post (the post's text is the question). */
export const postPolls = pgTable("post_polls", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  ...tenantScoped(),
  allowsMultiple: boolean("allows_multiple").notNull().default(false),
  closesAt: timestamp("closes_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const pollOptions = pgTable(
  "poll_options",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => postPolls.postId, { onDelete: "cascade" }),
    ...tenantScoped(),
    label: text("label").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [uniqueIndex("poll_options_post_position_uq").on(t.postId, t.position)],
);

/** One row per chosen option; counts are computed when read, so there is no counter to drift. */
export const pollVotes = pgTable(
  "poll_votes",
  {
    optionId: uuid("option_id")
      .notNull()
      .references(() => pollOptions.id, { onDelete: "cascade" }),
    postId: uuid("post_id")
      .notNull()
      .references(() => postPolls.postId, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    ...tenantScoped(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.membershipId] }), index("poll_votes_post_member_idx").on(t.postId, t.membershipId)],
);

/** How an announcement was sent: the channels chosen, fan-out progress and how many it reached. */
export const postAnnouncements = pgTable("post_announcements", {
  postId: uuid("post_id")
    .primaryKey()
    .references(() => posts.id, { onDelete: "cascade" }),
  ...tenantScoped(),
  channels: messageChannelEnum("channels").array().notNull().default(sql`'{}'::message_channel[]`),
  notifiedCount: integer("notified_count").notNull().default(0),
  messagedCount: integer("messaged_count").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  fanoutStartedAt: timestamp("fanout_started_at", { withTimezone: true, precision: 3 }),
  fanoutFinishedAt: timestamp("fanout_finished_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});
