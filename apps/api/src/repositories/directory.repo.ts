import { and, asc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { DirectoryQuery } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { memberships, users } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import type { UserRow } from "./users.repo";

const escapeLike = (s: string) => s.replace(/[%_]/g, "\\$&");

export async function searchDirectory(db: DbClient, tenantId: string, q: DirectoryQuery): Promise<CursorPage<MembershipRow>> {
  const conds: SQL[] = [eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED")];
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(memberships.fullName, p), ilike(memberships.companyName, p), ilike(memberships.designation, p))!);
  }
  if (q.batchYear) conds.push(eq(memberships.batchYear, q.batchYear));
  if (q.city) conds.push(ilike(memberships.city, escapeLike(q.city)));
  if (q.country) conds.push(eq(memberships.country, q.country));
  if (q.professionType) conds.push(eq(memberships.professionType, q.professionType));
  if (q.company) conds.push(ilike(memberships.companyName, `%${escapeLike(q.company)}%`));
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(memberships.fullName, memberships.id, cursor, "asc", (v) => v);
  if (keyset) conds.push(keyset);
  const rows = await db
    .select()
    .from(memberships)
    .where(and(...conds))
    .orderBy(asc(memberships.fullName), asc(memberships.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.fullName, id: r.id }), (r) => r);
}

export async function directoryFacets(
  db: DbClient,
  tenantId: string,
): Promise<{ batchYears: number[]; cities: string[]; countries: string[]; companies: string[] }> {
  const base = and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"));
  const [years, cities, countries, companies] = await Promise.all([
    db.selectDistinct({ v: memberships.batchYear }).from(memberships).where(base).orderBy(sql`${memberships.batchYear} desc`),
    db
      .select({ v: memberships.city, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(base, sql`${memberships.city} IS NOT NULL AND ${memberships.city} <> ''`))
      .groupBy(memberships.city)
      .orderBy(sql`count(*) desc`, asc(memberships.city))
      .limit(100),
    db.selectDistinct({ v: memberships.country }).from(memberships).where(and(base, sql`${memberships.country} IS NOT NULL`)).orderBy(asc(memberships.country)),
    db
      .select({ v: memberships.companyName, n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(base, sql`${memberships.companyName} IS NOT NULL AND ${memberships.companyName} <> ''`))
      .groupBy(memberships.companyName)
      .orderBy(sql`count(*) desc`, asc(memberships.companyName))
      .limit(100),
  ]);
  return {
    batchYears: years.map((r) => r.v),
    cities: cities.map((r) => r.v!).filter(Boolean),
    countries: countries.map((r) => r.v!).filter(Boolean),
    companies: companies.map((r) => r.v!).filter(Boolean),
  };
}

export async function findApprovedMemberWithUser(
  db: DbClient,
  tenantId: string,
  membershipId: string,
): Promise<{ membership: MembershipRow; user: UserRow } | undefined> {
  const [row] = await db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, membershipId), eq(memberships.status, "APPROVED")))
    .limit(1);
  return row;
}
