import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { jobTypeEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    companyName: text("company_name").notNull(),
    location: text("location"),
    isRemote: boolean("is_remote").notNull().default(false),
    jobType: jobTypeEnum("job_type").notNull(),
    description: text("description").notNull(),
    applyUrl: text("apply_url"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    salaryRange: text("salary_range"),
    isClosed: boolean("is_closed").notNull().default(false),
    expiresAt: timestamp("expires_at", { withTimezone: true, precision: 3 }),
    /** The poster offers referrals for it. Read through the referral rules, which mask it while referrals are off. */
    canRefer: boolean("can_refer").notNull().default(false),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("jobs_tenant_status_created_idx").on(t.tenantId, t.moderationStatus, t.createdAt),
    index("jobs_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
    index("jobs_tenant_type_idx").on(t.tenantId, t.jobType),
  ],
);

export const jobSeekers = pgTable(
  "job_seekers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    note: text("note").notNull(),
    preferredRoles: text("preferred_roles"),
    preferredLocations: text("preferred_locations"),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("job_seekers_tenant_membership_uq").on(t.tenantId, t.membershipId),
    index("job_seekers_tenant_active_idx").on(t.tenantId, t.isActive, t.updatedAt),
  ],
);
