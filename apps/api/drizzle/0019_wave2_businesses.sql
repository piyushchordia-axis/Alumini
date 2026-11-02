CREATE TYPE "public"."business_category" AS ENUM('RETAIL', 'FOOD_BEVERAGE', 'HEALTHCARE', 'EDUCATION', 'TECHNOLOGY', 'FINANCE_LEGAL', 'CONSULTING', 'MANUFACTURING', 'REAL_ESTATE', 'MEDIA_DESIGN', 'TRAVEL_HOSPITALITY', 'AGRICULTURE', 'LOGISTICS', 'OTHER');--> statement-breakpoint
CREATE TABLE "business_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "business_category" NOT NULL,
	"description" text NOT NULL,
	"logo_url" text,
	"city" text,
	"website_url" text,
	"contact_email" text,
	"contact_phone" text,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp (3) with time zone,
	"moderation_note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_listings" ADD CONSTRAINT "business_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_listings" ADD CONSTRAINT "business_listings_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_listings" ADD CONSTRAINT "business_listings_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "business_listings_tenant_status_created_idx" ON "business_listings" USING btree ("tenant_id","moderation_status","created_at");--> statement-breakpoint
CREATE INDEX "business_listings_tenant_author_idx" ON "business_listings" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
-- All pending migrations run in one transaction, so a value from ALTER TYPE ... ADD VALUE couldn't be used in the view
-- below (Postgres 16). Values from CREATE TYPE can, so rebuild the type. The view and this column are its only dependents;
-- the column's indexes are rebuilt by ALTER COLUMN TYPE. Existing reports keep their values through the text cast.
DROP VIEW "moderation_items";--> statement-breakpoint
ALTER TYPE "public"."content_type" RENAME TO "content_type_old";--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('POST', 'COMMENT', 'JOB', 'FUNDING', 'EVENT', 'BUSINESS');--> statement-breakpoint
ALTER TABLE "content_reports" ALTER COLUMN "content_type" TYPE "public"."content_type" USING "content_type"::text::"public"."content_type";--> statement-breakpoint
DROP TYPE "public"."content_type_old";--> statement-breakpoint
CREATE VIEW "moderation_items" AS
  SELECT 'POST'::content_type AS content_type, id, tenant_id, author_membership_id,
         left(body, 120) AS title, body AS excerpt, moderation_status, moderated_at, created_at,
         is_pinned, kind
  FROM posts
  UNION ALL
  SELECT 'COMMENT'::content_type, id, tenant_id, author_membership_id,
         left(body, 120), body, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM post_comments
  UNION ALL
  SELECT 'JOB'::content_type, id, tenant_id, author_membership_id,
         title, description, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM jobs
  UNION ALL
  SELECT 'FUNDING'::content_type, id, tenant_id, author_membership_id,
         title, pitch, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM funding_listings
  UNION ALL
  SELECT 'EVENT'::content_type, id, tenant_id, author_membership_id,
         title, description, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM events
  UNION ALL
  SELECT 'BUSINESS'::content_type, id, tenant_id, author_membership_id,
         name, description, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM business_listings;
