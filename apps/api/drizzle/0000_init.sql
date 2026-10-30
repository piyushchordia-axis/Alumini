CREATE TYPE "public"."approval_mode" AS ENUM('AUTO_APPROVE', 'ADMIN_APPROVAL');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('MONTHLY', 'QUARTERLY', 'YEARLY');--> statement-breakpoint
CREATE TYPE "public"."billing_model" AS ENUM('PER_ACTIVE_USER', 'FLAT_FEE', 'FREE');--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('POST', 'COMMENT', 'JOB', 'FUNDING', 'EVENT');--> statement-breakpoint
CREATE TYPE "public"."event_kind" AS ENUM('CASUAL_MEETUP', 'ORGANISED_EVENT');--> statement-breakpoint
CREATE TYPE "public"."funding_kind" AS ENUM('SEEKING', 'OFFERING');--> statement-breakpoint
CREATE TYPE "public"."funding_stage" AS ENUM('IDEA', 'PRE_SEED', 'SEED', 'SERIES_A', 'SERIES_B_PLUS', 'GROWTH', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERNSHIP', 'FREELANCE');--> statement-breakpoint
CREATE TYPE "public"."marital_status" AS ENUM('SINGLE', 'MARRIED', 'PREFER_NOT_TO_SAY');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('MEMBER', 'TENANT_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('MEMBERSHIP_APPROVED', 'MEMBERSHIP_REJECTED', 'MEMBERSHIP_SUSPENDED', 'MEMBERSHIP_REINSTATED', 'CONTENT_APPROVED', 'CONTENT_REJECTED', 'CONTENT_REMOVED', 'POST_COMMENT', 'POST_REACTION', 'EVENT_RSVP', 'EVENT_CANCELLED', 'NEW_MEMBER_PENDING', 'CONTENT_PENDING', 'REPORT_FILED', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."profession_type" AS ENUM('EMPLOYED', 'FOUNDER', 'BUSINESS_OWNER', 'STUDENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."push_platform" AS ENUM('IOS', 'ANDROID', 'WEB');--> statement-breakpoint
CREATE TYPE "public"."reaction_type" AS ENUM('LIKE', 'LOVE', 'CELEBRATE', 'INSIGHTFUL');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'MISINFORMATION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'RESOLVED', 'DISMISSED');--> statement-breakpoint
CREATE TYPE "public"."rsvp_status" AS ENUM('YES', 'NO', 'MAYBE');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('ACTIVE', 'SUSPENDED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."tenant_type" AS ENUM('UNIVERSITY', 'COLLEGE', 'SCHOOL', 'OTHER');--> statement-breakpoint
CREATE TABLE "push_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"platform" "push_platform" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_region" char(2),
	"display_name" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"billing_model" "billing_model" NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'MONTHLY' NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"price_per_active_user_minor" integer,
	"flat_fee_minor" integer,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_billing_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"billing_plan_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"approved_member_count" integer NOT NULL,
	"active_member_count" integer NOT NULL,
	"new_member_count" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"notes" text,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"member_approval_mode" "approval_mode" DEFAULT 'ADMIN_APPROVAL' NOT NULL,
	"content_moderation_mode" "approval_mode" DEFAULT 'AUTO_APPROVE' NOT NULL,
	"allow_self_registration" boolean DEFAULT true NOT NULL,
	"min_batch_year" integer DEFAULT 1950 NOT NULL,
	"max_batch_year" integer DEFAULT 2032 NOT NULL,
	"features" jsonb DEFAULT '{"feed":true,"jobs":true,"funding":true,"events":true,"directory":true}'::jsonb NOT NULL,
	"updated_by_user_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text,
	"type" "tenant_type" DEFAULT 'COLLEGE' NOT NULL,
	"status" "tenant_status" DEFAULT 'ACTIVE' NOT NULL,
	"city" text,
	"country" char(2),
	"logo_url" text,
	"cover_image_url" text,
	"primary_color" text DEFAULT '#1d4ed8' NOT NULL,
	"secondary_color" text DEFAULT '#0f172a' NOT NULL,
	"tagline" text,
	"welcome_message" text,
	"website_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'MEMBER' NOT NULL,
	"status" "membership_status" DEFAULT 'PENDING' NOT NULL,
	"status_reason" text,
	"status_changed_at" timestamp with time zone,
	"status_changed_by_user_id" uuid,
	"full_name" text NOT NULL,
	"batch_year" integer NOT NULL,
	"date_of_birth" date,
	"profession_type" "profession_type" NOT NULL,
	"company_name" text,
	"designation" text,
	"city" text,
	"country" char(2),
	"marital_status" "marital_status",
	"kids_count" smallint,
	"bio" text,
	"linkedin_url" text,
	"interests" text[] DEFAULT '{}'::text[] NOT NULL,
	"avatar_url" text,
	"is_phone_visible" boolean DEFAULT false NOT NULL,
	"extra" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_active_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_seekers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"note" text NOT NULL,
	"preferred_roles" text,
	"preferred_locations" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"company_name" text NOT NULL,
	"location" text,
	"is_remote" boolean DEFAULT false NOT NULL,
	"job_type" "job_type" NOT NULL,
	"description" text NOT NULL,
	"apply_url" text,
	"contact_email" text,
	"contact_phone" text,
	"salary_range" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funding_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"kind" "funding_kind" NOT NULL,
	"title" text NOT NULL,
	"stage" "funding_stage",
	"amount_min_minor" bigint,
	"amount_max_minor" bigint,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"pitch" text NOT NULL,
	"sectors" text[] DEFAULT '{}'::text[] NOT NULL,
	"website_url" text,
	"contact_email" text,
	"contact_phone" text,
	"is_closed" boolean DEFAULT false NOT NULL,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_reactions" (
	"post_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "reaction_type" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "post_reactions_post_id_membership_id_pk" PRIMARY KEY("post_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"image_urls" text[] DEFAULT '{}'::text[] NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "rsvp_status" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_rsvps_event_id_membership_id_pk" PRIMARY KEY("event_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"author_membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"kind" "event_kind" NOT NULL,
	"city" text NOT NULL,
	"venue_name" text,
	"address" text,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"max_attendees" integer,
	"cover_image_url" text,
	"is_cancelled" boolean DEFAULT false NOT NULL,
	"yes_count" integer DEFAULT 0 NOT NULL,
	"maybe_count" integer DEFAULT 0 NOT NULL,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_end_after_start" CHECK ("events"."end_at" IS NULL OR "events"."end_at" > "events"."start_at"),
	CONSTRAINT "events_max_attendees_positive" CHECK ("events"."max_attendees" IS NULL OR "events"."max_attendees" > 0)
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reporter_membership_id" uuid NOT NULL,
	"content_type" "content_type" NOT NULL,
	"content_id" uuid NOT NULL,
	"reason" "report_reason" NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_plans" ADD CONSTRAINT "tenant_billing_plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_plans" ADD CONSTRAINT "tenant_billing_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_snapshots" ADD CONSTRAINT "tenant_billing_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_snapshots" ADD CONSTRAINT "tenant_billing_snapshots_billing_plan_id_tenant_billing_plans_id_fk" FOREIGN KEY ("billing_plan_id") REFERENCES "public"."tenant_billing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_billing_snapshots" ADD CONSTRAINT "tenant_billing_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_status_changed_by_user_id_users_id_fk" FOREIGN KEY ("status_changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_seekers" ADD CONSTRAINT "job_seekers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_seekers" ADD CONSTRAINT "job_seekers_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_listings" ADD CONSTRAINT "funding_listings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_listings" ADD CONSTRAINT "funding_listings_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funding_listings" ADD CONSTRAINT "funding_listings_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_comments" ADD CONSTRAINT "post_comments_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reactions" ADD CONSTRAINT "post_reactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_author_membership_id_memberships_id_fk" FOREIGN KEY ("author_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_membership_id_memberships_id_fk" FOREIGN KEY ("reporter_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_memberships_id_fk" FOREIGN KEY ("recipient_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_membership_id_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_tokens_user_idx" ON "push_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "billing_plans_tenant_from_idx" ON "tenant_billing_plans" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_snapshots_period_uq" ON "tenant_billing_snapshots" USING btree ("tenant_id","period_start","period_end");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_uq" ON "memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_status_idx" ON "memberships" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "memberships_tenant_batch_idx" ON "memberships" USING btree ("tenant_id","batch_year");--> statement-breakpoint
CREATE INDEX "memberships_tenant_city_idx" ON "memberships" USING btree ("tenant_id","city");--> statement-breakpoint
CREATE INDEX "memberships_tenant_country_idx" ON "memberships" USING btree ("tenant_id","country");--> statement-breakpoint
CREATE INDEX "memberships_tenant_profession_idx" ON "memberships" USING btree ("tenant_id","profession_type");--> statement-breakpoint
CREATE INDEX "memberships_tenant_role_idx" ON "memberships" USING btree ("tenant_id","role");--> statement-breakpoint
CREATE INDEX "memberships_tenant_active_idx" ON "memberships" USING btree ("tenant_id","last_active_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_seekers_tenant_membership_uq" ON "job_seekers" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "job_seekers_tenant_active_idx" ON "job_seekers" USING btree ("tenant_id","is_active","updated_at");--> statement-breakpoint
CREATE INDEX "jobs_tenant_status_created_idx" ON "jobs" USING btree ("tenant_id","moderation_status","created_at");--> statement-breakpoint
CREATE INDEX "jobs_tenant_author_idx" ON "jobs" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
CREATE INDEX "jobs_tenant_type_idx" ON "jobs" USING btree ("tenant_id","job_type");--> statement-breakpoint
CREATE INDEX "funding_tenant_kind_status_created_idx" ON "funding_listings" USING btree ("tenant_id","kind","moderation_status","created_at");--> statement-breakpoint
CREATE INDEX "funding_tenant_author_idx" ON "funding_listings" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
CREATE INDEX "post_comments_post_created_idx" ON "post_comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "post_comments_tenant_author_idx" ON "post_comments" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
CREATE INDEX "post_reactions_tenant_membership_idx" ON "post_reactions" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "posts_tenant_status_pinned_created_idx" ON "posts" USING btree ("tenant_id","moderation_status","is_pinned","created_at");--> statement-breakpoint
CREATE INDEX "posts_tenant_author_idx" ON "posts" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
CREATE INDEX "event_rsvps_event_status_idx" ON "event_rsvps" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "events_tenant_status_start_idx" ON "events" USING btree ("tenant_id","moderation_status","start_at");--> statement-breakpoint
CREATE INDEX "events_tenant_author_idx" ON "events" USING btree ("tenant_id","author_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_unique_reporter_uq" ON "content_reports" USING btree ("tenant_id","content_type","content_id","reporter_membership_id");--> statement-breakpoint
CREATE INDEX "content_reports_tenant_status_created_idx" ON "content_reports" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_tenant_content_idx" ON "content_reports" USING btree ("tenant_id","content_type","content_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("recipient_membership_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_created_idx" ON "audit_log" USING btree ("actor_user_id","created_at");