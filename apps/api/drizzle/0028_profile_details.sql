CREATE TYPE "public"."industry" AS ENUM('SOFTWARE_INTERNET', 'IT_SERVICES', 'BANKING_FINANCE', 'INVESTMENT_VC', 'CONSULTING', 'ACCOUNTING', 'LAW', 'HEALTHCARE', 'PHARMA_BIOTECH', 'EDUCATION_RESEARCH', 'GOVERNMENT', 'MANUFACTURING_ENGINEERING', 'ENERGY', 'CONSTRUCTION_REAL_ESTATE', 'RETAIL_CONSUMER', 'MEDIA_ENTERTAINMENT', 'MARKETING_ADVERTISING', 'TELECOM', 'TRANSPORT_LOGISTICS', 'HOSPITALITY_TRAVEL', 'AGRICULTURE', 'NON_PROFIT', 'ARTS_DESIGN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."open_to" AS ENUM('HIRING', 'COLLABORATING', 'INVESTING');--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "industry" "industry";--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "career_start_year" smallint;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "degree" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "field_of_study" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "github_url" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "instagram_url" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "x_url" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "open_to" "open_to"[] DEFAULT '{}'::open_to[] NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "experiences" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "education" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "profile_nudge_dismissed_at" timestamp (3) with time zone;--> statement-breakpoint
CREATE INDEX "memberships_tenant_industry_idx" ON "memberships" USING btree ("tenant_id","industry");--> statement-breakpoint
-- LinkedIn links used to pass with "linkedin.com/" anywhere in them ("https://evil.com/?linkedin.com/"). They now go by
-- the URL's own host, with no user name or password: clear the ones stored before that a host check refuses.
UPDATE "memberships" SET "linkedin_url" = NULL WHERE "linkedin_url" IS NOT NULL AND "linkedin_url" !~* '^https?://([a-z0-9-]+\.)*linkedin\.com(:[0-9]+)?([/?#]|$)';