CREATE TYPE "public"."message_channel" AS ENUM('WHATSAPP', 'SMS', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."outbound_message_status" AS ENUM('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED');--> statement-breakpoint
CREATE TABLE "outbound_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"type" text NOT NULL,
	"status" "outbound_message_status" DEFAULT 'QUEUED' NOT NULL,
	"channels" "message_channel"[] NOT NULL,
	"channel" "message_channel",
	"provider" text,
	"provider_message_id" text,
	"to_phone" text,
	"to_email" text,
	"to_name" text,
	"recipient_user_id" uuid,
	"context_type" text,
	"context_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_error" text,
	"sent_at" timestamp (3) with time zone,
	"delivered_at" timestamp (3) with time zone,
	"failed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_messages" ADD CONSTRAINT "outbound_messages_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_dedupe_uq" ON "outbound_messages" USING btree ("dedupe_key") WHERE "outbound_messages"."dedupe_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_messages_provider_id_uq" ON "outbound_messages" USING btree ("provider","provider_message_id") WHERE "outbound_messages"."provider_message_id" is not null;--> statement-breakpoint
CREATE INDEX "outbound_messages_tenant_created_idx" ON "outbound_messages" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "outbound_messages_context_idx" ON "outbound_messages" USING btree ("context_type","context_id");--> statement-breakpoint
CREATE INDEX "outbound_messages_pending_idx" ON "outbound_messages" USING btree ("status","updated_at") WHERE "outbound_messages"."status" in ('QUEUED', 'SENDING');