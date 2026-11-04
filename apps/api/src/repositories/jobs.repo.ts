import { and, desc, eq, gt, gte, ilike, isNull, lte, ne, not, or, sql, type SQL } from "drizzle-orm";
import type { JobListQuery } from "@illuminize/shared";
import type { DbClient, Tx } from "../db/client";
import { jobSeekers, jobs, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow, TenantRow } from "../types/request";
import { escapeLike, type ModerationPatch } from "./content.common";
import { notCurrentPupil } from "./memberships.repo";

export type JobRow = typeof jobs.$inferSelect;
export type JobInsert = typeof jobs.$inferInsert;
export type JobSeekerRow = typeof jobSeekers.$inferSelect;
export type JobWithAuthor = { job: JobRow; author: MembershipRow };

export async function listJobs(
  db: DbClient,
  tenant: Pick<TenantRow, "id" | "type" | "timezone">,
  q: JobListQuery,
  viewerMembershipId: string,
  /** Whether this viewer is shown which jobs take referral requests, which decides what the `canRefer` filter matches. */
  referralsShown: boolean,
): Promise<CursorPage<JobWithAuthor>> {
  const tenantId = tenant.id;
  const conds: SQL[] = [eq(jobs.tenantId, tenantId)];
  if (q.mine) {
    conds.push(eq(jobs.authorMembershipId, viewerMembershipId));
  } else {
    conds.push(eq(jobs.moderationStatus, "APPROVED"), ne(memberships.status, "SUSPENDED"));
    if (!q.includeClosed) {
      conds.push(eq(jobs.isClosed, false));
      conds.push(or(isNull(jobs.expiresAt), gt(jobs.expiresAt, new Date()))!);
    }
  }
  if (q.q) {
    const p = `%${escapeLike(q.q)}%`;
    // Any one skill containing the text, so "node" finds "Node.js", and a query never spans two skills.
    conds.push(or(ilike(jobs.title, p), ilike(jobs.companyName, p), sql`EXISTS (SELECT 1 FROM unnest(${jobs.skills}) AS s(skill) WHERE s.skill ILIKE ${p})`)!);
  }
  if (q.jobType) conds.push(eq(jobs.jobType, q.jobType));
  if (q.workMode) conds.push(eq(jobs.workMode, q.workMode));
  if (q.seniority) conds.push(eq(jobs.seniority, q.seniority));
  if (q.experience !== undefined) {
    // Fits that many years: neither end of the job's range rules it out, and an open end rules nothing out.
    conds.push(or(isNull(jobs.experienceMin), lte(jobs.experienceMin, q.experience))!, or(isNull(jobs.experienceMax), gte(jobs.experienceMax, q.experience))!);
  }
  if (q.location) conds.push(ilike(jobs.location, `%${escapeLike(q.location)}%`));
  if (q.canRefer !== undefined) {
    // What the cards say, which is the stored flag only while it's shown, and never for a poster who is a current pupil.
    const offers = referralsShown ? and(eq(jobs.canRefer, true), notCurrentPupil(tenant, new Date()))! : sql`false`;
    conds.push(q.canRefer ? offers : not(offers));
  }
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

/**
 * The job, held until the transaction ends. A referral request takes it, and so does everything that stops the job taking
 * requests (closing, deleting, unticking "I can refer"; moderation's own update takes the same lock), so whichever goes second
 * sees what the first did. No key, so a request's foreign key to it can still be checked.
 */
export async function lockJob(tx: Tx, tenantId: string, id: string): Promise<JobRow | undefined> {
  const [row] = await tx
    .select()
    .from(jobs)
    .where(and(eq(jobs.tenantId, tenantId), eq(jobs.id, id)))
    .for("no key update");
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
