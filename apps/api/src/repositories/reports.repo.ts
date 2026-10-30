import { and, desc, eq, getViewSelectedFields, sql, type SQL } from "drizzle-orm";
import type { ContentType, ReportStatus } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { contentReports, memberships, moderationItems } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import type { ModerationItemRow } from "./moderation.repo";

export type ReportRow = typeof contentReports.$inferSelect;
export type ReportInsert = typeof contentReports.$inferInsert;

export async function insertReport(db: DbClient, values: ReportInsert): Promise<ReportRow | undefined> {
  const [row] = await db.insert(contentReports).values(values).onConflictDoNothing().returning();
  return row;
}

export async function findReportById(db: DbClient, tenantId: string, id: string): Promise<ReportRow | undefined> {
  const [row] = await db
    .select()
    .from(contentReports)
    .where(and(eq(contentReports.tenantId, tenantId), eq(contentReports.id, id)))
    .limit(1);
  return row;
}

export async function listReportsForReporter(
  db: DbClient,
  tenantId: string,
  reporterMembershipId: string,
  q: { cursor?: string; limit: number },
): Promise<CursorPage<ReportRow>> {
  const conds: SQL[] = [eq(contentReports.tenantId, tenantId), eq(contentReports.reporterMembershipId, reporterMembershipId)];
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(contentReports.createdAt, contentReports.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select()
    .from(contentReports)
    .where(and(...conds))
    .orderBy(desc(contentReports.createdAt), desc(contentReports.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.createdAt.toISOString(), id: r.id }), (r) => r);
}

export async function listReportsForAdmin(
  db: DbClient,
  tenantId: string,
  f: { status: ReportStatus; contentType?: ContentType; page: number; pageSize: number },
): Promise<{ rows: Array<{ report: ReportRow; reporter: MembershipRow; content: ModerationItemRow | null }>; total: number }> {
  const conds: SQL[] = [eq(contentReports.tenantId, tenantId), eq(contentReports.status, f.status)];
  if (f.contentType) conds.push(eq(contentReports.contentType, f.contentType));
  const where = and(...conds);
  const [rows, [count]] = await Promise.all([
    db
      .select({ report: contentReports, reporter: memberships, content: getViewSelectedFields(moderationItems) })
      .from(contentReports)
      .innerJoin(memberships, eq(memberships.id, contentReports.reporterMembershipId))
      .leftJoin(
        moderationItems,
        and(eq(moderationItems.id, contentReports.contentId), eq(moderationItems.contentType, contentReports.contentType)),
      )
      .where(where)
      .orderBy(desc(contentReports.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(contentReports).where(where),
  ]);
  return { rows: rows.map((r) => ({ ...r, content: r.content ?? null })), total: count?.count ?? 0 };
}

export async function updateReport(db: DbClient, tenantId: string, id: string, values: Partial<ReportInsert>): Promise<ReportRow | undefined> {
  const [row] = await db
    .update(contentReports)
    .set(values)
    .where(and(eq(contentReports.tenantId, tenantId), eq(contentReports.id, id)))
    .returning();
  return row;
}

/** Resolves every OPEN report on the same content (used after a removal). */
export async function resolveOpenReportsForContent(
  db: DbClient,
  tenantId: string,
  contentType: ContentType,
  contentId: string,
  values: { resolvedByUserId: string; resolutionNote: string },
): Promise<number> {
  const rows = await db
    .update(contentReports)
    .set({ status: "RESOLVED", resolvedAt: new Date(), ...values })
    .where(
      and(
        eq(contentReports.tenantId, tenantId),
        eq(contentReports.contentType, contentType),
        eq(contentReports.contentId, contentId),
        eq(contentReports.status, "OPEN"),
      ),
    )
    .returning({ id: contentReports.id });
  return rows.length;
}

export async function countOpenReports(db: DbClient, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contentReports)
    .where(and(eq(contentReports.tenantId, tenantId), eq(contentReports.status, "OPEN")));
  return row?.count ?? 0;
}
