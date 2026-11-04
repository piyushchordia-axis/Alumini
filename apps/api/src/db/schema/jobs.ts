import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, index, pgTable, smallint, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companySizeEnum, industryEnum, jobSeniorityEnum, jobTypeEnum, salaryPeriodEnum, workModeEnum } from "./enums";
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
    workMode: workModeEnum("work_mode").notNull().default("ON_SITE"),
    jobType: jobTypeEnum("job_type").notNull(),
    seniority: jobSeniorityEnum("seniority"),
    /** Years of experience asked for. Either end may be open. */
    experienceMin: smallint("experience_min"),
    experienceMax: smallint("experience_max"),
    /** Normalised by the shared `normalizeSkills`. */
    skills: text("skills")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    educationRequirement: text("education_requirement"),
    openings: smallint("openings"),
    /** About the role: the one section every job has. */
    description: text("description").notNull(),
    responsibilities: text("responsibilities"),
    requirements: text("requirements"),
    benefits: text("benefits"),
    howToApply: text("how_to_apply"),
    applyUrl: text("apply_url"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    /** Pay in minor units (paise, cents) of `salaryCurrency`, per `salaryPeriod`. Either end may be open. */
    salaryMinMinor: bigint("salary_min_minor", { mode: "number" }),
    salaryMaxMinor: bigint("salary_max_minor", { mode: "number" }),
    salaryCurrency: char("salary_currency", { length: 3 }).notNull().default("INR"),
    salaryPeriod: salaryPeriodEnum("salary_period").notNull().default("YEAR"),
    /** Free text beside the pay, shown as "Pay note": "plus ESOPs". */
    salaryNote: text("salary_note"),
    companyLogoUrl: text("company_logo_url"),
    companyWebsite: text("company_website"),
    /**
     * One of the shared INDUSTRIES, the same `industry` enum as `memberships.industry`: growing the list takes one
     * ALTER TYPE for both columns.
     */
    companyIndustry: industryEnum("company_industry"),
    companySize: companySizeEnum("company_size"),
    aboutCompany: text("about_company"),
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
    // The API checks these first and names the field; these keep a bad row out whatever writes it.
    check(
      "jobs_experience_range",
      sql`(${t.experienceMin} IS NULL OR ${t.experienceMin} BETWEEN 0 AND 50) AND (${t.experienceMax} IS NULL OR ${t.experienceMax} BETWEEN 0 AND 50) AND (${t.experienceMin} IS NULL OR ${t.experienceMax} IS NULL OR ${t.experienceMin} <= ${t.experienceMax})`,
    ),
    check(
      "jobs_salary_range",
      sql`(${t.salaryMinMinor} IS NULL OR ${t.salaryMinMinor} >= 0) AND (${t.salaryMaxMinor} IS NULL OR ${t.salaryMaxMinor} >= 0) AND (${t.salaryMinMinor} IS NULL OR ${t.salaryMaxMinor} IS NULL OR ${t.salaryMinMinor} <= ${t.salaryMaxMinor})`,
    ),
    check("jobs_openings_range", sql`${t.openings} IS NULL OR ${t.openings} BETWEEN 1 AND 1000`),
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
