CREATE TYPE "public"."payment_order_status" AS ENUM('CREATED', 'ATTEMPTED', 'PAID', 'FAILED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."payment_purpose" AS ENUM('EVENT_TICKET', 'DONATION');--> statement-breakpoint
CREATE TYPE "public"."payment_refund_status" AS ENUM('PENDING', 'PROCESSED', 'FAILED');--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"purpose" "payment_purpose" NOT NULL,
	"reference_id" text NOT NULL,
	"payer_membership_id" uuid,
	"payer_user_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) DEFAULT 'INR' NOT NULL,
	"amount_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"status" "payment_order_status" DEFAULT 'CREATED' NOT NULL,
	"provider" text NOT NULL,
	"provider_order_id" text,
	"provider_payment_id" text,
	"receipt" text NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_code" text,
	"failure_reason" text,
	"expires_at" timestamp (3) with time zone,
	"paid_at" timestamp (3) with time zone,
	"refunded_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_orders_amount_positive" CHECK ("payment_orders"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payment_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"provider_refund_id" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "payment_refund_status" DEFAULT 'PENDING' NOT NULL,
	"reason" text,
	"requested_by_user_id" uuid,
	"processed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp (3) with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_payer_membership_id_memberships_id_fk" FOREIGN KEY ("payer_membership_id") REFERENCES "public"."memberships"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_order_id_payment_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD CONSTRAINT "payment_refunds_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_provider_order_uq" ON "payment_orders" USING btree ("provider","provider_order_id") WHERE "payment_orders"."provider_order_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_provider_payment_uq" ON "payment_orders" USING btree ("provider","provider_payment_id") WHERE "payment_orders"."provider_payment_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_orders_reference_idx" ON "payment_orders" USING btree ("tenant_id","purpose","reference_id");--> statement-breakpoint
CREATE INDEX "payment_orders_payer_idx" ON "payment_orders" USING btree ("payer_membership_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_refunds_provider_refund_uq" ON "payment_refunds" USING btree ("provider","provider_refund_id");--> statement-breakpoint
CREATE INDEX "payment_refunds_order_idx" ON "payment_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_uq" ON "payment_webhook_events" USING btree ("provider","event_id");