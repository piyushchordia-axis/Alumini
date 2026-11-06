import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { auditLog, memberships } from "../db/schema";
import { reportNamesUser } from "./chatReports.repo";

export type AuditRow = typeof auditLog.$inferSelect;

/**
 * Leaves out what happened on a chat report naming this user, in SQL so paging and totals stay right. Every route that
 * returns audit rows goes through this, which is why the viewer is a required argument.
 */
const visibleTo = (viewerUserId: string): SQL => sql`not (starts_with(audit_log.action, 'chat_report.') and exists (select 1 from chat_reports where chat_reports.id = audit_log.target_id and ${reportNamesUser(viewerUserId)}))`;

export interface AuditFilters {
  viewerUserId: string;
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
  const conds: SQL[] = [visibleTo(f.viewerUserId)];
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
      // The id breaks ties, as rows written in one instant share createdAt: offset pages must not repeat or skip one.
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

/** The latest rows about a member or by them, each with its actor's name at the institution, as listAudit gives it. */
export async function listAuditForMembership(
  db: DbClient,
  tenantId: string,
  membershipId: string,
  viewerUserId: string,
  limit = 20,
): Promise<Array<{ entry: AuditRow; actorName: string | null }>> {
  return db
    .select({ entry: auditLog, actorName: memberships.fullName })
    .from(auditLog)
    .leftJoin(memberships, eq(memberships.id, auditLog.actorMembershipId))
    .where(and(eq(auditLog.tenantId, tenantId), or(eq(auditLog.targetId, membershipId), eq(auditLog.actorMembershipId, membershipId)), visibleTo(viewerUserId)))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit);
}
