import { and, desc, eq, gt, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { JobListQuery } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { jobSeekers, jobs, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import { escapeLike, type ModerationPatch } from "./content.common";

export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;
export type JobSeekerRow = typeof jobSeekers.$inferSelect;
export type JobWithAuthor = { job: JobRow; author: MembershipRow };

export async function listJobs(
  db: DbClient,
  tenantId: string,
  q: JobListQuery,
  viewerMembershipId: string,
): Promise<CursorPage<JobWithAuthor>> {
  const conds: SQL[] = [eq(jobs.tenantId, tenantId)];
  if (q.mine) {
    conds.push(eq(jobs.authorMembershipId, viewerMembershipId));
  } else {
    conds.push(eq(jobs.moderationStatus, "APPROVED"));
    if (!q.includeClosed) {
      conds.push(eq(jobs.isClosed, false));
      conds.push(or(isNull(jobs.expiresAt), gt(jobs.expiresAt, new Date()))!);
    }
  }
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    conds.push(or(ilike(jobs.title, p), ilike(jobs.companyName, p))!);
  }
  if (q.jobType) conds.push(eq(jobs.jobType, q.jobType));
  if (q.remote !== undefined) conds.push(eq(jobs.isRemote, q.remote));
  if (q.location) conds.push(ilike(jobs.location, `%${escapeLike(q.location)}%`));
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(jobs.createdAt, jobs.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ job: jobs, author: memberships })
    .from(jobs)
    .innerJoin(memberships, eq(memberships.id, jobs.authorMembershipId))
    .where(and(...conds))
    .orderBy(desc(jobs.createdAt), desc(jobs.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.job.createdAt.toISOString(), id: r.job.id }), (r) => r);
}

export async function findJobWithAuthor(db: DbClient, tenantId: string, id: string): Promise<JobWithAuthor | undefined> {
  const [row] = await db
    .select({ job: jobs, author: memberships })
    .from(jobs)
    .innerJoin(memberships, eq(memberships.id, jobs.authorMembershipId))
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)))
    .limit(1);
  return row;
}

export async function findJobById(db: DbClient, tenantId: string, id: string): Promise<JobRow | undefined> {
  const [row] = await db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id))).limit(1);
  return row;
}

export async function insertJob(db: DbClient, values: JobInsert): Promise<JobRow> {
  const [row] = await db.insert(jobs).values(values).returning();
  return row!;
}

export async function updateJob(db: DbClient, tenantId: string, id: string, values: Partial<JobInsert>): Promise<JobRow | undefined> {
  const [row] = await db
    .update(jobs)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)))
    .returning();
  return row;
}

export async function deleteJob(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)));
}

export async function setJobModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(jobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)));
}

// ---- job seekers ----

export async function listSeekers(
  db: DbClient,
  tenantId: string,
  q: { cursor?: string; limit: number },
): Promise<CursorPage<{ seeker: JobSeekerRow; member: MembershipRow }>> {
  const conds: SQL[] = [eq(jobSeekers.tenantId, tenantId), eq(jobSeekers.isActive, true), eq(memberships.status, "APPROVED")];
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(jobSeekers.updatedAt, jobSeekers.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ seeker: jobSeekers, member: memberships })
    .from(jobSeekers)
    .innerJoin(memberships, eq(memberships.id, jobSeekers.membershipId))
    .where(and(...conds))
    .orderBy(desc(jobSeekers.updatedAt), desc(jobSeekers.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.seeker.updatedAt.toISOString(), id: r.seeker.id }), (r) => r);
}

export async function findSeeker(db: DbClient, tenantId: string, membershipId: string): Promise<JobSeekerRow | undefined> {
  const [row] = await db
    .select()
    .from(jobSeekers)
    .where(and(eq(jobSeekers.tenantId, tenantId), eq(jobSeekers.membershipId, membershipId)))
    .limit(1);
  return row;
}

export async function upsertSeeker(
  db: DbClient,
  values: { tenantId: string; membershipId: string; note: string; preferredRoles: string | null; preferredLocations: string | null; isActive: boolean },
): Promise<JobSeekerRow> {
  const [row] = await db
    .insert(jobSeekers)
    .values(values)
    .onConflictDoUpdate({
      target: [jobSeekers.tenantId, jobSeekers.membershipId],
      set: { note: values.note, preferredRoles: values.preferredRoles, preferredLocations: values.preferredLocations, isActive: values.isActive, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

export async function deleteSeeker(db: DbClient, tenantId: string, membershipId: string): Promise<void> {
  await db.delete(jobSeekers).where(and(eq(jobSeekers.tenantId, tenantId), eq(jobSeekers.membershipId, membershipId)));
}

export async function countJobs(db: DbClient, tenantId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(jobs)
    .where(tenantId ? eq(jobs.tenantId, tenantId) : undefined);
  return row?.count ?? 0;
}
