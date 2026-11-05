ALTER TYPE "public"."upload_purpose" ADD VALUE 'backdrop';--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "appearance" jsonb DEFAULT '{}'::jsonb NOT NULL;