CREATE TYPE "public"."referral_status" AS ENUM('REQUESTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'REFERRAL_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'REFERRAL_ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'REFERRAL_DECLINED';--> statement-breakpoint
CREATE TABLE "referral_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid,
	"job_title" text NOT NULL,
	"job_company" text NOT NULL,
	"poster_membership_id" uuid,
	"requester_membership_id" uuid,
	"status" "referral_status" DEFAULT 'REQUESTED' NOT NULL,
	"note" text NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid,
	"responded_at" timestamp (3) with time zone,
	"accepted_at" timestamp (3) with time zone,
	"closed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_requests_not_self" CHECK ("referral_requests"."poster_membership_id" <> "referral_requests"."requester_membership_id")
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "can_refer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_poster_membership_id_memberships_id_fk" FOREIGN KEY ("poster_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_requester_membership_id_memberships_id_fk" FOREIGN KEY ("requester_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_requests" ADD CONSTRAINT "referral_requests_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_requests_job_requester_uq" ON "referral_requests" USING btree ("job_id","requester_membership_id") WHERE "referral_requests"."status" in ('REQUESTED', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE INDEX "referral_requests_job_created_idx" ON "referral_requests" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_requests_poster_created_idx" ON "referral_requests" USING btree ("poster_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_requests_requester_created_idx" ON "referral_requests" USING btree ("requester_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_requests_conversation_idx" ON "referral_requests" USING btree ("conversation_id");