import { DEFAULT_TENANT_FEATURES, DEFAULT_TENANT_TIMEZONE, type TenantFeatures } from "@illuminize/shared";
import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { MessageChannel } from "@illuminize/shared";
import { approvalModeEnum, billingCycleEnum, billingModelEnum, messageChannelEnum, tenantStatusEnum, tenantTypeEnum } from "./enums";
import { users } from "./users";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    shortName: text("short_name"),
    type: tenantTypeEnum("type").notNull().default("COLLEGE"),
    status: tenantStatusEnum("status").notNull().default("ACTIVE"),
    city: text("city"),
    country: char("country", { length: 2 }),
    /** IANA zone for scheduled sends (birthdays at 09:00, the Monday digest) and the default for new events. */
    timezone: text("timezone").notNull().default(DEFAULT_TENANT_TIMEZONE),
    logoUrl: text("logo_url"),
    coverImageUrl: text("cover_image_url"),
    primaryColor: text("primary_color").notNull().default("#1d4ed8"),
    secondaryColor: text("secondary_color").notNull().default("#0f172a"),
    tagline: text("tagline"),
    welcomeMessage: text("welcome_message"),
    websiteUrl: text("website_url"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("tenants_status_idx").on(t.status)],
);

export const tenantSettings = pgTable("tenant_settings", {
  tenantId: uuid("tenant_id")
    .primaryKey()
    .references(() => tenants.id, { onDelete: "cascade" }),
  memberApprovalMode: approvalModeEnum("member_approval_mode").notNull().default("ADMIN_APPROVAL"),
  contentModerationMode: approvalModeEnum("content_moderation_mode").notNull().default("AUTO_APPROVE"),
  allowSelfRegistration: boolean("allow_self_registration").notNull().default(true),
  minBatchYear: integer("min_batch_year").notNull().default(1950),
  maxBatchYear: integer("max_batch_year").notNull().default(2032),
  features: jsonb("features").$type<TenantFeatures>().notNull().default(DEFAULT_TENANT_FEATURES),
  /** Invited members (matched by their verified phone) are approved straight away. */
  inviteAutoApprove: boolean("invite_auto_approve").notNull().default(true),
  updatedByUserId: uuid("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});

export const tenantBillingPlans = pgTable(
  "tenant_billing_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    billingModel: billingModelEnum("billing_model").notNull(),
    billingCycle: billingCycleEnum("billing_cycle").notNull().default("MONTHLY"),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    pricePerActiveUserMinor: integer("price_per_active_user_minor"),
    flatFeeMinor: integer("flat_fee_minor"),
    /** Outbound channels the subscription includes for invites and announcements (in-app and push always are). */
    includedChannels: messageChannelEnum("included_channels").array().notNull().default(sql`'{}'::message_channel[]`),
    /** Charge per delivered message by channel, in minor units (fractions allowed). */
    messageRatesMinor: jsonb("message_rates_minor").$type<Partial<Record<MessageChannel, number>>>().notNull().default({}),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("billing_plans_tenant_from_idx").on(t.tenantId, t.effectiveFrom)],
);

export const tenantBillingSnapshots = pgTable(
  "tenant_billing_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    billingPlanId: uuid("billing_plan_id").references(() => tenantBillingPlans.id, { onDelete: "set null" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    approvedMemberCount: integer("approved_member_count").notNull(),
    activeMemberCount: integer("active_member_count").notNull(),
    newMemberCount: integer("new_member_count").notNull(),
    messageCounts: jsonb("message_counts").$type<Partial<Record<MessageChannel, number>>>().notNull().default({}),
    /** Message charges, included in amountMinor. */
    messageAmountMinor: integer("message_amount_minor").notNull().default(0),
    amountMinor: integer("amount_minor").notNull(),
    currency: char("currency", { length: 3 }).notNull(),
    notes: text("notes"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("billing_snapshots_period_uq").on(t.tenantId, t.periodStart, t.periodEnd)],
);
