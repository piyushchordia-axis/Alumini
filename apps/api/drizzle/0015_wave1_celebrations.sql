CREATE TABLE "celebration_wishes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sender_membership_id" uuid NOT NULL,
	"recipient_membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"day" date NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_job_runs" (
	"job" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp (3) with time zone,
	CONSTRAINT "tenant_job_runs_job_tenant_id_period_key_pk" PRIMARY KEY("job","tenant_id","period_key")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "celebrate_birthday" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "celebrate_anniversary" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "celebration_wishes" ADD CONSTRAINT "celebration_wishes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_wishes" ADD CONSTRAINT "celebration_wishes_sender_membership_id_memberships_id_fk" FOREIGN KEY ("sender_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_wishes" ADD CONSTRAINT "celebration_wishes_recipient_membership_id_memberships_id_fk" FOREIGN KEY ("recipient_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_job_runs" ADD CONSTRAINT "tenant_job_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "celebration_wishes_once_uq" ON "celebration_wishes" USING btree ("sender_membership_id","recipient_membership_id","day","kind");--> statement-breakpoint
CREATE INDEX "celebration_wishes_recipient_day_idx" ON "celebration_wishes" USING btree ("recipient_membership_id","day");--> statement-breakpoint
CREATE INDEX "tenant_job_runs_done_idx" ON "tenant_job_runs" USING btree ("job","period_key") WHERE "tenant_job_runs"."status" = 'DONE';--> statement-breakpoint
-- Birthdays by month and day within an institution (extract() on a date is immutable, so it can be indexed).
CREATE INDEX "memberships_birthday_idx" ON "memberships" ("tenant_id", ((extract(month from "date_of_birth") * 100 + extract(day from "date_of_birth"))::int)) WHERE "date_of_birth" IS NOT NULL;
