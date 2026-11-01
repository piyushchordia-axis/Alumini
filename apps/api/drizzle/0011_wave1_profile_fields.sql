CREATE TYPE "public"."profile_field_type" AS ENUM('TEXT', 'LONG_TEXT', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'BOOLEAN');--> statement-breakpoint
CREATE TYPE "public"."profile_field_visibility" AS ENUM('MEMBERS', 'ADMINS');--> statement-breakpoint
CREATE TABLE "member_field_values" (
	"membership_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_field_values_membership_id_field_id_pk" PRIMARY KEY("membership_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "tenant_profile_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"help_text" text,
	"type" "profile_field_type" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"visibility" "profile_field_visibility" DEFAULT 'MEMBERS' NOT NULL,
	"member_editable" boolean DEFAULT true NOT NULL,
	"filterable" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_field_values" ADD CONSTRAINT "member_field_values_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_field_values" ADD CONSTRAINT "member_field_values_field_id_tenant_profile_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."tenant_profile_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_field_values" ADD CONSTRAINT "member_field_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_profile_fields" ADD CONSTRAINT "tenant_profile_fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_field_values_field_idx" ON "member_field_values" USING btree ("field_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_profile_fields_key_uq" ON "tenant_profile_fields" USING btree ("tenant_id","key");--> statement-breakpoint
CREATE INDEX "tenant_profile_fields_tenant_pos_idx" ON "tenant_profile_fields" USING btree ("tenant_id","position");--> statement-breakpoint
-- extra-copy:start
-- One-time copy of the free-form memberships.extra JSON into TEXT profile fields visible to members. The column is
-- kept (no longer written) until a later release drops it. Skips institutions that already have fields, so it is
-- safe to run again. Keys become slugs; colliding slugs get a hash suffix.
WITH keys AS (
  SELECT DISTINCT m.tenant_id, e.key AS raw_key
  FROM memberships m
  CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(m.extra) = 'object' THEN m.extra ELSE '{}'::jsonb END) e
  WHERE NOT EXISTS (SELECT 1 FROM tenant_profile_fields f WHERE f.tenant_id = m.tenant_id)
),
slugs AS (
  SELECT tenant_id, raw_key, left(CASE WHEN s ~ '^[a-z]' THEN s ELSE 'f_' || s END, 30) AS base
  FROM (
    SELECT tenant_id, raw_key, coalesce(nullif(btrim(regexp_replace(lower(raw_key), '[^a-z0-9]+', '_', 'g'), '_'), ''), 'field') AS s
    FROM keys
  ) x
),
numbered AS (
  SELECT
    tenant_id,
    raw_key,
    CASE WHEN count(*) OVER (PARTITION BY tenant_id, base) > 1 THEN base || '_' || substr(md5(raw_key), 1, 6) ELSE base END AS key,
    row_number() OVER (PARTITION BY tenant_id ORDER BY raw_key) AS pos
  FROM slugs
),
inserted AS (
  INSERT INTO tenant_profile_fields (tenant_id, key, label, type, visibility, position)
  SELECT tenant_id, key, left(raw_key, 80), 'TEXT', 'MEMBERS', pos FROM numbered
  RETURNING id, tenant_id, key
)
INSERT INTO member_field_values (membership_id, field_id, tenant_id, value)
SELECT m.id, i.id, m.tenant_id, to_jsonb(left(btrim(e.value), 200))
FROM numbered n
JOIN inserted i ON i.tenant_id = n.tenant_id AND i.key = n.key
JOIN memberships m ON m.tenant_id = n.tenant_id
CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(m.extra) = 'object' THEN m.extra ELSE '{}'::jsonb END) e
WHERE e.key = n.raw_key AND e.value IS NOT NULL AND btrim(e.value) <> '';
-- extra-copy:end
