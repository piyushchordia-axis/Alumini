ALTER TABLE "memberships" ALTER COLUMN "batch_year" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "start_year" integer;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "start_year" integer;--> statement-breakpoint
CREATE INDEX "memberships_tenant_years_idx" ON "memberships" USING btree ("tenant_id","start_year","batch_year");--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_years_order" CHECK ("memberships"."batch_year" IS NULL OR "memberships"."start_year" <= "memberships"."batch_year");--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_years_order" CHECK ("invitations"."start_year" IS NULL OR "invitations"."batch_year" IS NULL OR "invitations"."start_year" <= "invitations"."batch_year");--> statement-breakpoint
-- Backfill, added by hand: the next migration makes start_year required. Not live: a guess from the year they finished,
-- by institution type. A community's "batch" becomes the year they joined, and its end is cleared (still a member), on its
-- invitations too.
UPDATE "memberships" AS m SET "start_year" = least(greatest(m."batch_year" - CASE t."type" WHEN 'SCHOOL' THEN 12 WHEN 'OTHER' THEN 0 ELSE 4 END, 1930), extract(year from now())::int)
  FROM "tenants" AS t WHERE t."id" = m."tenant_id";--> statement-breakpoint
UPDATE "memberships" AS m SET "batch_year" = NULL FROM "tenants" AS t WHERE t."id" = m."tenant_id" AND t."type" = 'OTHER';--> statement-breakpoint
UPDATE "invitations" AS i SET "start_year" = least(i."batch_year", extract(year from now())::int), "batch_year" = NULL FROM "tenants" AS t WHERE t."id" = i."tenant_id" AND t."type" = 'OTHER' AND i."batch_year" IS NOT NULL;
