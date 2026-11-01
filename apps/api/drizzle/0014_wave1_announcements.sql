CREATE TYPE "public"."post_kind" AS ENUM('POST', 'ANNOUNCEMENT');--> statement-breakpoint
CREATE TABLE "post_announcements" (
	"post_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"channels" "message_channel"[] DEFAULT '{}'::message_channel[] NOT NULL,
	"notified_count" integer DEFAULT 0 NOT NULL,
	"messaged_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"fanout_started_at" timestamp (3) with time zone,
	"fanout_finished_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "kind" "post_kind" DEFAULT 'POST' NOT NULL;--> statement-breakpoint
ALTER TABLE "post_announcements" ADD CONSTRAINT "post_announcements_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_announcements" ADD CONSTRAINT "post_announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_announcements" ADD CONSTRAINT "post_announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- New column goes last (CREATE OR REPLACE VIEW can only append columns). post_kind was created above in this
-- migration with CREATE TYPE, so it can be used here.
CREATE OR REPLACE VIEW "moderation_items" AS
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
  FROM events;
