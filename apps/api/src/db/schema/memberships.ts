import type { MemberAppearance, ProfileEducationDto, ProfileExperienceDto } from "@illuminize/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { industryEnum, maritalStatusEnum, membershipRoleEnum, membershipStatusEnum, openToEnum, professionTypeEnum } from "./enums";
import { jsonValue, tenantScoped, timestamps } from "./helpers";
import { users } from "./users";

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull().default("MEMBER"),
    status: membershipStatusEnum("status").notNull().default("PENDING"),
    statusReason: text("status_reason"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true, precision: 3 }),
    statusChangedByUserId: uuid("status_changed_by_user_id").references(() => users.id, { onDelete: "set null" }),

    fullName: text("full_name").notNull(),
    batchYear: integer("batch_year").notNull(),
    dateOfBirth: date("date_of_birth"),
    professionType: professionTypeEnum("profession_type").notNull(),
    companyName: text("company_name"),
    designation: text("designation"),
    city: text("city"),
    country: char("country", { length: 2 }),
    maritalStatus: maritalStatusEnum("marital_status"),
    kidsCount: smallint("kids_count"),
    bio: text("bio"),
    linkedinUrl: text("linkedin_url"),
    interests: text("interests")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** One line about what they do, shown under their name. */
    headline: text("headline"),
    industry: industryEnum("industry"),
    /** The year they started working; the apps show the years of experience from it, so it never goes stale. */
    careerStartYear: smallint("career_start_year"),
    skills: text("skills")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Their degree and field of study here. Schools don't ask. */
    degree: text("degree"),
    fieldOfStudy: text("field_of_study"),
    websiteUrl: text("website_url"),
    githubUrl: text("github_url"),
    instagramUrl: text("instagram_url"),
    xUrl: text("x_url"),
    /** Always empty for a current pupil. */
    openTo: openToEnum("open_to").array().notNull().default(sql`'{}'::open_to[]`),
    /** Past roles and studies elsewhere, newest first. Read and written whole with the profile, never one entry at a time. */
    experiences: jsonValue<ProfileExperienceDto[]>("experiences").notNull().default(sql`'[]'::jsonb`),
    education: jsonValue<ProfileEducationDto[]>("education").notNull().default(sql`'[]'::jsonb`),
    /** When they last dismissed the feed's profile-strength card, which then stays away for PROFILE_NUDGE_SNOOZE_DAYS. */
    profileNudgeDismissedAt: timestamp("profile_nudge_dismissed_at", { withTimezone: true, precision: 3 }),
    /** The background they chose for the app here. Keys may be missing: read it through resolveAppearance. */
    appearance: jsonValue<MemberAppearance>("appearance").notNull().default(sql`'{}'::jsonb`),
    avatarUrl: text("avatar_url"),
    isPhoneVisible: boolean("is_phone_visible").notNull().default(false),
    /** Shown on the feed's celebrations card on their birthday (day and month only) / membership anniversary. */
    celebrateBirthday: boolean("celebrate_birthday").notNull().default(true),
    celebrateAnniversary: boolean("celebrate_anniversary").notNull().default(true),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true, precision: 3 }),
    /** First time the membership was approved; billing counts "approved as of" and "new in period" from it. */
    approvedAt: timestamp("approved_at", { withTimezone: true, precision: 3 }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_tenant_status_idx").on(t.tenantId, t.status),
    index("memberships_tenant_batch_idx").on(t.tenantId, t.batchYear),
    index("memberships_tenant_city_idx").on(t.tenantId, t.city),
    index("memberships_tenant_country_idx").on(t.tenantId, t.country),
    index("memberships_tenant_profession_idx").on(t.tenantId, t.professionType),
    index("memberships_tenant_industry_idx").on(t.tenantId, t.industry),
    index("memberships_tenant_role_idx").on(t.tenantId, t.role),
    index("memberships_tenant_active_idx").on(t.tenantId, t.lastActiveAt),
    index("memberships_user_idx").on(t.userId),
    index("memberships_tenant_approved_idx").on(t.tenantId, t.approvedAt),
  ],
);

/**
 * One row per member per day they used the app (day in the billing time zone, BILLING_TIMEZONE). Billing counts
 * distinct active members for any period from this, which `last_active_at` alone cannot do for past periods.
 */
export const memberActivityDays = pgTable(
  "member_activity_days",
  {
    tenantId: uuid("tenant_id").notNull(),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.day] }), index("member_activity_days_tenant_day_idx").on(t.tenantId, t.day)],
);
