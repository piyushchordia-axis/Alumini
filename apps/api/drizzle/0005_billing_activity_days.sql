CREATE TABLE "member_activity_days" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"day" date NOT NULL,
	CONSTRAINT "member_activity_days_membership_id_day_pk" PRIMARY KEY("membership_id","day")
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "approved_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "member_activity_days" ADD CONSTRAINT "member_activity_days_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_activity_days_tenant_day_idx" ON "member_activity_days" USING btree ("tenant_id","day");--> statement-breakpoint
CREATE INDEX "memberships_tenant_approved_idx" ON "memberships" USING btree ("tenant_id","approved_at");--> statement-breakpoint
-- Backfill: approved members get an approval time (best known: last status change, else join date) ...
UPDATE "memberships" SET "approved_at" = coalesce("status_changed_at", "created_at") WHERE "status" IN ('APPROVED', 'SUSPENDED') AND "approved_at" IS NULL;--> statement-breakpoint
-- ... and their last known activity becomes one activity day (in the default billing time zone, India).
INSERT INTO "member_activity_days" ("tenant_id", "membership_id", "day")
  SELECT "tenant_id", "id", ("last_active_at" AT TIME ZONE 'Asia/Kolkata')::date FROM "memberships" WHERE "last_active_at" IS NOT NULL
  ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Stamp the first approval whichever code path approves a membership (registration, admin, bulk approve, seeds).
CREATE OR REPLACE FUNCTION "memberships_set_approved_at"() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'APPROVED' AND NEW."approved_at" IS NULL THEN
    NEW."approved_at" := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "memberships_approved_at_trg" BEFORE INSERT OR UPDATE OF "status" ON "memberships"
  FOR EACH ROW EXECUTE FUNCTION "memberships_set_approved_at"();
