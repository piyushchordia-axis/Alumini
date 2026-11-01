import { and, asc, desc, eq, gte, ne, notInArray, type SQL, sql } from "drizzle-orm";
import type { ReactionType } from "@illuminize/shared";
import type { DbClient } from "../db/client";
import { memberships, postComments, postReactions, posts } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { MembershipRow } from "../types/request";
import type { ModerationPatch } from "./content.common";

export type PostRow = typeof posts.$inferSelect;
export type PostInsert = typeof posts.$inferInsert;
export type CommentRow = typeof postComments.$inferSelect;
export type ReactionRow = typeof postReactions.$inferSelect;
export type PostWithAuthor = { post: PostRow; author: MembershipRow; myReaction: ReactionType | null };

function postSelect(viewerMembershipId: string) {
  return {
    post: posts,
    author: memberships,
    myReaction: sql<ReactionType | null>`(select ${postReactions.type} from ${postReactions} where ${postReactions.postId} = ${posts.id} and ${postReactions.membershipId} = ${viewerMembershipId})`,
  };
}

export async function listPosts(
  db: DbClient,
  tenantId: string,
  q: { cursor?: string; limit: number; mine?: boolean },
  viewerMembershipId: string,
  /** Posts shown in the pinned strip above the feed (left out of the feed so they don't appear twice). */
  excludeIds: string[] = [],
): Promise<CursorPage<PostWithAuthor>> {
  const conds: SQL[] = [eq(posts.tenantId, tenantId)];
  if (q.mine) conds.push(eq(posts.authorMembershipId, viewerMembershipId));
  // Suspended members' posts disappear from the feed until they are reinstated.
  else {
    conds.push(eq(posts.moderationStatus, "APPROVED"), ne(memberships.status, "SUSPENDED"));
    if (excludeIds.length) conds.push(notInArray(posts.id, excludeIds));
  }
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(posts.createdAt, posts.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select(postSelect(viewerMembershipId))
    .from(posts)
    .innerJoin(memberships, eq(memberships.id, posts.authorMembershipId))
    .where(and(...conds))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.post.createdAt.toISOString(), id: r.post.id }), (r) => r);
}

/** The pinned strip above the feed: up to five pinned posts, most recently pinned or edited first. */
export const PINNED_STRIP_SIZE = 5;

export async function listPinnedPosts(db: DbClient, tenantId: string, viewerMembershipId: string): Promise<PostWithAuthor[]> {
  return db
    .select(postSelect(viewerMembershipId))
    .from(posts)
    .innerJoin(memberships, eq(memberships.id, posts.authorMembershipId))
    .where(and(eq(posts.tenantId, tenantId), eq(posts.moderationStatus, "APPROVED"), eq(posts.isPinned, true), ne(memberships.status, "SUSPENDED")))
    .orderBy(desc(posts.updatedAt))
    .limit(PINNED_STRIP_SIZE);
}

export async function findPostWithAuthor(db: DbClient, tenantId: string, id: string, viewerMembershipId: string): Promise<PostWithAuthor | undefined> {
  const [row] = await db
    .select(postSelect(viewerMembershipId))
    .from(posts)
    .innerJoin(memberships, eq(memberships.id, posts.authorMembershipId))
    .where(and(eq(posts.tenantId, tenantId), eq(posts.id, id)))
    .limit(1);
  return row;
}

export async function findPostById(db: DbClient, tenantId: string, id: string): Promise<PostRow | undefined> {
  const [row] = await db.select().from(posts).where(and(eq(posts.tenantId, tenantId), eq(posts.id, id))).limit(1);
  return row;
}

export async function insertPost(db: DbClient, values: PostInsert): Promise<PostRow> {
  const [row] = await db.insert(posts).values(values).returning();
  return row!;
}

export async function updatePost(db: DbClient, tenantId: string, id: string, values: Partial<PostInsert>): Promise<PostRow | undefined> {
  const [row] = await db
    .update(posts)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(posts.tenantId, tenantId), eq(posts.id, id)))
    .returning();
  return row;
}

export async function deletePost(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(posts).where(and(eq(posts.tenantId, tenantId), eq(posts.id, id)));
}

export async function setPostModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(posts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(posts.tenantId, tenantId), eq(posts.id, id)));
}

export async function setPostPinned(db: DbClient, tenantId: string, id: string, isPinned: boolean): Promise<PostRow | undefined> {
  return updatePost(db, tenantId, id, { isPinned });
}

export async function countPostsSince(db: DbClient, tenantId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(and(eq(posts.tenantId, tenantId), eq(posts.moderationStatus, "APPROVED"), gte(posts.createdAt, since)));
  return row?.count ?? 0;
}

export async function countPosts(db: DbClient, tenantId?: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(posts)
    .where(tenantId ? eq(posts.tenantId, tenantId) : undefined);
  return row?.count ?? 0;
}

// ---- comments ----

export async function listComments(
  db: DbClient,
  tenantId: string,
  postId: string,
  q: { cursor?: string; limit: number },
  includeRemoved = false,
): Promise<CursorPage<{ comment: CommentRow; author: MembershipRow }>> {
  const conds: SQL[] = [eq(postComments.tenantId, tenantId), eq(postComments.postId, postId)];
  if (!includeRemoved) conds.push(ne(postComments.moderationStatus, "REMOVED"), ne(memberships.status, "SUSPENDED"));
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(postComments.createdAt, postComments.id, cursor, "asc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ comment: postComments, author: memberships })
    .from(postComments)
    .innerJoin(memberships, eq(memberships.id, postComments.authorMembershipId))
    .where(and(...conds))
    .orderBy(asc(postComments.createdAt), asc(postComments.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.comment.createdAt.toISOString(), id: r.comment.id }), (r) => r);
}

export async function findCommentWithAuthor(
  db: DbClient,
  tenantId: string,
  id: string,
): Promise<{ comment: CommentRow; author: MembershipRow } | undefined> {
  const [row] = await db
    .select({ comment: postComments, author: memberships })
    .from(postComments)
    .innerJoin(memberships, eq(memberships.id, postComments.authorMembershipId))
    .where(and(eq(postComments.tenantId, tenantId), eq(postComments.id, id)))
    .limit(1);
  return row;
}

export async function insertComment(db: DbClient, values: typeof postComments.$inferInsert): Promise<CommentRow> {
  const [row] = await db.insert(postComments).values(values).returning();
  return row!;
}

export async function deleteComment(db: DbClient, tenantId: string, id: string): Promise<void> {
  await db.delete(postComments).where(and(eq(postComments.tenantId, tenantId), eq(postComments.id, id)));
}

export async function setCommentModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch): Promise<void> {
  await db
    .update(postComments)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(postComments.tenantId, tenantId), eq(postComments.id, id)));
}

export async function adjustCommentCount(db: DbClient, postId: string, delta: number): Promise<void> {
  await db
    .update(posts)
    .set({ commentCount: sql`GREATEST(${posts.commentCount} + ${delta}, 0)` })
    .where(eq(posts.id, postId));
}

// ---- reactions ----

/** Upserts a reaction; returns whether it was newly created. */
export async function upsertReaction(
  db: DbClient,
  values: { tenantId: string; postId: string; membershipId: string; type: ReactionType },
): Promise<{ inserted: boolean }> {
  const rows = await db
    .insert(postReactions)
    .values(values)
    .onConflictDoUpdate({ target: [postReactions.postId, postReactions.membershipId], set: { type: values.type } })
    .returning({ createdAt: postReactions.createdAt });
  const createdAt = rows[0]?.createdAt;
  // A freshly inserted row has created_at within the last few seconds; an update keeps the original timestamp.
  return { inserted: !!createdAt && Date.now() - createdAt.getTime() < 5000 };
}

export async function findReaction(db: DbClient, postId: string, membershipId: string): Promise<ReactionRow | undefined> {
  const [row] = await db
    .select()
    .from(postReactions)
    .where(and(eq(postReactions.postId, postId), eq(postReactions.membershipId, membershipId)))
    .limit(1);
  return row;
}

export async function deleteReaction(db: DbClient, postId: string, membershipId: string): Promise<boolean> {
  const rows = await db
    .delete(postReactions)
    .where(and(eq(postReactions.postId, postId), eq(postReactions.membershipId, membershipId)))
    .returning({ postId: postReactions.postId });
  return rows.length > 0;
}

export async function recountReactions(db: DbClient, postId: string): Promise<number> {
  const [row] = await db
    .update(posts)
    .set({ reactionCount: sql`(select count(*) from ${postReactions} where ${postReactions.postId} = ${posts.id})` })
    .where(eq(posts.id, postId))
    .returning({ reactionCount: posts.reactionCount });
  return row?.reactionCount ?? 0;
}

export async function listReactions(
  db: DbClient,
  postId: string,
  q: { cursor?: string; limit: number; type?: ReactionType },
): Promise<CursorPage<{ reaction: ReactionRow; member: MembershipRow }>> {
  const conds: SQL[] = [eq(postReactions.postId, postId)];
  if (q.type) conds.push(eq(postReactions.type, q.type));
  const cursor = decodeCursor(q.cursor);
  const keyset = keysetCondition(postReactions.createdAt, postReactions.membershipId, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ reaction: postReactions, member: memberships })
    .from(postReactions)
    .innerJoin(memberships, eq(memberships.id, postReactions.membershipId))
    .where(and(...conds))
    .orderBy(desc(postReactions.createdAt), desc(postReactions.membershipId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.reaction.createdAt.toISOString(), id: r.reaction.membershipId }), (r) => r);
}
