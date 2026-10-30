CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_full_name_trgm_idx" ON "memberships" USING gin (lower("full_name") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_company_trgm_idx" ON "memberships" USING gin (lower("company_name") gin_trgm_ops);--> statement-breakpoint
CREATE OR REPLACE VIEW "moderation_items" AS
  SELECT 'POST'::content_type AS content_type, id, tenant_id, author_membership_id,
         left(body, 120) AS title, body AS excerpt, moderation_status, moderated_at, created_at
  FROM posts
  UNION ALL
  SELECT 'COMMENT'::content_type, id, tenant_id, author_membership_id,
         left(body, 120), body, moderation_status, moderated_at, created_at
  FROM post_comments
  UNION ALL
  SELECT 'JOB'::content_type, id, tenant_id, author_membership_id,
         title, description, moderation_status, moderated_at, created_at
  FROM jobs
  UNION ALL
  SELECT 'FUNDING'::content_type, id, tenant_id, author_membership_id,
         title, pitch, moderation_status, moderated_at, created_at
  FROM funding_listings
  UNION ALL
  SELECT 'EVENT'::content_type, id, tenant_id, author_membership_id,
         title, description, moderation_status, moderated_at, created_at
  FROM events;
