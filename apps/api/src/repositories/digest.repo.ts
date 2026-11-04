import type { NotificationPrefs } from "@illuminize/shared";
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { events, jobs, memberships, notificationPrefs, posts, tenantDigests, users } from "../db/schema";

export type DigestRow = typeof tenantDigests.$inferSelect;
export type DigestContent = DigestRow["content"];
const LIMIT = 5;

/** The week's most discussed posts (comments weigh double), new open jobs, and events in the next two weeks. */
export async function digestCandidates(db: DbClient, tenantId: string, since: Date, now: Date): Promise<Omit<DigestContent, "newMembers"> & { newMembers: number }> {
  const visibleAuthor = ne(memberships.status, "SUSPENDED");
  const [topPosts, newJobs, upcoming, [joined]] = await Promise.all([
    db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(memberships, eq(memberships.id, posts.authorMembershipId))
      .where(and(eq(posts.tenantId, tenantId), eq(posts.moderationStatus, "APPROVED"), gte(posts.createdAt, since), visibleAuthor))
      .orderBy(desc(sql`${posts.reactionCount} + 2 * ${posts.commentCount}`), desc(posts.createdAt))
      .limit(LIMIT),
    db
      .select({ id: jobs.id })
      .from(jobs)
      .innerJoin(memberships, eq(memberships.id, jobs.authorMembershipId))
      .where(and(eq(jobs.tenantId, tenantId), eq(jobs.moderationStatus, "APPROVED"), gte(jobs.createdAt, since), eq(jobs.isClosed, false), or(isNull(jobs.expiresAt), gt(jobs.expiresAt, now)), visibleAuthor))
      .orderBy(desc(jobs.createdAt))
      .limit(LIMIT),
    db
      .select({ id: events.id })
      .from(events)
      .innerJoin(memberships, eq(memberships.id, events.authorMembershipId))
      .where(and(eq(events.tenantId, tenantId), eq(events.moderationStatus, "APPROVED"), eq(events.isCancelled, false), gte(events.startAt, now), lte(events.startAt, new Date(now.getTime() + 14 * 86_400_000)), visibleAuthor))
      .orderBy(asc(events.startAt))
      .limit(LIMIT),
    db
      .select({ n: count() })
      .from(memberships)
      .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), gte(memberships.approvedAt, since))),
  ]);
  return { postIds: topPosts.map((p) => p.id), jobIds: newJobs.map((j) => j.id), eventIds: upcoming.map((e) => e.id), newMembers: joined?.n ?? 0 };
}

/** Stores the week's digest; returns the stored one (an earlier run's, if it already exists). */
export async function saveDigest(db: DbClient, tenantId: string, weekStart: string, content: DigestContent): Promise<DigestRow> {
  await db.insert(tenantDigests).values({ tenantId, weekStart, content }).onConflictDoNothing();
  const [row] = await db.select().from(tenantDigests).where(and(eq(tenantDigests.tenantId, tenantId), eq(tenantDigests.weekStart, weekStart)));
  return row!;
}

export async function findDigest(db: DbClient, tenantId: string, weekStart: string): Promise<DigestRow | undefined> {
  const [row] = await db.select().from(tenantDigests).where(and(eq(tenantDigests.tenantId, tenantId), eq(tenantDigests.weekStart, weekStart)));
  return row;
}

export async function latestDigest(db: DbClient, tenantId: string): Promise<DigestRow | undefined> {
  const [row] = await db.select().from(tenantDigests).where(eq(tenantDigests.tenantId, tenantId)).orderBy(desc(tenantDigests.weekStart)).limit(1);
  return row;
}

/** Details for a digest's ids, keeping only what is still published (and in the stored order). */
export async function digestDetails(db: DbClient, tenantId: string, content: DigestContent) {
  const visible = ne(memberships.status, "SUSPENDED");
  const [p, j, e] = await Promise.all([
    content.postIds.length
      ? db
          .select({ id: posts.id, body: posts.body, authorName: memberships.fullName, reactionCount: posts.reactionCount, commentCount: posts.commentCount })
          .from(posts)
          .innerJoin(memberships, eq(memberships.id, posts.authorMembershipId))
          .where(and(eq(posts.tenantId, tenantId), inArray(posts.id, content.postIds), eq(posts.moderationStatus, "APPROVED"), visible))
      : [],
    content.jobIds.length
      ? db
          .select({ id: jobs.id, title: jobs.title, companyName: jobs.companyName, location: jobs.location, workMode: jobs.workMode })
          .from(jobs)
          .innerJoin(memberships, eq(memberships.id, jobs.authorMembershipId))
          .where(and(eq(jobs.tenantId, tenantId), inArray(jobs.id, content.jobIds), eq(jobs.moderationStatus, "APPROVED"), visible))
      : [],
    content.eventIds.length
      ? db
          .select({ id: events.id, title: events.title, startAt: events.startAt, timezone: events.timezone, city: events.city })
          .from(events)
          .innerJoin(memberships, eq(memberships.id, events.authorMembershipId))
          .where(and(eq(events.tenantId, tenantId), inArray(events.id, content.eventIds), eq(events.moderationStatus, "APPROVED"), eq(events.isCancelled, false), visible))
      : [],
  ]);
  const inOrder = <T extends { id: string }>(rows: T[], ids: string[]) => ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is T => !!r);
  return { posts: inOrder(p, content.postIds), jobs: inOrder(j, content.jobIds), events: inOrder(e, content.eventIds) };
}

/** A page of approved members with a confirmed email, in id order, with their notification choices. */
export async function digestRecipientsPage(db: DbClient, tenantId: string, afterId: string | null, limit: number): Promise<Array<{ id: string; userId: string; fullName: string; email: string; prefs: NotificationPrefs | null }>> {
  const conds = [eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), isNotNull(users.email)];
  if (afterId) conds.push(gt(memberships.id, afterId));
  const rows = await db
    .select({ id: memberships.id, userId: memberships.userId, fullName: memberships.fullName, email: users.email, prefs: notificationPrefs.prefs })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(notificationPrefs, eq(notificationPrefs.membershipId, memberships.id))
    .where(and(...conds))
    .orderBy(asc(memberships.id))
    .limit(limit);
  return rows.map((r) => ({ ...r, email: r.email! }));
}
