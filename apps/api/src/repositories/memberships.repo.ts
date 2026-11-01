import { and, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { jobSeekers, memberActivityDays, memberships, tenants, users } from "../db/schema";
import type { UserRow } from "./users.repo";
import type { MembershipRow, TenantRow } from "../types/request";

export type MembershipInsert = typeof memberships.$inferInsert;

export async function listMembershipsForUser(db: DbClient, userId: string): Promise<Array<{ membership: MembershipRow; tenant: TenantRow }>> {
  return db
    .select({ membership: memberships, tenant: tenants })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(desc(memberships.createdAt));
}

export async function findMembership(db: DbClient, tenantId: string, userId: string): Promise<MembershipRow | undefined> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, userId)))
    .limit(1);
  return row;
}

/** By id alone, for links that carry a membership id but no tenant (unsubscribe). Prefer findMembershipById. */
export async function findMembershipByIdUnscoped(db: DbClient, id: string): Promise<MembershipRow | undefined> {
  const [row] = await db.select().from(memberships).where(eq(memberships.id, id)).limit(1);
  return row;
}

export async function findMembershipById(db: DbClient, tenantId: string, id: string): Promise<MembershipRow | undefined> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .limit(1);
  return row;
}

export async function findMembershipWithUser(
  db: DbClient,
  tenantId: string,
  id: string,
): Promise<{ membership: MembershipRow; user: UserRow } | undefined> {
  const [row] = await db
    .select({ membership: memberships, user: users })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .limit(1);
  return row;
}

export async function findMembershipsByIds(db: DbClient, tenantId: string, ids: string[]): Promise<MembershipRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.id, ids)));
}

export async function insertMembership(db: DbClient, values: MembershipInsert): Promise<MembershipRow> {
  const [row] = await db.insert(memberships).values(values).returning();
  return row!;
}

export async function updateMembership(db: DbClient, tenantId: string, id: string, values: Partial<MembershipInsert>): Promise<MembershipRow | undefined> {
  const [row] = await db
    .update(memberships)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.id, id)))
    .returning();
  return row;
}

export async function listTenantAdmins(db: DbClient, tenantId: string): Promise<MembershipRow[]> {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.role, "TENANT_ADMIN"), eq(memberships.status, "APPROVED")));
}

export async function approveAllPending(
  db: DbClient,
  tenantId: string,
  actorUserId: string,
): Promise<MembershipRow[]> {
  return db
    .update(memberships)
    .set({ status: "APPROVED", statusReason: null, statusChangedAt: new Date(), statusChangedByUserId: actorUserId, updatedAt: new Date() })
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "PENDING")))
    .returning();
}

export interface AdminMemberFilters {
  status?: MembershipRow["status"];
  role?: MembershipRow["role"];
  batchYear?: number;
  q?: string;
  page: number;
  pageSize: number;
}

export async function listMembersForAdmin(
  db: DbClient,
  tenantId: string,
  f: AdminMemberFilters,
): Promise<{ rows: Array<{ membership: MembershipRow; user: UserRow }>; total: number }> {
  const conditions: SQL[] = [eq(memberships.tenantId, tenantId)];
  if (f.status) conditions.push(eq(memberships.status, f.status));
  if (f.role) conditions.push(eq(memberships.role, f.role));
  if (f.batchYear) conditions.push(eq(memberships.batchYear, f.batchYear));
  if (f.q) {
    const pattern = `%${f.q.replace(/[%_]/g, "\\$&")}%`;
    conditions.push(or(ilike(memberships.fullName, pattern), ilike(memberships.companyName, pattern), ilike(users.phoneE164, pattern))!);
  }
  const where = and(...conditions);
  const [rows, [count]] = await Promise.all([
    db
      .select({ membership: memberships, user: users })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(where)
      .orderBy(desc(memberships.createdAt))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export async function countMembersByStatus(db: DbClient, tenantId: string): Promise<Record<MembershipRow["status"], number>> {
  const rows = await db
    .select({ status: memberships.status, count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId))
    .groupBy(memberships.status);
  const out: Record<MembershipRow["status"], number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function countNewMembersSince(db: DbClient, tenantId: string, since: Date, status?: MembershipRow["status"]): Promise<number> {
  const conds = [eq(memberships.tenantId, tenantId), gte(memberships.createdAt, since)];
  if (status) conds.push(eq(memberships.status, status));
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(memberships).where(and(...conds));
  return row?.count ?? 0;
}

export async function countActiveMembersSince(db: DbClient, tenantId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), gte(memberships.lastActiveAt, since)));
  return row?.count ?? 0;
}

/** Membership ids of members that have an active "looking for work" flag (for MemberCard.isOpenToWork). */
export async function openToWorkSet(db: DbClient, tenantId: string, membershipIds: string[]): Promise<Set<string>> {
  if (membershipIds.length === 0) return new Set();
  const rows = await db
    .select({ membershipId: jobSeekers.membershipId })
    .from(jobSeekers)
    .where(and(eq(jobSeekers.tenantId, tenantId), eq(jobSeekers.isActive, true), inArray(jobSeekers.membershipId, membershipIds)));
  return new Set(rows.map((r) => r.membershipId));
}

export async function countAllMembershipsByStatus(db: DbClient): Promise<Record<MembershipRow["status"], number>> {
  const rows = await db.select({ status: memberships.status, count: sql<number>`count(*)::int` }).from(memberships).groupBy(memberships.status);
  const out: Record<MembershipRow["status"], number> = { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  for (const r of rows) out[r.status] = r.count;
  return out;
}

export async function countActiveMembersGlobal(db: DbClient, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.status, "APPROVED"), gte(memberships.lastActiveAt, since)));
  return row?.count ?? 0;
}

/** Counts used for billing a period: approved now, active within the period, newly created within the period. */
/**
 * Billing counts for a period. `fromDay`/`toDay` are calendar days in the billing time zone (inclusive); `from` and
 * `toExclusive` are the matching instants.
 * - active: distinct members with at least one activity day in the period
 * - approved: members approved by the end of the period and not suspended or rejected by then
 * - created: members first approved during the period
 */
export async function billingCountsForPeriod(
  db: DbClient,
  tenantId: string,
  period: { fromDay: string; toDay: string; from: Date; toExclusive: Date },
): Promise<{ approved: number; active: number; created: number }> {
  const { from, toExclusive } = period;
  const [counts] = await db
    .select({
      approved: sql<number>`count(*) filter (where ${memberships.approvedAt} < ${toExclusive} and not (${memberships.status} in ('SUSPENDED', 'REJECTED') and ${memberships.statusChangedAt} < ${toExclusive}))::int`,
      created: sql<number>`count(*) filter (where ${memberships.approvedAt} >= ${from} and ${memberships.approvedAt} < ${toExclusive})::int`,
    })
    .from(memberships)
    .where(eq(memberships.tenantId, tenantId));
  const [active] = await db
    .select({ active: sql<number>`count(distinct ${memberActivityDays.membershipId})::int` })
    .from(memberActivityDays)
    .where(and(eq(memberActivityDays.tenantId, tenantId), gte(memberActivityDays.day, period.fromDay), lte(memberActivityDays.day, period.toDay)));
  return { approved: counts?.approved ?? 0, created: counts?.created ?? 0, active: active?.active ?? 0 };
}

/** Membership status in one institution for each phone that has an account there. */
export async function membershipStatusByPhones(db: DbClient, tenantId: string, phones: string[]): Promise<Map<string, MembershipRow["status"]>> {
  if (phones.length === 0) return new Map();
  const rows = await db
    .select({ phone: users.phoneE164, status: memberships.status })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.tenantId, tenantId), inArray(users.phoneE164, phones)));
  return new Map(rows.map((r) => [r.phone, r.status]));
}
