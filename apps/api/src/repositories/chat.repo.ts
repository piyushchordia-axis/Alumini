import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { ChatGroupVisibility, ChatInbox, TenantFeatures } from "@illuminize/shared";
import { CHAT_REPORT_CONTEXT_EACH_SIDE } from "@illuminize/shared";
import type { DbClient, Tx } from "../db/client";
import { chatBlocks, chatConversations, chatGroups, chatMessages, chatParticipants, memberships, tenantSettings, tenants } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, parseCursorSeq, type CursorPage } from "../lib/pagination";
import type { MembershipRow, TenantRow } from "../types/request";

export type ConversationRow = typeof chatConversations.$inferSelect;
export type ConversationInsert = typeof chatConversations.$inferInsert;
export type ParticipantRow = typeof chatParticipants.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type ChatMessageInsert = typeof chatMessages.$inferInsert;
export type ChatBlockRow = typeof chatBlocks.$inferSelect;
export type ChatGroupRow = typeof chatGroups.$inferSelect;
export type ChatSender = Pick<MembershipRow, "id" | "fullName" | "avatarUrl">;

/** What an institution's switches turn on: direct threads, and each kind of group, which need different switches. */
export type ChatThreadKind = "DIRECT" | "OPEN_GROUP" | "INVITE_ONLY_GROUP";

export const GROUP_KIND_OF: Record<ChatGroupVisibility, ChatThreadKind> = { OPEN: "OPEN_GROUP", INVITE_ONLY: "INVITE_ONLY_GROUP" };

export const senderColumns = { id: memberships.id, fullName: memberships.fullName, avatarUrl: memberships.avatarUrl };

/** A group members may see: an admin approved it and hasn't since rejected or removed it. An edit waiting for review leaves it so. */
export const groupLive = (): SQL => and(isNotNull(chatGroups.approvedAt), inArray(chatGroups.moderationStatus, ["APPROVED", "PENDING"]))!;

/** Threads of these kinds, for queries that join chat_groups. */
export function kindCondition(kinds: ChatThreadKind[]): SQL {
  const visibilities = (Object.keys(GROUP_KIND_OF) as ChatGroupVisibility[]).filter((v) => kinds.includes(GROUP_KIND_OF[v]));
  const parts: SQL[] = [];
  if (kinds.includes("DIRECT")) parts.push(eq(chatConversations.kind, "DIRECT"));
  if (visibilities.length > 0) parts.push(and(eq(chatConversations.kind, "GROUP"), inArray(chatGroups.visibility, visibilities))!);
  return parts.length > 0 ? or(...parts)! : sql`false`;
}

/** Any direct thread, and a group that's live or the viewer's own: a group waiting for approval, rejected or removed is only its owner's to see. */
const threadVisible = (viewerMembershipId: string): SQL => or(eq(chatConversations.kind, "DIRECT"), groupLive(), eq(chatGroups.ownerMembershipId, viewerMembershipId))!;

/** Who sees a message: its sender, and otherwise anyone it wasn't withheld from. */
const visibleTo = (viewerMembershipId: string) => or(eq(chatMessages.withheld, false), eq(chatMessages.senderMembershipId, viewerMembershipId))!;

/** Lock waits fail after this rather than holding a pooled connection for as long as the lock's holder takes. */
export async function limitLockWait(tx: Tx): Promise<void> {
  await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
}

/** The two ids of a pair, in the order the row stores them. */
export function directPair(a: string, b: string): { low: string; high: string } {
  return a < b ? { low: a, high: b } : { low: b, high: a };
}

/**
 * Holds a pair of members until the transaction ends. There's no row to lock before their first message, so without this a
 * block and a first message landing together could each miss the other. Taken before the conversation, and only by what
 * might create one or what must see one being created.
 */
export async function lockPair(tx: Tx, tenantId: string, a: string, b: string): Promise<void> {
  const { low, high } = directPair(a, b);
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`chat-pair:${tenantId}:${low}:${high}`}, 0))`);
}

/** Holds the conversation until the transaction ends. Every write that orders messages or changes a thread's state goes through this first, and takes any participant row after it. */
export async function lockConversation(tx: Tx, tenantId: string, id: string): Promise<ConversationRow | undefined> {
  const [row] = await tx
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.id, id)))
    .for("no key update");
  return row;
}

export async function lockDirectConversation(tx: Tx, tenantId: string, a: string, b: string): Promise<ConversationRow | undefined> {
  const { low, high } = directPair(a, b);
  const [row] = await tx
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.kind, "DIRECT"), eq(chatConversations.directLowId, low), eq(chatConversations.directHighId, high)))
    .for("no key update");
  return row;
}

/**
 * The pair's conversation, locked, creating it if there's none, with `created` saying which. Two members writing to each
 * other at once converge here: the second insert waits for the first to commit, adds nothing, and then finds its row.
 */
export async function getOrCreateDirectConversation(
  tx: Tx,
  input: { tenantId: string; aId: string; bId: string; values: Pick<ConversationInsert, "origin" | "originId" | "directState" | "requesterMembershipId" | "requestedAt" | "requestCount" | "lastMessageAt"> },
): Promise<{ conversation: ConversationRow; created: boolean }> {
  const { low, high } = directPair(input.aId, input.bId);
  const [inserted] = await tx
    .insert(chatConversations)
    .values({ ...input.values, tenantId: input.tenantId, kind: "DIRECT", directLowId: low, directHighId: high })
    .onConflictDoNothing()
    .returning();
  if (inserted) {
    await tx.insert(chatParticipants).values([low, high].map((membershipId) => ({ conversationId: inserted.id, membershipId, tenantId: input.tenantId })));
    return { conversation: inserted, created: true };
  }
  const conversation = await lockDirectConversation(tx, input.tenantId, low, high);
  if (!conversation) throw new Error("The direct conversation vanished between its insert and its lock");
  return { conversation, created: false };
}

export async function updateConversation(db: DbClient, id: string, values: Partial<ConversationInsert>): Promise<ConversationRow> {
  const [row] = await db
    .update(chatConversations)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(chatConversations.id, id))
    .returning();
  return row!;
}

/**
 * A real change to a thread's state. Whatever a withheld send let its sender believe gives way to it, so both members read
 * the same state again.
 */
export async function changeDirectState(tx: Tx, id: string, values: Partial<ConversationInsert>): Promise<void> {
  await updateConversation(tx, id, values);
  await tx
    .update(chatParticipants)
    .set({ withheldState: null, withheldRequestedAt: null, withheldRequestCount: null })
    .where(and(eq(chatParticipants.conversationId, id), isNotNull(chatParticipants.withheldState)));
}

export async function findMessageByClientKey(db: DbClient, conversationId: string, senderMembershipId: string, clientKey: string): Promise<ChatMessageRow | undefined> {
  const [row] = await db
    .select()
    .from(chatMessages)
    .where(and(eq(chatMessages.conversationId, conversationId), eq(chatMessages.senderMembershipId, senderMembershipId), eq(chatMessages.clientKey, clientKey)))
    .limit(1);
  return row;
}

/** Takes the next `seq` and inserts the message. The caller holds the conversation lock, which is what keeps `seq` gapless and in commit order. */
export async function insertNextMessage(tx: Tx, values: Omit<ChatMessageInsert, "seq" | "createdAt"> & { createdAt: Date }): Promise<ChatMessageRow> {
  const [conversation] = await tx
    .update(chatConversations)
    .set({ lastSeq: sql`${chatConversations.lastSeq} + 1`, lastMessageAt: values.createdAt, updatedAt: values.createdAt })
    .where(eq(chatConversations.id, values.conversationId))
    .returning({ seq: chatConversations.lastSeq });
  const [row] = await tx.insert(chatMessages).values({ ...values, seq: conversation!.seq }).returning();
  return row!;
}

export async function findParticipant(db: DbClient, conversationId: string, membershipId: string): Promise<ParticipantRow | undefined> {
  const [row] = await db
    .select()
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.membershipId, membershipId)))
    .limit(1);
  return row;
}

export async function updateParticipant(db: DbClient, conversationId: string, membershipId: string, values: Partial<typeof chatParticipants.$inferInsert>): Promise<void> {
  await db
    .update(chatParticipants)
    .set(values)
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.membershipId, membershipId)));
}

/** Starts a frozen member's list moving again, because there's a message they can see: everyone's, or just this member's when it's withheld from the rest. */
export async function thawParticipants(tx: Tx, conversationId: string, onlyMembershipId?: string | null): Promise<void> {
  await tx
    .update(chatParticipants)
    .set({ frozenSortAt: null })
    .where(and(eq(chatParticipants.conversationId, conversationId), isNotNull(chatParticipants.frozenSortAt), onlyMembershipId ? eq(chatParticipants.membershipId, onlyMembershipId) : undefined));
}

/**
 * Moves the read position forward, up to the last message this member can see and never back. Returns how far they've read
 * as far as they can tell, which is what to show them: the stored position can pass that after an unblock, and it counts
 * rows withheld from them. Undefined when they aren't an active participant.
 */
export async function advanceRead(db: DbClient, conversationId: string, membershipId: string, seq: number): Promise<number | undefined> {
  const visible = sql<number>`(select coalesce(max(${chatMessages.seq}), 0) from ${chatMessages} where ${chatMessages.conversationId} = ${conversationId} and ${visibleTo(membershipId)})`;
  const [row] = await db
    .update(chatParticipants)
    .set({ lastReadSeq: sql`greatest(${chatParticipants.lastReadSeq}, least(${seq}::int, ${visible}))` })
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.membershipId, membershipId), eq(chatParticipants.state, "ACTIVE")))
    .returning({ lastReadSeq: sql<number>`least(${chatParticipants.lastReadSeq}, ${visible})` });
  return row?.lastReadSeq;
}

/** What chatRecipients() decides on, with the institution read at the same moment. */
export interface DeliveryCandidate {
  membership: Pick<MembershipRow, "id" | "userId" | "status" | "batchYear" | "dateOfBirth">;
  tenant: Pick<TenantRow, "type" | "timezone" | "status">;
}

const deliveryColumns = {
  membership: { id: memberships.id, userId: memberships.userId, status: memberships.status, batchYear: memberships.batchYear, dateOfBirth: memberships.dateOfBirth },
  tenant: { type: tenants.type, timezone: tenants.timezone, status: tenants.status },
};

export async function findDeliveryCandidate(db: DbClient, membershipId: string): Promise<DeliveryCandidate | undefined> {
  const [row] = await db.select(deliveryColumns).from(memberships).innerJoin(tenants, eq(tenants.id, memberships.tenantId)).where(eq(memberships.id, membershipId)).limit(1);
  return row;
}

export async function listDeliveryCandidates(db: DbClient, conversationId: string): Promise<DeliveryCandidate[]> {
  return db
    .select(deliveryColumns)
    .from(chatParticipants)
    .innerJoin(memberships, eq(memberships.id, chatParticipants.membershipId))
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.state, "ACTIVE")));
}

/** What about a conversation decides whether it may be delivered at all: its kind, its group, and its institution's switches as stored. */
export interface DeliveryScope {
  conversation: Pick<ConversationRow, "kind">;
  group: Pick<ChatGroupRow, "visibility" | "ownerMembershipId" | "approvedAt" | "moderationStatus"> | null;
  tenantType: TenantRow["type"];
  storedFeatures: Partial<TenantFeatures>;
}

export async function findDeliveryScope(db: DbClient, conversationId: string): Promise<DeliveryScope | undefined> {
  const [row] = await db
    .select({
      conversation: { kind: chatConversations.kind },
      group: { visibility: chatGroups.visibility, ownerMembershipId: chatGroups.ownerMembershipId, approvedAt: chatGroups.approvedAt, moderationStatus: chatGroups.moderationStatus },
      tenantType: tenants.type,
      storedFeatures: tenantSettings.features,
    })
    .from(chatConversations)
    .innerJoin(tenants, eq(tenants.id, chatConversations.tenantId))
    .innerJoin(tenantSettings, eq(tenantSettings.tenantId, chatConversations.tenantId))
    .leftJoin(chatGroups, eq(chatGroups.conversationId, chatConversations.id))
    .where(eq(chatConversations.id, conversationId))
    .limit(1);
  return row;
}

const notMuted = (now: Date) => or(isNull(chatParticipants.mutedUntil), lte(chatParticipants.mutedUntil, now));

export async function findConversation(db: DbClient, tenantId: string, id: string): Promise<ConversationRow | undefined> {
  const [row] = await db
    .select()
    .from(chatConversations)
    .where(and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.id, id)))
    .limit(1);
  return row;
}

/** A conversation and, if it's a group, its group. */
export async function findConversationWithGroup(db: DbClient, tenantId: string, id: string): Promise<{ conversation: ConversationRow; group: ChatGroupRow | null } | undefined> {
  const [row] = await db
    .select({ conversation: chatConversations, group: chatGroups })
    .from(chatConversations)
    .leftJoin(chatGroups, eq(chatGroups.conversationId, chatConversations.id))
    .where(and(eq(chatConversations.tenantId, tenantId), eq(chatConversations.id, id)))
    .limit(1);
  return row;
}

/** Of these members, those who haven't muted this conversation. */
export async function findUnmutedParticipants(db: DbClient, conversationId: string, membershipIds: string[], now: Date): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ membershipId: chatParticipants.membershipId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), inArray(chatParticipants.membershipId, membershipIds), notMuted(now)));
  return rows.map((r) => r.membershipId);
}

/**
 * A message that counts as news for the participant row in scope: written by someone (a system line about a member joining
 * isn't worth a push or a bold row), after they last read and after they joined, not withheld, not removed, not theirs, and
 * not from someone they've blocked.
 */
const isNewsFor = (participant: typeof chatParticipants) => sql`
  ${chatMessages.conversationId} = ${participant.conversationId}
  and ${chatMessages.kind} = 'TEXT'
  and ${chatMessages.seq} > greatest(${participant.lastReadSeq}, ${participant.joinedSeq})
  and ${chatMessages.withheld} = false
  and ${chatMessages.removedAt} is null
  and ${chatMessages.senderMembershipId} is distinct from ${participant.membershipId}
  and not exists (select 1 from ${chatBlocks} where ${chatBlocks.blockerMembershipId} = ${participant.membershipId} and ${chatBlocks.blockedMembershipId} = ${chatMessages.senderMembershipId})`;

/**
 * Of these members, those with something to be pushed about: not muted, and with an unread message that counts as news.
 * Counting `last_seq` alone would push about withheld, removed and blocked members' messages too.
 */
export async function findParticipantsWithNews(db: DbClient, conversationId: string, membershipIds: string[], now: Date): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const hasNews = sql`exists (select 1 from ${chatMessages} where ${isNewsFor(chatParticipants)})`;
  const rows = await db
    .select({ membershipId: chatParticipants.membershipId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), inArray(chatParticipants.membershipId, membershipIds), notMuted(now), hasNews));
  return rows.map((r) => r.membershipId);
}

/**
 * How many unread messages the viewer has in each of these group threads, counting only news: a group's `last_seq` moves for
 * system lines and for members they blocked, so the arithmetic a direct thread uses would overcount. Absent means none.
 */
export async function countGroupUnread(db: DbClient, viewerMembershipId: string, conversationIds: string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await db
    .select({ conversationId: chatMessages.conversationId, count: sql<number>`count(*)::int` })
    .from(chatMessages)
    .innerJoin(chatParticipants, and(eq(chatParticipants.conversationId, chatMessages.conversationId), eq(chatParticipants.membershipId, viewerMembershipId)))
    .where(and(inArray(chatMessages.conversationId, conversationIds), isNewsFor(chatParticipants)))
    .groupBy(chatMessages.conversationId);
  return new Map(rows.map((r) => [r.conversationId, r.count]));
}

// --- Blocks ---

export async function insertBlock(db: DbClient, values: typeof chatBlocks.$inferInsert): Promise<boolean> {
  const rows = await db.insert(chatBlocks).values(values).onConflictDoNothing().returning({ id: chatBlocks.blockedMembershipId });
  return rows.length > 0;
}

export async function deleteBlock(db: DbClient, blockerMembershipId: string, blockedMembershipId: string): Promise<boolean> {
  const rows = await db
    .delete(chatBlocks)
    .where(and(eq(chatBlocks.blockerMembershipId, blockerMembershipId), eq(chatBlocks.blockedMembershipId, blockedMembershipId)))
    .returning({ id: chatBlocks.blockedMembershipId });
  return rows.length > 0;
}

export async function findBlock(db: DbClient, blockerMembershipId: string, blockedMembershipId: string): Promise<ChatBlockRow | undefined> {
  const [row] = await db
    .select()
    .from(chatBlocks)
    .where(and(eq(chatBlocks.blockerMembershipId, blockerMembershipId), eq(chatBlocks.blockedMembershipId, blockedMembershipId)))
    .limit(1);
  return row;
}

export async function findBlockedByMember(db: DbClient, blockerMembershipId: string): Promise<string[]> {
  const rows = await db.select({ blocked: chatBlocks.blockedMembershipId }).from(chatBlocks).where(eq(chatBlocks.blockerMembershipId, blockerMembershipId));
  return rows.map((r) => r.blocked);
}

export async function blocksBetween(db: DbClient, me: string, other: string): Promise<{ byMe: boolean; byOther: boolean }> {
  const rows = await db
    .select({ blocker: chatBlocks.blockerMembershipId })
    .from(chatBlocks)
    .where(or(and(eq(chatBlocks.blockerMembershipId, me), eq(chatBlocks.blockedMembershipId, other)), and(eq(chatBlocks.blockerMembershipId, other), eq(chatBlocks.blockedMembershipId, me))));
  return { byMe: rows.some((r) => r.blocker === me), byOther: rows.some((r) => r.blocker === other) };
}

/** Of these members, those who have `blockedMembershipId` blocked. */
export async function findBlockersAmong(db: DbClient, blockedMembershipId: string, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ blocker: chatBlocks.blockerMembershipId })
    .from(chatBlocks)
    .where(and(eq(chatBlocks.blockedMembershipId, blockedMembershipId), inArray(chatBlocks.blockerMembershipId, membershipIds)));
  return rows.map((r) => r.blocker);
}

export async function listBlocks(db: DbClient, tenantId: string, blockerMembershipId: string, q: { cursor?: string; limit: number }): Promise<CursorPage<{ block: ChatBlockRow; member: ChatSender }>> {
  const conds: SQL[] = [eq(chatBlocks.tenantId, tenantId), eq(chatBlocks.blockerMembershipId, blockerMembershipId)];
  const keyset = keysetCondition(chatBlocks.createdAt, chatBlocks.blockedMembershipId, decodeCursor(q.cursor), "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ block: chatBlocks, member: senderColumns })
    .from(chatBlocks)
    .innerJoin(memberships, eq(memberships.id, chatBlocks.blockedMembershipId))
    .where(and(...conds))
    .orderBy(desc(chatBlocks.createdAt), desc(chatBlocks.blockedMembershipId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.block.createdAt.toISOString(), id: r.block.blockedMembershipId }), (r) => r);
}

// --- Reading threads ---

/** A viewer's thread: their own participant row, the other member of a direct thread if there still is one, and a group's details. */
export interface ThreadRow {
  conversation: ConversationRow;
  participant: ParticipantRow;
  peer: Pick<MembershipRow, "id" | "fullName" | "avatarUrl" | "status" | "batchYear" | "dateOfBirth"> | null;
  blockedByMe: boolean;
  group: ChatGroupRow | null;
}

const threadColumns = (viewerMembershipId: string) => ({
  conversation: chatConversations,
  participant: chatParticipants,
  peer: { id: memberships.id, fullName: memberships.fullName, avatarUrl: memberships.avatarUrl, status: memberships.status, batchYear: memberships.batchYear, dateOfBirth: memberships.dateOfBirth },
  blockedByMe: sql<boolean>`exists (select 1 from ${chatBlocks} where ${chatBlocks.blockerMembershipId} = ${viewerMembershipId} and ${chatBlocks.blockedMembershipId} = ${memberships.id})`,
  group: chatGroups,
});

/** The other member of a viewer's direct thread. A group has none, so nothing joins. */
const peerJoin = (viewerMembershipId: string) => sql`${memberships.id} = case when ${chatConversations.directLowId} = ${viewerMembershipId} then ${chatConversations.directHighId} else ${chatConversations.directLowId} end`;

const groupJoin = eq(chatGroups.conversationId, chatConversations.id);

/** A thread the viewer is in and may see, of any kind. Whether its kind is switched on is the caller's to check. */
export async function findThread(db: DbClient, tenantId: string, viewerMembershipId: string, conversationId: string): Promise<ThreadRow | undefined> {
  const [row] = await db
    .select(threadColumns(viewerMembershipId))
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(memberships, peerJoin(viewerMembershipId))
    .leftJoin(chatGroups, groupJoin)
    .where(
      and(
        eq(chatParticipants.tenantId, tenantId),
        eq(chatParticipants.membershipId, viewerMembershipId),
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.state, "ACTIVE"),
        threadVisible(viewerMembershipId),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Which threads an inbox holds. A requester's request stays in their main inbox whatever became of it, because moving it
 * would reveal a decline, and so does anything a withheld send made its sender believe. A request the member declined is in
 * no list. A request from someone suspended is out of sight until they're reinstated. Groups are in the main inbox.
 */
function inboxCondition(viewerMembershipId: string, inbox: ChatInbox): SQL {
  const iAsked = eq(chatConversations.requesterMembershipId, viewerMembershipId);
  if (inbox === "REQUESTS") return and(eq(chatConversations.directState, "PENDING"), isNull(chatParticipants.withheldState), sql`${chatConversations.requesterMembershipId} is distinct from ${viewerMembershipId}`, eq(memberships.status, "APPROVED"))!;
  return or(eq(chatConversations.kind, "GROUP"), isNotNull(chatParticipants.withheldState), inArray(chatConversations.directState, ["ACCEPTED", "CLOSED"]), and(inArray(chatConversations.directState, ["PENDING", "DECLINED"]), iAsked))!;
}

export async function listThreads(db: DbClient, tenantId: string, viewerMembershipId: string, q: { inbox: ChatInbox; kinds: ChatThreadKind[]; cursor?: string; limit: number }): Promise<CursorPage<ThreadRow>> {
  // A frozen thread stays where it was, so a blocked member's messages can't move it.
  const sortAt = sql`coalesce(${chatParticipants.frozenSortAt}, ${chatConversations.lastMessageAt})`;
  const conds: SQL[] = [
    eq(chatParticipants.tenantId, tenantId),
    eq(chatParticipants.membershipId, viewerMembershipId),
    eq(chatParticipants.state, "ACTIVE"),
    kindCondition(q.kinds),
    threadVisible(viewerMembershipId),
    inboxCondition(viewerMembershipId, q.inbox),
  ];
  const keyset = keysetCondition(sortAt, chatConversations.id, decodeCursor(q.cursor), "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select(threadColumns(viewerMembershipId))
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(memberships, peerJoin(viewerMembershipId))
    .leftJoin(chatGroups, groupJoin)
    .where(and(...conds))
    .orderBy(desc(sortAt), desc(chatConversations.id))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: (r.participant.frozenSortAt ?? r.conversation.lastMessageAt).toISOString(), id: r.conversation.id }), (r) => r);
}

/** The viewer's thread with another member, if this inbox of theirs lists it. */
export async function findDirectThreadInInbox(db: DbClient, tenantId: string, viewerMembershipId: string, otherMembershipId: string, inbox: ChatInbox): Promise<ThreadRow | undefined> {
  const { low, high } = directPair(viewerMembershipId, otherMembershipId);
  const [row] = await db
    .select(threadColumns(viewerMembershipId))
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(memberships, peerJoin(viewerMembershipId))
    .leftJoin(chatGroups, groupJoin)
    .where(
      and(
        eq(chatParticipants.tenantId, tenantId),
        eq(chatParticipants.membershipId, viewerMembershipId),
        eq(chatParticipants.state, "ACTIVE"),
        eq(chatConversations.kind, "DIRECT"),
        eq(chatConversations.directLowId, low),
        eq(chatConversations.directHighId, high),
        inboxCondition(viewerMembershipId, inbox),
      ),
    )
    .limit(1);
  return row;
}

/** Everything the badge counts from, one row per thread of this member. */
export async function listBadgeThreads(db: DbClient, tenantId: string, viewerMembershipId: string, kinds: ChatThreadKind[]): Promise<ThreadRow[]> {
  return db
    .select(threadColumns(viewerMembershipId))
    .from(chatParticipants)
    .innerJoin(chatConversations, eq(chatConversations.id, chatParticipants.conversationId))
    .leftJoin(memberships, peerJoin(viewerMembershipId))
    .leftJoin(chatGroups, groupJoin)
    .where(and(eq(chatParticipants.tenantId, tenantId), eq(chatParticipants.membershipId, viewerMembershipId), eq(chatParticipants.state, "ACTIVE"), kindCondition(kinds), threadVisible(viewerMembershipId)));
}

export type MessageWithSender = { message: ChatMessageRow; sender: ChatSender | null };

export async function listThreadMessages(
  db: DbClient,
  viewer: Pick<ParticipantRow, "conversationId" | "membershipId" | "joinedSeq">,
  q: { cursor?: string; afterSeq?: string; limit: number },
): Promise<CursorPage<MessageWithSender>> {
  const conds: SQL[] = [eq(chatMessages.conversationId, viewer.conversationId), gt(chatMessages.seq, viewer.joinedSeq), visibleTo(viewer.membershipId)];
  const ascending = q.afterSeq !== undefined;
  if (ascending) conds.push(gt(chatMessages.seq, parseCursorSeq(q.afterSeq!)));
  const keyset = keysetCondition(chatMessages.seq, chatMessages.id, decodeCursor(q.cursor), "desc", parseCursorSeq);
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ message: chatMessages, sender: senderColumns })
    .from(chatMessages)
    .leftJoin(memberships, eq(memberships.id, chatMessages.senderMembershipId))
    .where(and(...conds))
    .orderBy(ascending ? asc(chatMessages.seq) : desc(chatMessages.seq))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: String(r.message.seq), id: r.message.id }), (r) => r);
}

/**
 * The newest message this member can see in each of these threads, for the list's preview. Nothing from before they joined,
 * which in an invite-only group would show a newcomer the last thing said before them.
 */
export async function findLastVisibleMessages(db: DbClient, viewerMembershipId: string, conversationIds: string[]): Promise<Map<string, MessageWithSender>> {
  if (conversationIds.length === 0) return new Map();
  const joinedSeq = sql`coalesce((select ${chatParticipants.joinedSeq} from ${chatParticipants} where ${chatParticipants.conversationId} = ${chatMessages.conversationId} and ${chatParticipants.membershipId} = ${viewerMembershipId}), 0)`;
  const rows = await db
    .selectDistinctOn([chatMessages.conversationId], { message: chatMessages, sender: senderColumns })
    .from(chatMessages)
    .leftJoin(memberships, eq(memberships.id, chatMessages.senderMembershipId))
    .where(and(inArray(chatMessages.conversationId, conversationIds), visibleTo(viewerMembershipId), gt(chatMessages.seq, joinedSeq)))
    .orderBy(chatMessages.conversationId, desc(chatMessages.seq));
  return new Map(rows.map((r) => [r.message.conversationId, r]));
}

export async function findMessageInTenant(db: DbClient, tenantId: string, id: string): Promise<{ message: ChatMessageRow; conversation: ConversationRow } | undefined> {
  const [row] = await db
    .select({ message: chatMessages, conversation: chatConversations })
    .from(chatMessages)
    .innerJoin(chatConversations, eq(chatConversations.id, chatMessages.conversationId))
    .where(and(eq(chatMessages.tenantId, tenantId), eq(chatMessages.id, id)))
    .limit(1);
  return row;
}

/** Undefined if it was removed already or is gone, so two removals can't both believe they did it. */
export async function markMessageRemoved(db: DbClient, tenantId: string, id: string, values: { removedByUserId: string; removalNote: string | null }): Promise<ChatMessageRow | undefined> {
  const [row] = await db
    .update(chatMessages)
    .set({ removedAt: new Date(), ...values })
    .where(and(eq(chatMessages.tenantId, tenantId), eq(chatMessages.id, id), isNull(chatMessages.removedAt)))
    .returning();
  return row;
}

// --- Report context ---

/**
 * The messages an admin may see for a report, frozen now and computed for this reporter: the target and up to five either
 * side, oldest first. Leaves out anything before they joined, anything withheld, which can't be reviewed by anyone, anything
 * redacted for them and anything already removed. `redactedSenderIds` are senders whose messages this reporter sees
 * redacted, which only happens in a group.
 */
export async function reportContextIds(db: DbClient, target: Pick<ChatMessageRow, "id" | "conversationId" | "seq">, reporter: Pick<ParticipantRow, "joinedSeq">, redactedSenderIds: string[]): Promise<string[]> {
  const shown = and(
    eq(chatMessages.conversationId, target.conversationId),
    gt(chatMessages.seq, reporter.joinedSeq),
    eq(chatMessages.withheld, false),
    isNull(chatMessages.removedAt),
    redactedSenderIds.length > 0 ? or(isNull(chatMessages.senderMembershipId), notInArray(chatMessages.senderMembershipId, redactedSenderIds)) : undefined,
  );
  const select = () => db.select({ id: chatMessages.id }).from(chatMessages);
  const earlier = await select().where(and(shown, lt(chatMessages.seq, target.seq))).orderBy(desc(chatMessages.seq)).limit(CHAT_REPORT_CONTEXT_EACH_SIDE);
  const later = await select().where(and(shown, gt(chatMessages.seq, target.seq))).orderBy(asc(chatMessages.seq)).limit(CHAT_REPORT_CONTEXT_EACH_SIDE);
  return [...earlier.reverse().map((m) => m.id), target.id, ...later.map((m) => m.id)];
}

// --- Account deletion ---

/** Everything in the member's threads that deleting them would change, locked in one order so this can't deadlock with a send. */
export async function lockConversationsOfMembers(tx: Tx, membershipIds: string[]): Promise<ConversationRow[]> {
  if (membershipIds.length === 0) return [];
  return tx
    .select({ conversation: chatConversations })
    .from(chatConversations)
    .innerJoin(chatParticipants, eq(chatParticipants.conversationId, chatConversations.id))
    .where(inArray(chatParticipants.membershipId, membershipIds))
    .orderBy(asc(chatConversations.id))
    .for("no key update", { of: chatConversations })
    .then((rows) => rows.map((r) => r.conversation));
}

export async function deleteWithheldMessagesOf(tx: Tx, membershipIds: string[]): Promise<void> {
  if (membershipIds.length === 0) return;
  await tx.delete(chatMessages).where(and(eq(chatMessages.withheld, true), inArray(chatMessages.senderMembershipId, membershipIds)));
}

// --- Demo data ---

/**
 * Writes a whole direct thread with real `seq` values, for the seed, which has no chat API or realtime to go through.
 * `unreadByRecipient` leaves that many of the newest messages unread by whoever didn't send them. With `origin`, it's a
 * thread an accepted mentorship or referral opened, as openDirectFromOrigin writes one: no request, and the first message
 * is the note, with the same client key.
 */
export async function seedDirectThread(
  tx: Tx,
  input: {
    tenantId: string;
    aId: string;
    bId: string;
    requesterId: string;
    state: NonNullable<ConversationRow["directState"]>;
    messages: Array<{ senderId: string; body: string; at: Date }>;
    unreadByRecipient?: number;
    origin?: { kind: "MENTORSHIP" | "REFERRAL"; id: string };
  },
): Promise<ChatMessageRow[]> {
  const { tenantId, aId, bId, requesterId, state, messages, unreadByRecipient = 0, origin } = input;
  const first = messages[0]!.at;
  const last = messages[messages.length - 1]!;
  const { low, high } = directPair(aId, bId);
  const opening = origin
    ? { origin: origin.kind, originId: origin.id, requesterMembershipId: null, requestedAt: null, requestCount: 0 }
    : { origin: "MESSAGE_REQUEST" as const, requesterMembershipId: requesterId, requestedAt: first, requestCount: 1 };
  const [conversation] = await tx
    .insert(chatConversations)
    .values({ tenantId, kind: "DIRECT", ...opening, lastSeq: messages.length, lastMessageAt: last.at, directLowId: low, directHighId: high, directState: state, createdAt: first, updatedAt: last.at })
    .returning();
  const rows = await tx
    .insert(chatMessages)
    .values(messages.map((m, i) => ({ tenantId, conversationId: conversation!.id, seq: i + 1, senderMembershipId: m.senderId, kind: "TEXT" as const, body: m.body, clientKey: origin && i === 0 ? `origin-${origin.id}` : null, createdAt: m.at })))
    .returning();
  const lastReadBy = (membershipId: string) => {
    const read = messages.length - (membershipId === last.senderId ? 0 : unreadByRecipient);
    return state === "PENDING" && membershipId !== requesterId ? 0 : read;
  };
  await tx.insert(chatParticipants).values([low, high].map((membershipId) => ({ conversationId: conversation!.id, membershipId, tenantId, lastReadSeq: lastReadBy(membershipId), createdAt: first })));
  return rows.sort((a, b) => a.seq - b.seq);
}
