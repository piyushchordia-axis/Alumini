ALTER TABLE "tenant_billing_plans" ADD COLUMN "included_channels" "message_channel"[] DEFAULT '{}'::message_channel[] NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_plans" ADD COLUMN "message_rates_minor" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_snapshots" ADD COLUMN "message_counts" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_billing_snapshots" ADD COLUMN "message_amount_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "outbound_messages_tenant_sent_idx" ON "outbound_messages" USING btree ("tenant_id","sent_at") WHERE "outbound_messages"."status" in ('SENT', 'DELIVERED', 'READ');