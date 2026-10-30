import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { FundingListQuery } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { fundingListings, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import { escapeLike, type ModerationPatch } from "./content.common";

export type FundingRow = typeof fundingListings.$inferSelect;
export type FundingInsert = typeof fundingListings.$inferInsert;
export type FundingWithAuthor = { listing: FundingRow; author: MembershipRow };

export async function listFunding(
  db: DbClient,
  tenantId: string,
  q: FundingListQuery,
  viewerMembershipId: string,
): Promise<CursorPage<FundingWithAuthor>> {
  const conds: SQL[] = [eq(fundingListings.tenantId, tenantId)];
  if (q.mine) {
    conds.push(eq(fundingListings.authorMembershipId, viewerMembershipId));
  } else {
    conds.push(eq(fundingListings.moderationStatus, "APPROVED"));
    if (!q.includeClosed) conds.push(eq(fundingListings.isClosed, false));
  }
  if (q.kind) conds.push(eq(fundingListings.kind, q.kind));
  if (q.stage) conds.push(eq(fundingListings.stage, q.stage));
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(fundingListings.title, p), ilike(fundingListings.pitch, p))!);
  }
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(fundingListings.createdAt, fundingListings.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ listing: fundingListings, author: memberships })
    .from(fundingListings)
    .innerJoin(memberships, eq(memberships.id, fundingListings.authorMembershipId))
    .where(and(...conds))
    .orderBy(desc(fundingListings.createdAt), desc(fundingListings.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.listing.createdAt.toISOString(), id: r.listing.id }), (r) => r);
}

export async function findFundingWithAuthor(db: DbClient, tenantId: string, id: string): Promise<FundingWithAuthor | undefined> {
  const [row] = await db
    .select({ listing: fundingListings, author: memberships })
    .from(fundingListings)
    .innerJoin(memberships, eq(memberships.id, fundingListings.authorMembershipId))
    .where(and(eq(fundingListings.tenantId, tenantId), eq(fundingListings.id, id)))
    .limit(1);
  return row;
}

export async function findFundingById(db: DbClient, tenantId: string, id: string): Promise<FundingRow | undefined> {
  const [row] = await db
    .select()
    .from(fundingListings)
    .where(and(eq(fundingListings.tenantId, tenantId), eq(fundingListings.id, id)))
    .limit(1);
  return row;
}

export async function insertFunding(db: DbClient, values: FundingInsert): Promise<FundingRow> {
  const [row] = await db.insert(fundingListings).values(values).returning();
  return row!;
}

export async function updateFunding(db: DbClient, tenantId: string, id: string, values: Partial<FundingInsert>): Promise<FundingRow | undefined> {
  const [row] = await db
    .update(fundingListings)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(fundingListings.tenantId, tenantId), eq(fundingListings.id, id)))
    .returning();
  return row;
}

export async function deleteFunding(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(fundingListings).where(and(eq(fundingListings.tenantId, tenantId), eq(fundingListings.id, id)));
}

export async function setFundingModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(fundingListings)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(fundingListings.tenantId, tenantId), eq(fundingListings.id, id)));
}

export async function countFunding(db: DbClient, tenantId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(fundingListings)
    .where(tenantId ? eq(fundingListings.tenantId, tenantId) : undefined);
  return row?.count ?? 0;
}
