CREATE TYPE "public"."invitation_status" AS ENUM('PENDING', 'SENT', 'ACCEPTED', 'REVOKED');--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"phone_e164" text NOT NULL,
	"email" text,
	"full_name" text,
	"batch_year" integer,
	"field_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"token" text NOT NULL,
	"status" "invitation_status" DEFAULT 'PENDING' NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"send_count" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp (3) with time zone,
	"invited_by_user_id" uuid,
	"accepted_membership_id" uuid,
	"accepted_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD COLUMN "invite_auto_approve" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_membership_id_memberships_id_fk" FOREIGN KEY ("accepted_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_tenant_phone_uq" ON "invitations" USING btree ("tenant_id","phone_e164");--> statement-breakpoint
CREATE INDEX "invitations_tenant_status_created_idx" ON "invitations" USING btree ("tenant_id","status","created_at");