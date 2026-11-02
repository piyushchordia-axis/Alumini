import { and, desc, eq, getViewSelectedFields, inArray, sql, type SQL } from "drizzle-orm";
import type { ContentType, ModerationStatus } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { contentReports, memberships, moderationItems } from "../db/schema";
import type { MembershipRow } from "../types/request";

export type ModerationItemRow = typeof moderationItems.$inferSelect;

export interface ModerationQueueFilters {
  status: ModerationStatus;
  contentType?: ContentType;
  page: number;
  pageSize: number;
}

export async function listModerationItems(
  db: DbClient,
  tenantId: string,
  f: ModerationQueueFilters,
): Promise<{ rows: Array<{ item: ModerationItemRow; author: MembershipRow | null; reportCount: number }>; total: number }> {
  const conds: SQL[] = [eq(moderationItems.tenantId, tenantId), eq(moderationItems.moderationStatus, f.status)];
  if (f.contentType) conds.push(eq(moderationItems.contentType, f.contentType));
  const where = and(...conds);
  const [rows, [count]] = await Promise.all([
    db
      .select({ item: getViewSelectedFields(moderationItems), author: memberships })
      .from(moderationItems)
      // A left join: an inner one would drop rows with no author, which the count below still includes.
      .leftJoin(memberships, eq(memberships.id, moderationItems.authorMembershipId))
      .where(where)
      .orderBy(desc(moderationItems.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(moderationItems).where(where),
  ]);
  const counts = await countOpenReportsFor(
    db,
    tenantId,
    rows.map((r) => ({ contentType: r.item.contentType, contentId: r.item.id })),
  );
  return {
    rows: rows.map((r) => ({ ...r, reportCount: counts.get(`${r.item.contentType}:${r.item.id}`) ?? 0 })),
    total: count?.count ?? 0,
  };
}

export async function findModerationItem(db: DbClient, tenantId: string, contentType: ContentType, id: string): Promise<ModerationItemRow | undefined> {
  const [row] = await db
    .select()
    .from(moderationItems)
    .where(and(eq(moderationItems.tenantId, tenantId), eq(moderationItems.contentType, contentType), eq(moderationItems.id, id)))
    .limit(1);
  return row;
}

export async function countPendingContent(db: DbClient, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(moderationItems)
    .where(and(eq(moderationItems.tenantId, tenantId), eq(moderationItems.moderationStatus, "PENDING")));
  return row?.count ?? 0;
}

export async function countOpenReportsFor(
  db: DbClient,
  tenantId: string,
  refs: Array<{ contentType: ContentType; contentId: string }>,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (refs.length === 0) return out;
  const rows = await db
    .select({ contentType: contentReports.contentType, contentId: contentReports.contentId, count: sql<number>`count(*)::int` })
    .from(contentReports)
    .where(
      and(
        eq(contentReports.tenantId, tenantId),
        eq(contentReports.status, "OPEN"),
        inArray(
          contentReports.contentId,
          refs.map((r) => r.contentId),
        ),
      ),
    )
    .groupBy(contentReports.contentType, contentReports.contentId);
  for (const r of rows) out.set(`${r.contentType}:${r.contentId}`, r.count);
  return out;
}
