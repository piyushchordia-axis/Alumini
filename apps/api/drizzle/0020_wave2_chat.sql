CREATE TYPE "public"."chat_conversation_kind" AS ENUM('DIRECT', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."chat_direct_state" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."chat_message_kind" AS ENUM('TEXT', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."chat_origin" AS ENUM('MESSAGE_REQUEST', 'MENTORSHIP', 'REFERRAL', 'GROUP');--> statement-breakpoint
CREATE TYPE "public"."chat_participant_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."chat_participant_state" AS ENUM('INVITED', 'ACTIVE', 'LEFT', 'REMOVED');--> statement-breakpoint
CREATE TYPE "public"."chat_report_action" AS ENUM('NONE', 'REMOVE_MESSAGE');--> statement-breakpoint
CREATE TYPE "public"."chat_report_target_kind" AS ENUM('MESSAGE', 'MENTORSHIP_NOTE', 'REFERRAL_NOTE');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'CHAT_REPORT_FILED';--> statement-breakpoint
CREATE TABLE "chat_blocks" (
	"blocker_membership_id" uuid NOT NULL,
	"blocked_membership_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_blocks_blocker_membership_id_blocked_membership_id_pk" PRIMARY KEY("blocker_membership_id","blocked_membership_id")
);
--> statement-breakpoint
CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "chat_conversation_kind" NOT NULL,
	"origin" "chat_origin" NOT NULL,
	"origin_id" uuid,
	"last_seq" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp (3) with time zone NOT NULL,
	"direct_low_id" uuid,
	"direct_high_id" uuid,
	"direct_state" "chat_direct_state",
	"requester_membership_id" uuid,
	"requested_at" timestamp (3) with time zone,
	"request_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversations_direct_pair_order" CHECK ("chat_conversations"."direct_low_id" < "chat_conversations"."direct_high_id")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"sender_membership_id" uuid,
	"kind" "chat_message_kind" DEFAULT 'TEXT' NOT NULL,
	"body" text NOT NULL,
	"meta" jsonb,
	"client_key" text,
	"withheld" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp (3) with time zone,
	"removed_by_user_id" uuid,
	"removal_note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_participants" (
	"conversation_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"state" "chat_participant_state" DEFAULT 'ACTIVE' NOT NULL,
	"role" "chat_participant_role" DEFAULT 'MEMBER' NOT NULL,
	"joined_seq" integer DEFAULT 0 NOT NULL,
	"last_read_seq" integer DEFAULT 0 NOT NULL,
	"muted_until" timestamp (3) with time zone,
	"frozen_sort_at" timestamp (3) with time zone,
	"invited_by_membership_id" uuid,
	"invite_suppressed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_participants_conversation_id_membership_id_pk" PRIMARY KEY("conversation_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "chat_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"target_kind" "chat_report_target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"conversation_id" uuid,
	"reporter_membership_id" uuid,
	"reported_membership_id" uuid,
	"reason" "report_reason" NOT NULL,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"details" text,
	"context_message_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"note_snapshot" text,
	"resolution_action" "chat_report_action",
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp (3) with time zone,
	"resolution_note" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocker_membership_id_memberships_id_fk" FOREIGN KEY ("blocker_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blocked_membership_id_memberships_id_fk" FOREIGN KEY ("blocked_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_direct_low_id_memberships_id_fk" FOREIGN KEY ("direct_low_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_direct_high_id_memberships_id_fk" FOREIGN KEY ("direct_high_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_requester_membership_id_memberships_id_fk" FOREIGN KEY ("requester_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_membership_id_memberships_id_fk" FOREIGN KEY ("sender_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_removed_by_user_id_users_id_fk" FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_invited_by_membership_id_memberships_id_fk" FOREIGN KEY ("invited_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reporter_membership_id_memberships_id_fk" FOREIGN KEY ("reporter_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_reported_membership_id_memberships_id_fk" FOREIGN KEY ("reported_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_reports" ADD CONSTRAINT "chat_reports_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_blocks_blocked_idx" ON "chat_blocks" USING btree ("blocked_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_conversations_direct_pair_uq" ON "chat_conversations" USING btree ("tenant_id","direct_low_id","direct_high_id") WHERE "chat_conversations"."kind" = 'DIRECT';--> statement-breakpoint
CREATE INDEX "chat_conversations_direct_low_idx" ON "chat_conversations" USING btree ("direct_low_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_direct_high_idx" ON "chat_conversations" USING btree ("direct_high_id");--> statement-breakpoint
CREATE INDEX "chat_conversations_requester_idx" ON "chat_conversations" USING btree ("requester_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_conversation_seq_uq" ON "chat_messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_messages_client_key_uq" ON "chat_messages" USING btree ("conversation_id","sender_membership_id","client_key") WHERE "chat_messages"."client_key" is not null;--> statement-breakpoint
CREATE INDEX "chat_messages_sender_idx" ON "chat_messages" USING btree ("sender_membership_id");--> statement-breakpoint
CREATE INDEX "chat_participants_member_state_idx" ON "chat_participants" USING btree ("membership_id","state");--> statement-breakpoint
CREATE INDEX "chat_participants_invited_by_idx" ON "chat_participants" USING btree ("invited_by_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_reports_unique_reporter_uq" ON "chat_reports" USING btree ("target_kind","target_id","reporter_membership_id");--> statement-breakpoint
CREATE INDEX "chat_reports_tenant_status_created_idx" ON "chat_reports" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "chat_reports_conversation_idx" ON "chat_reports" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_reports_reporter_idx" ON "chat_reports" USING btree ("reporter_membership_id");--> statement-breakpoint
CREATE INDEX "chat_reports_reported_idx" ON "chat_reports" USING btree ("reported_membership_id");