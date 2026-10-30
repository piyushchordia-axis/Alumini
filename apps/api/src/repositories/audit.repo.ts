import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { auditLog, memberships } from "../db/schema";

export type AuditRow = typeof auditLog.$inferSelect;

export interface AuditFilters {
  tenantId?: string | null;
  action?: string;
  actorUserId?: string;
  page: number;
  pageSize: number;
}

export async function listAudit(
  db: DbClient,
  f: AuditFilters,
): Promise<{ rows: Array<{ entry: AuditRow; actorName: string | null }>; total: number }> {
  const conds: SQL[] = [];
  if (f.tenantId !== undefined) {
    conds.push(f.tenantId === null ? sql`${auditLog.tenantId} IS NULL` : eq(auditLog.tenantId, f.tenantId));
  }
  if (f.action) conds.push(sql`${auditLog.action} LIKE ${f.action + "%"}`);
  if (f.actorUserId) conds.push(eq(auditLog.actorUserId, f.actorUserId));
  const where = conds.length ? and(...conds) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select({ entry: auditLog, actorName: memberships.fullName })
      .from(auditLog)
      .leftJoin(memberships, eq(memberships.id, auditLog.actorMembershipId))
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export async function listAuditForMembership(db: DbClient, tenantId: string, membershipId: string, limit = 20): Promise<AuditRow[]> {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.tenantId, tenantId), or(eq(auditLog.targetId, membershipId), eq(auditLog.actorMembershipId, membershipId))))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
