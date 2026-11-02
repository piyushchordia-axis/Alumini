import { and, desc, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { BusinessListQuery } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { businessListings, contentReports, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import { escapeLike, type ModerationPatch } from "./content.common";

export type BusinessRow = typeof businessListings.$inferSelect;
export type BusinessInsert = typeof businessListings.$inferInsert;
export type BusinessWithAuthor = { listing: BusinessRow; author: MembershipRow };

export async function listBusinesses(db: DbClient, tenantId: string, q: BusinessListQuery, viewerMembershipId: string): Promise<CursorPage<BusinessWithAuthor>> {
  const conds: SQL[] = [eq(businessListings.tenantId, tenantId)];
  if (q.mine) conds.push(eq(businessListings.authorMembershipId, viewerMembershipId));
  else conds.push(eq(businessListings.moderationStatus, "APPROVED"), ne(memberships.status, "SUSPENDED"));
  if (q.author) conds.push(eq(businessListings.authorMembershipId, q.author));
  if (q.category) conds.push(eq(businessListings.category, q.category));
  if (q.city) conds.push(ilike(businessListings.city, `%${escapeLike(q.city)}%`));
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(businessListings.name, p), ilike(businessListings.description, p))!);
  }
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(businessListings.createdAt, businessListings.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ listing: businessListings, author: memberships })
    .from(businessListings)
    .innerJoin(memberships, eq(memberships.id, businessListings.authorMembershipId))
    .where(and(...conds))
    .orderBy(desc(businessListings.createdAt), desc(businessListings.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.listing.createdAt.toISOString(), id: r.listing.id }), (r) => r);
}

export async function findBusinessWithAuthor(db: DbClient, tenantId: string, id: string, forUpdate = false): Promise<BusinessWithAuthor | undefined> {
  const query = db
    .select({ listing: businessListings, author: memberships })
    .from(businessListings)
    .innerJoin(memberships, eq(memberships.id, businessListings.authorMembershipId))
    .where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.id, id)))
    .limit(1);
  const [row] = await (forUpdate ? query.for("update", { of: businessListings }) : query);
  return row;
}

export async function findBusinessById(db: DbClient, tenantId: string, id: string): Promise<BusinessRow | undefined> {
  const [row] = await db
    .select()
    .from(businessListings)
    .where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.id, id)))
    .limit(1);
  return row;
}

/** What the listing cap counts: everything of the author's an admin hasn't removed. */
export async function countLiveBusinessesByAuthor(db: DbClient, tenantId: string, authorMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(businessListings)
    .where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.authorMembershipId, authorMembershipId), ne(businessListings.moderationStatus, "REMOVED")));
  return row?.count ?? 0;
}

export async function insertBusiness(db: DbClient, values: BusinessInsert): Promise<BusinessRow> {
  const [row] = await db.insert(businessListings).values(values).returning();
  return row!;
}

export async function updateBusiness(db: DbClient, tenantId: string, id: string, values: Partial<BusinessInsert>): Promise<BusinessRow | undefined> {
  const [row] = await db
    .update(businessListings)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.id, id)))
    .returning();
  return row;
}

export async function deleteBusiness(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(businessListings).where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.id, id)));
}

export async function setBusinessModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(businessListings)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(businessListings.tenantId, tenantId), eq(businessListings.id, id)));
}

/** Deleting an account cascades to its listings, so the open reports on them are closed first. */
export async function resolveOpenReportsOnListingsOfUser(db: DbClient, userId: string, resolutionNote: string): Promise<void> {
  const listings = db
    .select({ id: businessListings.id })
    .from(businessListings)
    .innerJoin(memberships, eq(memberships.id, businessListings.authorMembershipId))
    .where(eq(memberships.userId, userId));
  await db
    .update(contentReports)
    .set({ status: "RESOLVED", resolvedAt: new Date(), resolutionNote })
    .where(and(eq(contentReports.contentType, "BUSINESS"), eq(contentReports.status, "OPEN"), inArray(contentReports.contentId, listings)));
}
