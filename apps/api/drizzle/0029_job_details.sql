CREATE TYPE "public"."company_size" AS ENUM('SIZE_1_10', 'SIZE_11_50', 'SIZE_51_200', 'SIZE_201_1000', 'SIZE_1001_5000', 'SIZE_5001_PLUS');--> statement-breakpoint
CREATE TYPE "public"."job_seniority" AS ENUM('ENTRY', 'MID', 'SENIOR', 'LEAD', 'MANAGER', 'EXECUTIVE');--> statement-breakpoint
CREATE TYPE "public"."salary_period" AS ENUM('YEAR', 'MONTH', 'HOUR');--> statement-breakpoint
CREATE TYPE "public"."work_mode" AS ENUM('ON_SITE', 'HYBRID', 'REMOTE');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "work_mode" "work_mode" DEFAULT 'ON_SITE' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "seniority" "job_seniority";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "experience_min" smallint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "experience_max" smallint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "skills" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "education_requirement" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "openings" smallint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "responsibilities" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "requirements" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "benefits" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "how_to_apply" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_min_minor" bigint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_max_minor" bigint;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_currency" char(3) DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_period" "salary_period" DEFAULT 'YEAR' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "salary_note" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "company_logo_url" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "company_website" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "company_industry" "industry";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "company_size" "company_size";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "about_company" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_experience_range" CHECK (("jobs"."experience_min" IS NULL OR "jobs"."experience_min" BETWEEN 0 AND 50) AND ("jobs"."experience_max" IS NULL OR "jobs"."experience_max" BETWEEN 0 AND 50) AND ("jobs"."experience_min" IS NULL OR "jobs"."experience_max" IS NULL OR "jobs"."experience_min" <= "jobs"."experience_max"));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_range" CHECK (("jobs"."salary_min_minor" IS NULL OR "jobs"."salary_min_minor" >= 0) AND ("jobs"."salary_max_minor" IS NULL OR "jobs"."salary_max_minor" >= 0) AND ("jobs"."salary_min_minor" IS NULL OR "jobs"."salary_max_minor" IS NULL OR "jobs"."salary_min_minor" <= "jobs"."salary_max_minor"));--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_openings_range" CHECK ("jobs"."openings" IS NULL OR "jobs"."openings" BETWEEN 1 AND 1000);--> statement-breakpoint
-- Backfill, added by hand: the next migration drops is_remote and salary_range.
UPDATE "jobs" SET "work_mode" = 'REMOTE' WHERE "is_remote";--> statement-breakpoint
UPDATE "jobs" SET "salary_note" = "salary_range" WHERE "salary_range" IS NOT NULL;
