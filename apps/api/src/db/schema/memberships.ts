import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { maritalStatusEnum, membershipRoleEnum, membershipStatusEnum, professionTypeEnum } from "./enums";
import { tenantScoped, timestamps } from "./helpers";
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
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
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
    avatarUrl: text("avatar_url"),
    isPhoneVisible: boolean("is_phone_visible").notNull().default(false),
    extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_tenant_status_idx").on(t.tenantId, t.status),
    index("memberships_tenant_batch_idx").on(t.tenantId, t.batchYear),
    index("memberships_tenant_city_idx").on(t.tenantId, t.city),
    index("memberships_tenant_country_idx").on(t.tenantId, t.country),
    index("memberships_tenant_profession_idx").on(t.tenantId, t.professionType),
    index("memberships_tenant_role_idx").on(t.tenantId, t.role),
    index("memberships_tenant_active_idx").on(t.tenantId, t.lastActiveAt),
    index("memberships_user_idx").on(t.userId),
  ],
);
