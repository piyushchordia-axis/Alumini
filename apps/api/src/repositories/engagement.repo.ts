import type { CelebrationKind } from "@illuminize/shared";
import { and, asc, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { celebrationWishes, memberships, tenantJobRuns, tenants } from "../db/schema";

/**
 * Claims a run of `job` for one institution and period: inserts it, or takes over one that never finished. Returns
 * false when the period is already done (nothing to do).
 */
export async function claimTenantRun(db: DbClient, job: string, tenantId: string, periodKey: string): Promise<boolean> {
  const rows = await db
    .insert(tenantJobRuns)
    .values({ job, tenantId, periodKey })
    .onConflictDoUpdate({
      target: [tenantJobRuns.job, tenantJobRuns.tenantId, tenantJobRuns.periodKey],
      set: { attempts: sql`${tenantJobRuns.attempts} + 1`, startedAt: new Date(), status: "RUNNING" },
      setWhere: sql`${tenantJobRuns.status} <> 'DONE'`,
    })
    .returning({ job: tenantJobRuns.job });
  return rows.length > 0;
}

export async function finishTenantRun(db: DbClient, job: string, tenantId: string, periodKey: string): Promise<void> {
  await db
    .update(tenantJobRuns)
    .set({ status: "DONE", finishedAt: new Date() })
    .where(and(eq(tenantJobRuns.job, job), eq(tenantJobRuns.tenantId, tenantId), eq(tenantJobRuns.periodKey, periodKey)));
}

/** Forget a run so it can happen again (platform staff re-running a day for a demo). */
export async function resetTenantRun(db: DbClient, job: string, tenantId: string, periodKey: string): Promise<void> {
  await db.delete(tenantJobRuns).where(and(eq(tenantJobRuns.job, job), eq(tenantJobRuns.tenantId, tenantId), eq(tenantJobRuns.periodKey, periodKey)));
}

/** Finished runs among these institutions and periods, as "tenantId|periodKey". */
export async function finishedTenantRuns(db: DbClient, job: string, tenantIds: string[], periodKeys: string[]): Promise<Set<string>> {
  if (tenantIds.length === 0 || periodKeys.length === 0) return new Set();
  const rows = await db
    .select({ tenantId: tenantJobRuns.tenantId, periodKey: tenantJobRuns.periodKey })
    .from(tenantJobRuns)
    .where(and(eq(tenantJobRuns.job, job), eq(tenantJobRuns.status, "DONE"), inArray(tenantJobRuns.tenantId, tenantIds), inArray(tenantJobRuns.periodKey, periodKeys)));
  return new Set(rows.map((r) => `${r.tenantId}|${r.periodKey}`));
}

/** Active institutions in id order (keyset paging over all of them, not just the first page). */
export async function activeTenantsPage(db: DbClient, afterId: string | null, limit: number): Promise<Array<{ id: string; timezone: string }>> {
  const conds = [eq(tenants.status, "ACTIVE")];
  if (afterId) conds.push(gt(tenants.id, afterId));
  return db
    .select({ id: tenants.id, timezone: tenants.timezone })
    .from(tenants)
    .where(and(...conds))
    .orderBy(asc(tenants.id))
    .limit(limit);
}

export interface CelebrantRow {
  membershipId: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  batchYear: number;
  kind: CelebrationKind;
  /** Anniversaries: whole years since approval. */
  years: number | null;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Who celebrates on `day` (the institution's local date): birthdays from date of birth (29 February birthdays are
 * celebrated on 28 February in other years) and membership anniversaries from the approval date in the institution's
 * time zone (one year or more). Approved members who haven't opted out only.
 */
export async function celebrantsOn(db: DbClient, tenantId: string, day: string, timeZone: string): Promise<CelebrantRow[]> {
  const [y, mo, d] = day.split("-").map(Number) as [number, number, number];
  const keys = [mo * 100 + d, ...(!isLeap(y) && mo === 2 && d === 28 ? [229] : [])];
  const base = and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"));
  const pick = { membershipId: memberships.id, userId: memberships.userId, fullName: memberships.fullName, avatarUrl: memberships.avatarUrl, batchYear: memberships.batchYear };
  const local = sql`(${memberships.approvedAt} at time zone ${timeZone})`;
  const [birthdays, anniversaries] = await Promise.all([
    db
      .select(pick)
      .from(memberships)
      .where(
        and(
          base,
          eq(memberships.celebrateBirthday, true),
          sql`${memberships.dateOfBirth} is not null`,
          inArray(sql<number>`(extract(month from ${memberships.dateOfBirth}) * 100 + extract(day from ${memberships.dateOfBirth}))::int`, keys),
        ),
      )
      .orderBy(asc(memberships.fullName)),
    db
      .select({ ...pick, joinedYear: sql<number>`extract(year from ${local})::int` })
      .from(memberships)
      .where(
        and(
          base,
          eq(memberships.celebrateAnniversary, true),
          sql`${memberships.approvedAt} is not null`,
          inArray(sql<number>`(extract(month from ${local}) * 100 + extract(day from ${local}))::int`, keys),
          sql`extract(year from ${local}) < ${y}`,
        ),
      )
      .orderBy(asc(memberships.fullName)),
  ]);
  return [
    ...birthdays.map((b) => ({ ...b, kind: "BIRTHDAY" as const, years: null })),
    ...anniversaries.map(({ joinedYear, ...a }) => ({ ...a, kind: "ANNIVERSARY" as const, years: y - joinedYear })),
  ];
}

/** Records a wish; false when this sender already wished this person for this day and kind. */
export async function insertWish(db: DbClient, values: typeof celebrationWishes.$inferInsert): Promise<boolean> {
  const rows = await db.insert(celebrationWishes).values(values).onConflictDoNothing().returning({ id: celebrationWishes.id });
  return rows.length > 0;
}

export async function wishesFor(db: DbClient, recipientIds: string[], day: string): Promise<Array<{ recipientId: string; kind: string; senderId: string }>> {
  if (recipientIds.length === 0) return [];
  return db
    .select({ recipientId: celebrationWishes.recipientMembershipId, kind: celebrationWishes.kind, senderId: celebrationWishes.senderMembershipId })
    .from(celebrationWishes)
    .where(and(inArray(celebrationWishes.recipientMembershipId, recipientIds), eq(celebrationWishes.day, day)));
}

/** Wishes a person got today of one kind, and the first name of someone other than `exceptSender` who sent one. */
export async function countWishes(db: DbClient, recipientId: string, day: string, kind: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(celebrationWishes)
    .where(and(eq(celebrationWishes.recipientMembershipId, recipientId), eq(celebrationWishes.day, day), eq(celebrationWishes.kind, kind), ne(celebrationWishes.recipientMembershipId, celebrationWishes.senderMembershipId)));
  return row?.n ?? 0;
}
