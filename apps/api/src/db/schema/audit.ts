import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { memberships } from "./memberships";
import { tenants } from "./tenants";
import { users } from "./users";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorMembershipId: uuid("actor_membership_id").references(() => memberships.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_tenant_created_idx").on(t.tenantId, t.createdAt), index("audit_log_actor_created_idx").on(t.actorUserId, t.createdAt)],
);
