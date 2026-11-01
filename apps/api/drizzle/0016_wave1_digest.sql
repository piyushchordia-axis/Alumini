CREATE TABLE "tenant_digests" (
	"tenant_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_digests_tenant_id_week_start_pk" PRIMARY KEY("tenant_id","week_start")
);
--> statement-breakpoint
ALTER TABLE "tenant_digests" ADD CONSTRAINT "tenant_digests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;