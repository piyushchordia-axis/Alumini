import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  chatConversationKindEnum,
  chatDirectStateEnum,
  chatMessageKindEnum,
  chatOriginEnum,
  chatParticipantRoleEnum,
  chatParticipantStateEnum,
  chatReportActionEnum,
  chatReportTargetKindEnum,
  reportReasonEnum,
  reportStatusEnum,
} from "./enums";
import { jsonValue, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";
import { users } from "./users";

/**
 * A private conversation. `last_seq` and `last_message_at` change on every send and have no index, so sends stay HOT
 * updates. A direct thread's pair is stored low id first, so one pair can only ever be one row.
 */
export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    kind: chatConversationKindEnum("kind").notNull(),
    origin: chatOriginEnum("origin").notNull(),
    originId: uuid("origin_id"),
    lastSeq: integer("last_seq").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, precision: 3 }).notNull(),
    directLowId: uuid("direct_low_id").references(() => memberships.id, { onDelete: "set null" }),
    directHighId: uuid("direct_high_id").references(() => memberships.id, { onDelete: "set null" }),
    directState: chatDirectStateEnum("direct_state"),
    requesterMembershipId: uuid("requester_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    /** The last request, or when the thread closed. A requester's view depends only on this and `request_count`. */
    requestedAt: timestamp("requested_at", { withTimezone: true, precision: 3 }),
    requestCount: integer("request_count").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    // A deleted member's id goes null, and nulls never collide, so the other member can start afresh with whoever comes back.
    uniqueIndex("chat_conversations_direct_pair_uq").on(t.tenantId, t.directLowId, t.directHighId).where(sql`${t.kind} = 'DIRECT'`),
    check("chat_conversations_direct_pair_order", sql`${t.directLowId} < ${t.directHighId}`),
    index("chat_conversations_direct_low_idx").on(t.directLowId),
    index("chat_conversations_direct_high_idx").on(t.directHighId),
    index("chat_conversations_requester_idx").on(t.requesterMembershipId),
  ],
);

export const chatParticipants = pgTable(
  "chat_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    ...tenantScoped(),
    state: chatParticipantStateEnum("state").notNull().default("ACTIVE"),
    role: chatParticipantRoleEnum("role").notNull().default("MEMBER"),
    /** Messages at or before this were sent before they joined. */
    joinedSeq: integer("joined_seq").notNull().default(0),
    lastReadSeq: integer("last_read_seq").notNull().default(0),
    mutedUntil: timestamp("muted_until", { withTimezone: true, precision: 3 }),
    /**
     * Set when this member blocks the other: their list position holds here and the thread shows nothing unread. Stays through
     * an unblock until the next message they can see, because moving before then would show when a withheld message was sent.
     */
    frozenSortAt: timestamp("frozen_sort_at", { withTimezone: true, precision: 3 }),
    /**
     * What this member's sends have done as far as they can tell, while the other has them blocked. A withheld send leaves the
     * conversation's state alone, because the blocker reads that, so the request or acceptance only its sender believes in is
     * kept here. ACCEPTED, or PENDING meaning they've asked. Never serialized.
     */
    withheldState: chatDirectStateEnum("withheld_state"),
    withheldRequestedAt: timestamp("withheld_requested_at", { withTimezone: true, precision: 3 }),
    withheldRequestCount: integer("withheld_request_count"),
    invitedByMembershipId: uuid("invited_by_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    inviteSuppressed: boolean("invite_suppressed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.membershipId] }),
    index("chat_participants_member_state_idx").on(t.membershipId, t.state),
    index("chat_participants_invited_by_idx").on(t.invitedByMembershipId),
  ],
);

/** Kept out of content_types and moderation_items on purpose: anything in that view is readable by admins. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => chatConversations.id, { onDelete: "cascade" }),
    /** Gapless per conversation, taken under the conversation's row lock. Order by this, never by created_at. */
    seq: integer("seq").notNull(),
    senderMembershipId: uuid("sender_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    kind: chatMessageKindEnum("kind").notNull().default("TEXT"),
    body: text("body").notNull(),
    meta: jsonValue<Record<string, unknown> | null>("meta"),
    clientKey: text("client_key"),
    /** Only its sender ever sees it, and nothing may reveal that. Never serialized. */
    withheld: boolean("withheld").notNull().default(false),
    removedAt: timestamp("removed_at", { withTimezone: true, precision: 3 }),
    removedByUserId: uuid("removed_by_user_id").references(() => users.id, { onDelete: "set null" }),
    removalNote: text("removal_note"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_messages_conversation_seq_uq").on(t.conversationId, t.seq),
    uniqueIndex("chat_messages_client_key_uq").on(t.conversationId, t.senderMembershipId, t.clientKey).where(sql`${t.clientKey} is not null`),
    index("chat_messages_sender_idx").on(t.senderMembershipId),
  ],
);

/** Per membership, so a block never crosses institutions. */
export const chatBlocks = pgTable(
  "chat_blocks",
  {
    blockerMembershipId: uuid("blocker_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    blockedMembershipId: uuid("blocked_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    ...tenantScoped(),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerMembershipId, t.blockedMembershipId] }),
    check("chat_blocks_not_self", sql`${t.blockerMembershipId} <> ${t.blockedMembershipId}`),
    index("chat_blocks_blocked_idx").on(t.blockedMembershipId),
  ],
);

/**
 * `context_message_ids` is frozen when the report is filed, computed for that reporter. It lists what an admin may be
 * shown, because a range of `seq` could include messages the reporter never received.
 */
export const chatReports = pgTable(
  "chat_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    targetKind: chatReportTargetKindEnum("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "set null" }),
    reporterMembershipId: uuid("reporter_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    reportedMembershipId: uuid("reported_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    reason: reportReasonEnum("reason").notNull(),
    status: reportStatusEnum("status").notNull().default("OPEN"),
    details: text("details"),
    contextMessageIds: uuid("context_message_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    noteSnapshot: text("note_snapshot"),
    resolutionAction: chatReportActionEnum("resolution_action"),
    resolvedByUserId: uuid("resolved_by_user_id").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, precision: 3 }),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chat_reports_unique_reporter_uq").on(t.targetKind, t.targetId, t.reporterMembershipId),
    index("chat_reports_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    index("chat_reports_conversation_idx").on(t.conversationId),
    index("chat_reports_reporter_idx").on(t.reporterMembershipId),
    index("chat_reports_reported_idx").on(t.reportedMembershipId),
  ],
);
