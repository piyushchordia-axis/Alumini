import type { PollCreateInput, PollDto } from "@illuminize/shared";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { pollOptions, pollVotes, postPolls } from "../db/schema";

export async function insertPoll(db: DbClient, tenantId: string, postId: string, input: PollCreateInput): Promise<void> {
  await db.insert(postPolls).values({ postId, tenantId, allowsMultiple: input.allowsMultiple, closesAt: input.closesAt ? new Date(input.closesAt) : null });
  await db.insert(pollOptions).values(input.options.map((label, position) => ({ postId, tenantId, label, position })));
}

/** Polls for a page of posts as one viewer sees them (counts and the viewer's own choices), keyed by post id. */
export async function loadPolls(db: DbClient, postIds: string[], viewerMembershipId: string, now = new Date()): Promise<Map<string, PollDto>> {
  if (postIds.length === 0) return new Map();
  const polls = await db.select().from(postPolls).where(inArray(postPolls.postId, postIds));
  if (polls.length === 0) return new Map();
  const ids = polls.map((p) => p.postId);
  const [options, voters, mine] = await Promise.all([
    db
      .select({ id: pollOptions.id, postId: pollOptions.postId, label: pollOptions.label, votes: sql<number>`(select count(*)::int from ${pollVotes} v where v.option_id = ${pollOptions.id})` })
      .from(pollOptions)
      .where(inArray(pollOptions.postId, ids))
      .orderBy(asc(pollOptions.postId), asc(pollOptions.position)),
    db
      .select({ postId: pollVotes.postId, n: sql<number>`count(distinct ${pollVotes.membershipId})::int` })
      .from(pollVotes)
      .where(inArray(pollVotes.postId, ids))
      .groupBy(pollVotes.postId),
    db
      .select({ postId: pollVotes.postId, optionId: pollVotes.optionId })
      .from(pollVotes)
      .where(and(inArray(pollVotes.postId, ids), eq(pollVotes.membershipId, viewerMembershipId))),
  ]);
  const out = new Map<string, PollDto>();
  for (const p of polls) {
    out.set(p.postId, {
      options: options.filter((o) => o.postId === p.postId).map((o) => ({ id: o.id, label: o.label, votes: o.votes })),
      totalVoters: voters.find((v) => v.postId === p.postId)?.n ?? 0,
      allowsMultiple: p.allowsMultiple,
      closesAt: p.closesAt ? p.closesAt.toISOString() : null,
      isClosed: !!p.closesAt && p.closesAt <= now,
      myVotes: mine.filter((m) => m.postId === p.postId).map((m) => m.optionId),
    });
  }
  return out;
}

/** Locks a poll for the rest of the transaction (serialises votes on it); returns it with its option ids. */
export async function lockPoll(db: DbClient, postId: string): Promise<{ poll: typeof postPolls.$inferSelect; optionIds: string[] } | undefined> {
  const [poll] = await db.select().from(postPolls).where(eq(postPolls.postId, postId)).for("update");
  if (!poll) return undefined;
  const options = await db.select({ id: pollOptions.id }).from(pollOptions).where(eq(pollOptions.postId, postId));
  return { poll, optionIds: options.map((o) => o.id) };
}

export async function replaceVotes(db: DbClient, tenantId: string, postId: string, membershipId: string, optionIds: string[]): Promise<void> {
  await db.delete(pollVotes).where(and(eq(pollVotes.postId, postId), eq(pollVotes.membershipId, membershipId)));
  if (optionIds.length) await db.insert(pollVotes).values(optionIds.map((optionId) => ({ optionId, postId, membershipId, tenantId })));
}
