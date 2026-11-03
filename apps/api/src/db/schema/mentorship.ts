import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chatConversations } from "./chat";
import { mentorAreaEnum, mentorAvailabilityEnum, mentorshipStatusEnum } from "./enums";
import { tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";

/**
 * A member's offer to mentor, one per membership. Stopping keeps the row, inactive, so offering again starts from what they
 * wrote. Its note is nobody else's words and can't be reported as chat, so admins see it on the member's page instead.
 */
export const mentorProfiles = pgTable(
  "mentor_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    areas: mentorAreaEnum("areas").array().notNull(),
    availability: mentorAvailabilityEnum("availability").notNull(),
    availabilityNote: text("availability_note"),
    note: text("note"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [uniqueIndex("mentor_profiles_tenant_membership_uq").on(t.tenantId, t.membershipId), index("mentor_profiles_tenant_active_idx").on(t.tenantId, t.isActive)],
);

/**
 * A request to a mentor, and the mentorship it may become. Either member deleting their account leaves the row for the
 * other, with a null on their side, as chat does. `suppressed` is a request the mentor had blocked its sender from: its
 * mentor never sees it and nobody is told of it, while its sender sees it exactly as a request still waiting. Never
 * serialized.
 */
export const mentorships = pgTable(
  "mentorships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    mentorMembershipId: uuid("mentor_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    menteeMembershipId: uuid("mentee_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    status: mentorshipStatusEnum("status").notNull().default("REQUESTED"),
    /** The mentee's words, 10 to 500 characters. Never in a notification, push, audit row, job or log. */
    note: text("note").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "set null" }),
    respondedAt: timestamp("responded_at", { withTimezone: true, precision: 3 }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 3 }),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    endedByMembershipId: uuid("ended_by_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    // One request waiting or one mentorship under way per mentor and mentee, in that direction.
    uniqueIndex("mentorships_open_pair_uq").on(t.tenantId, t.mentorMembershipId, t.menteeMembershipId).where(sql`${t.status} in ('REQUESTED', 'ACCEPTED')`),
    check("mentorships_not_self", sql`${t.mentorMembershipId} <> ${t.menteeMembershipId}`),
    index("mentorships_mentor_created_idx").on(t.mentorMembershipId, t.createdAt),
    index("mentorships_mentee_created_idx").on(t.menteeMembershipId, t.createdAt),
    index("mentorships_conversation_idx").on(t.conversationId),
    index("mentorships_ended_by_idx").on(t.endedByMembershipId),
  ],
);
