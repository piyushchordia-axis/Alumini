ALTER TYPE "public"."notification_type" ADD VALUE 'ANNOUNCEMENT';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'CELEBRATION';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'CELEBRATION_WISH';--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"membership_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_recipient_dedupe_uq" ON "notifications" USING btree ("recipient_membership_id","dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL;