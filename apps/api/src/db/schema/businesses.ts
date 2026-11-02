import { index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { businessCategoryEnum } from "./enums";
import { moderationColumns, tenantScoped, timestamps } from "./helpers";
import { memberships } from "./memberships";

export const businessListings = pgTable(
  "business_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...tenantScoped(),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: businessCategoryEnum("category").notNull(),
    description: text("description").notNull(),
    logoUrl: text("logo_url"),
    city: text("city"),
    websiteUrl: text("website_url"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    ...moderationColumns(),
    ...timestamps(),
  },
  (t) => [
    index("business_listings_tenant_status_created_idx").on(t.tenantId, t.moderationStatus, t.createdAt),
    index("business_listings_tenant_author_idx").on(t.tenantId, t.authorMembershipId),
  ],
);
