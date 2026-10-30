import { sql } from "drizzle-orm";
import { bigint, boolean, char, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { fundingKindEnum, fundingStageEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";

export const fundingListings = pgTable(
  "funding_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    kind: fundingKindEnum("kind").notNull(),
    title: text("title").notNull(),
    stage: fundingStageEnum("stage"),
    amountMinMinor: bigint("amount_min_minor", { mode: "number" }),
    amountMaxMinor: bigint("amount_max_minor", { mode: "number" }),
    currency: char("currency", { length: 3 }).notNull().default("INR"),
    pitch: text("pitch").notNull(),
    sectors: text("sectors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    websiteUrl: text("website_url"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    isClosed: boolean("is_closed").notNull().default(false),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("funding_tenant_kind_status_created_idx").on(t.tenantId, t.kind, t.moderationStatus, t.createdAt),
    index("funding_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
  ],
);
