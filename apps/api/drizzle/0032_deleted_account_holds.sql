CREATE TABLE "deleted_account_blocks" (
	"phone_hash" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"blocker_membership_id" uuid NOT NULL,
	"blocked_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "deleted_account_blocks_phone_hash_blocker_membership_id_pk" PRIMARY KEY("phone_hash","blocker_membership_id")
);
--> statement-breakpoint
CREATE TABLE "deleted_account_suspensions" (
	"phone_hash" text NOT NULL,
	"tenant_id" uuid NOT NULL,
	"suspended_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "deleted_account_suspensions_phone_hash_tenant_id_pk" PRIMARY KEY("phone_hash","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "deleted_account_blocks" ADD CONSTRAINT "deleted_account_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_account_blocks" ADD CONSTRAINT "deleted_account_blocks_blocker_membership_id_memberships_id_fk" FOREIGN KEY ("blocker_membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_account_suspensions" ADD CONSTRAINT "deleted_account_suspensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_account_blocks_blocker_idx" ON "deleted_account_blocks" USING btree ("blocker_membership_id");--> statement-breakpoint
-- Added by hand: deletions audited before this kept the raw phone number. A deleted account keeps only its keyed hash.
UPDATE "audit_log" SET "metadata" = "metadata" - 'phone' WHERE "action" = 'auth.account_deleted';
