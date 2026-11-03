CREATE TYPE "public"."chat_group_visibility" AS ENUM('OPEN', 'INVITE_ONLY');--> statement-breakpoint
CREATE TABLE "chat_groups" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"approved_name" text,
	"approved_description" text,
	"visibility" "chat_group_visibility" NOT NULL,
	"owner_membership_id" uuid,
	"member_count" integer DEFAULT 0 NOT NULL,
	"moderation_status" "moderation_status" NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp (3) with time zone,
	"moderation_note" text,
	"approved_at" timestamp (3) with time zone,
	"archived_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_invite_declines" (
	"decliner_membership_id" uuid NOT NULL,
	"inviter_membership_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"declined_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_invite_declines_decliner_membership_id_inviter_membership_id_pk" PRIMARY KEY("decliner_membership_id","inviter_membership_id")
);
--> statement-breakpoint
ALTER TABLE "chat_participants" ADD COLUMN "invited_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD COLUMN "joined_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_owner_membership_id_memberships_id_fk" FOREIGN KEY ("owner_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_groups" ADD CONSTRAINT "chat_groups_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_invite_declines" ADD CONSTRAINT "chat_invite_declines_decliner_membership_id_memberships_id_fk" FOREIGN KEY ("decliner_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_invite_declines" ADD CONSTRAINT "chat_invite_declines_inviter_membership_id_memberships_id_fk" FOREIGN KEY ("inviter_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_invite_declines" ADD CONSTRAINT "chat_invite_declines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_groups_tenant_visibility_created_idx" ON "chat_groups" USING btree ("tenant_id","visibility","created_at");--> statement-breakpoint
CREATE INDEX "chat_groups_owner_idx" ON "chat_groups" USING btree ("owner_membership_id");--> statement-breakpoint
CREATE INDEX "chat_invite_declines_inviter_idx" ON "chat_invite_declines" USING btree ("inviter_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_participants_one_owner_uq" ON "chat_participants" USING btree ("conversation_id") WHERE "chat_participants"."role" = 'OWNER' and "chat_participants"."state" = 'ACTIVE';--> statement-breakpoint
-- The second rebuild of content_type, for the same reason as the first in 0019: all pending migrations run in one
-- transaction, and Postgres 16 can't use a value from ALTER TYPE ... ADD VALUE in the same batch, while the view below
-- needs the GROUP literal. Values from CREATE TYPE can be used, so the type is rebuilt, and the view and this column are
-- still its only dependents. Existing reports keep their values through the text cast.
DROP VIEW "moderation_items";--> statement-breakpoint
ALTER TYPE "public"."content_type" RENAME TO "content_type_old";--> statement-breakpoint
CREATE TYPE "public"."content_type" AS ENUM('POST', 'COMMENT', 'JOB', 'FUNDING', 'EVENT', 'BUSINESS', 'GROUP');--> statement-breakpoint
ALTER TABLE "content_reports" ALTER COLUMN "content_type" TYPE "public"."content_type" USING "content_type"::text::"public"."content_type";--> statement-breakpoint
DROP TYPE "public"."content_type_old";--> statement-breakpoint
-- A group is its name and description here and nothing else, so nothing in this view can reach a message. An archived
-- group has nothing left to moderate.
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
  FROM business_listings
  UNION ALL
  SELECT 'GROUP'::content_type, conversation_id, tenant_id, owner_membership_id,
         name, description, moderation_status, moderated_at, created_at, false, NULL::post_kind
  FROM chat_groups
  WHERE archived_at IS NULL;
