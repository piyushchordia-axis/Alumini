import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { chatConversations } from "./chat";
import { referralStatusEnum } from "./enums";
import { tenantScoped, timestamps } from "./helpers";
import { jobs } from "./jobs";
import { memberships } from "./memberships";

/**
 * A member's request for a referral to a job, sent to its poster. The job's title and company are copied in, because the
 * job can be deleted while the request still matters to both sides. Either member deleting their account leaves the row for
 * the other, with a null on their side, as mentorship does. `suppressed` is a request from someone the poster had blocked:
 * the poster never sees it and nobody is told of it, while its sender sees it exactly as a request still waiting. Never
 * serialized.
 */
export const referralRequests = pgTable(
  "referral_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    jobTitle: text("job_title").notNull(),
    jobCompany: text("job_company").notNull(),
    posterMembershipId: uuid("poster_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    requesterMembershipId: uuid("requester_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    status: referralStatusEnum("status").notNull().default("REQUESTED"),
    /** The requester's words, 10 to 500 characters. Never in a notification, push, audit row, job or log. */
    note: text("note").notNull(),
    suppressed: boolean("suppressed").notNull().default(false),
    conversationId: uuid("conversation_id").references(() => chatConversations.id, { onDelete: "set null" }),
    /** When the poster accepted or declined. */
    respondedAt: timestamp("responded_at", { withTimezone: true, precision: 3 }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, precision: 3 }),
    /** When it was withdrawn, or closed because its job stopped taking requests. */
    closedAt: timestamp("closed_at", { withTimezone: true, precision: 3 }),
    ...timestamps(),
  },
  (t) => [
    // One live request per job and member, and a decline is final for that job. Withdrawn and closed ones can be asked again.
    uniqueIndex("referral_requests_job_requester_uq").on(t.jobId, t.requesterMembershipId).where(sql`${t.status} in ('REQUESTED', 'ACCEPTED', 'DECLINED')`),
    check("referral_requests_not_self", sql`${t.posterMembershipId} <> ${t.requesterMembershipId}`),
    index("referral_requests_job_created_idx").on(t.jobId, t.createdAt),
    index("referral_requests_poster_created_idx").on(t.posterMembershipId, t.createdAt),
    index("referral_requests_requester_created_idx").on(t.requesterMembershipId, t.createdAt),
    index("referral_requests_conversation_idx").on(t.conversationId),
  ],
);
