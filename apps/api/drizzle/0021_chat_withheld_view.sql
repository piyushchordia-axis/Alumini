ALTER TABLE "chat_participants" ADD COLUMN "withheld_state" "chat_direct_state";--> statement-breakpoint
ALTER TABLE "chat_participants" ADD COLUMN "withheld_requested_at" timestamp (3) with time zone;--> statement-breakpoint
ALTER TABLE "chat_participants" ADD COLUMN "withheld_request_count" integer;--> statement-breakpoint
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_not_self" CHECK ("chat_blocks"."blocker_membership_id" <> "chat_blocks"."blocked_membership_id");