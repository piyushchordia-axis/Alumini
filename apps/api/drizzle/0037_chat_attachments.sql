CREATE TYPE "public"."chat_attachment_kind" AS ENUM('PHOTO', 'FILE');--> statement-breakpoint
CREATE TABLE "chat_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid,
	"uploader_membership_id" uuid,
	"kind" "chat_attachment_kind" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"storage_key" text NOT NULL,
	"thumb_key" text,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"file_name" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_attachments_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "chat_attachments_thumb_key_unique" UNIQUE("thumb_key"),
	CONSTRAINT "chat_attachments_photo_shape" CHECK ("chat_attachments"."kind" <> 'PHOTO' or ("chat_attachments"."thumb_key" is not null and "chat_attachments"."width" is not null and "chat_attachments"."height" is not null)),
	CONSTRAINT "chat_attachments_file_shape" CHECK ("chat_attachments"."kind" <> 'FILE' or ("chat_attachments"."file_name" is not null and "chat_attachments"."thumb_key" is null)),
	CONSTRAINT "chat_attachments_byte_size_positive" CHECK ("chat_attachments"."byte_size" > 0),
	CONSTRAINT "chat_attachments_position_not_negative" CHECK ("chat_attachments"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_conversation_id_chat_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."chat_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_chat_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."chat_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_uploader_membership_id_memberships_id_fk" FOREIGN KEY ("uploader_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_attachments_message_position_uq" ON "chat_attachments" USING btree ("message_id","position");--> statement-breakpoint
CREATE INDEX "chat_attachments_conversation_idx" ON "chat_attachments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_uploader_idx" ON "chat_attachments" USING btree ("uploader_membership_id");--> statement-breakpoint
CREATE INDEX "chat_attachments_unsent_created_idx" ON "chat_attachments" USING btree ("created_at") WHERE "chat_attachments"."message_id" is null;