CREATE TYPE "public"."mentor_area" AS ENUM('CAREER_ADVICE', 'HIGHER_STUDIES', 'ENTREPRENEURSHIP', 'SOFTWARE_IT', 'FINANCE', 'CONSULTING', 'MARKETING_SALES', 'DESIGN_MEDIA', 'LAW', 'HEALTHCARE', 'PUBLIC_SERVICE', 'WORKING_ABROAD');--> statement-breakpoint
CREATE TYPE "public"."mentor_availability" AS ENUM('WEEKLY', 'FORTNIGHTLY', 'MONTHLY', 'ONE_OFF');--> statement-breakpoint
CREATE TYPE "public"."mentorship_status" AS ENUM('REQUESTED', 'ACCEPTED', 'DECLINED', 'ENDED');--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'MENTORSHIP_REQUESTED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'MENTORSHIP_ACCEPTED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'MENTORSHIP_DECLINED';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'MENTORSHIP_ENDED';--> statement-breakpoint
CREATE TABLE "mentor_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"areas" "mentor_area"[] NOT NULL,
	"availability" "mentor_availability" NOT NULL,
	"availability_note" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mentorships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mentor_membership_id" uuid,
	"mentee_membership_id" uuid,
	"status" "mentorship_status" DEFAULT 'REQUESTED' NOT NULL,
	"note" text NOT NULL,
	"suppressed" boolean DEFAULT false NOT NULL,
	"conversation_id" uuid,
	"responded_at" timestamp (3) with time zone,
	"accepted_at" timestamp (3) with time zone,
	"ended_at" timestamp (3) with time zone,
	"ended_by_membership_id" uuid,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mentorships_not_self" CHECK ("mentorships"."mentor_membership_id" <> "mentorships"."mentee_membership_id")
);
--> statement-breakpoint
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentor_profiles" ADD CONSTRAINT "mentor_profiles_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentor_membership_id_memberships_id_fk" FOREIGN KEY ("mentor_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_mentee_membership_id_memberships_id_fk" FOREIGN KEY ("mentee_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentorships" ADD CONSTRAINT "mentorships_ended_by_membership_id_memberships_id_fk" FOREIGN KEY ("ended_by_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mentor_profiles_tenant_membership_uq" ON "mentor_profiles" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "mentor_profiles_tenant_active_idx" ON "mentor_profiles" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "mentorships_open_pair_uq" ON "mentorships" USING btree ("tenant_id","mentor_membership_id","mentee_membership_id") WHERE "mentorships"."status" in ('REQUESTED', 'ACCEPTED');--> statement-breakpoint
CREATE INDEX "mentorships_mentor_created_idx" ON "mentorships" USING btree ("mentor_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "mentorships_mentee_created_idx" ON "mentorships" USING btree ("mentee_membership_id","created_at");--> statement-breakpoint
CREATE INDEX "mentorships_conversation_idx" ON "mentorships" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "mentorships_ended_by_idx" ON "mentorships" USING btree ("ended_by_membership_id");