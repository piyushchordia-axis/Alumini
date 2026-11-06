ALTER TABLE "memberships" ADD COLUMN "welcome_done_at" timestamp (3) with time zone DEFAULT now();--> statement-breakpoint
-- Backfill, added by hand: the rows already here took the default, so they count as done. A membership that was never
-- approved hasn't had a first entry yet: it gets the walk-through once approved.
UPDATE "memberships" SET "welcome_done_at" = NULL WHERE "approved_at" IS NULL AND "status" <> 'APPROVED';