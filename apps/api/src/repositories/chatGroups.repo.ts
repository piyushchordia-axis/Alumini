import { and, asc, desc, eq, gt, ilike, inArray, isNull, ne, notExists, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { wallPartsInZone, type ChatGroupScope, type ChatGroupVisibility } from "@illuminize/shared";
import type { DbClient, Tx } from "../db/client";
import { chatBlocks, chatConversations, chatGroups, chatInviteDeclines, chatMessages, chatParticipants, memberships } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";
import type { TenantRow } from "../types/request";
import { groupLive, lockConversation, senderColumns, type ChatGroupRow, type ChatSender, type ConversationRow, type ParticipantRow } from "./chat.repo";
import { escapeLike, type ModerationPatch } from "./content.common";

export type { ChatGroupRow };
export type ChatGroupInsert = typeof chatGroups.$inferInsert;
export type ParticipantInsert = typeof chatParticipants.$inferInsert;

/** A group, the viewer's own participant row if they have one, and its owner. */
export interface GroupViewRow {
  group: ChatGroupRow;
  participant: ParticipantRow | null;
  owner: ChatSender | null;
}

const owners = alias(memberships, "group_owner");
const inviters = alias(memberships, "group_inviter");

const viewColumns = { group: chatGroups, participant: chatParticipants, owner: { id: owners.id, fullName: owners.fullName, avatarUrl: owners.avatarUrl } };

const viewerJoin = (viewerMembershipId: string) => and(eq(chatParticipants.conversationId, chatGroups.conversationId), eq(chatParticipants.membershipId, viewerMembershipId));

/** The name each member sees, for searching: the approved one, or for its owner before it was first approved, their own. */
const shownName = sql`coalesce(${chatGroups.approvedName}, ${chatGroups.name})`;

export async function findGroupView(db: DbClient, tenantId: string, id: string, viewerMembershipId: string): Promise<GroupViewRow | undefined> {
  const [row] = await db
    .select(viewColumns)
    .from(chatGroups)
    .leftJoin(chatParticipants, viewerJoin(viewerMembershipId))
    .leftJoin(owners, eq(owners.id, chatGroups.ownerMembershipId))
    .where(and(eq(chatGroups.tenantId, tenantId), eq(chatGroups.conversationId, id)))
    .limit(1);
  return row;
}

export async function findGroupById(db: DbClient, tenantId: string, id: string): Promise<ChatGroupRow | undefined> {
  const [row] = await db
    .select()
    .from(chatGroups)
    .where(and(eq(chatGroups.tenantId, tenantId), eq(chatGroups.conversationId, id)))
    .limit(1);
  return row;
}

/** A group with its owner, for an admin. */
export async function findGroupWithOwner(db: DbClient, tenantId: string, id: string) {
  const [row] = await db
    .select({ group: chatGroups, owner: memberships })
    .from(chatGroups)
    .leftJoin(memberships, eq(memberships.id, chatGroups.ownerMembershipId))
    .where(and(eq(chatGroups.tenantId, tenantId), eq(chatGroups.conversationId, id)))
    .limit(1);
  return row;
}

/**
 * Holds a group until the transaction ends: its conversation first, as every chat write does, then its own row. Everything
 * that changes who is in it, or counts them, goes through this.
 */
export async function lockGroup(tx: Tx, tenantId: string, id: string): Promise<{ conversation: ConversationRow; group: ChatGroupRow } | undefined> {
  const conversation = await lockConversation(tx, tenantId, id);
  if (!conversation || conversation.kind !== "GROUP") return undefined;
  const [group] = await tx.select().from(chatGroups).where(eq(chatGroups.conversationId, id)).for("update");
  return group && { conversation, group };
}

/**
 * A group's row for a caller already holding its conversation, kept from changing until the transaction ends: a send reads
 * whether the room is open, and an admin's decision mustn't land between that and the message.
 */
export async function lockGroupRow(tx: Tx, id: string, mode: "share" | "update" = "share"): Promise<ChatGroupRow | undefined> {
  const [group] = await tx.select().from(chatGroups).where(eq(chatGroups.conversationId, id)).for(mode);
  return group;
}

/** Groups this member owns that aren't archived, oldest first, for handing them on. */
export async function listOwnedGroupIds(db: DbClient, tenantId: string, ownerMembershipId: string): Promise<string[]> {
  const rows = await db
    .select({ id: chatGroups.conversationId })
    .from(chatGroups)
    .where(and(eq(chatGroups.tenantId, tenantId), eq(chatGroups.ownerMembershipId, ownerMembershipId), isNull(chatGroups.archivedAt)))
    .orderBy(asc(chatGroups.conversationId));
  return rows.map((r) => r.id);
}

/** A new group's conversation, its row and its owner, in one go. Approved from the start if `moderationStatus` says so. */
export async function insertGroup(
  tx: Tx,
  input: { tenantId: string; ownerMembershipId: string; name: string; description: string | null; visibility: ChatGroupVisibility; moderationStatus: ChatGroupRow["moderationStatus"]; now: Date },
): Promise<ChatGroupRow> {
  const { tenantId, ownerMembershipId, name, description, visibility, moderationStatus, now } = input;
  const [conversation] = await tx.insert(chatConversations).values({ tenantId, kind: "GROUP", origin: "GROUP", lastMessageAt: now, createdAt: now, updatedAt: now }).returning({ id: chatConversations.id });
  const approved = moderationStatus === "APPROVED";
  const [group] = await tx
    .insert(chatGroups)
    .values({
      conversationId: conversation!.id,
      tenantId,
      name,
      description,
      visibility,
      ownerMembershipId,
      memberCount: 1,
      moderationStatus,
      moderatedAt: approved ? now : null,
      approvedName: approved ? name : null,
      approvedDescription: approved ? description : null,
      approvedAt: approved ? now : null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await tx.insert(chatParticipants).values({ conversationId: conversation!.id, membershipId: ownerMembershipId, tenantId, state: "ACTIVE", role: "OWNER", joinedAt: now, createdAt: now });
  return group!;
}

export async function updateGroup(db: DbClient, id: string, values: Partial<ChatGroupInsert>): Promise<ChatGroupRow> {
  const [row] = await db
    .update(chatGroups)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(chatGroups.conversationId, id))
    .returning();
  return row!;
}

export async function adjustMemberCount(tx: Tx, id: string, delta: number): Promise<void> {
  await tx
    .update(chatGroups)
    .set({ memberCount: sql`greatest(${chatGroups.memberCount} + ${delta}, 0)`, updatedAt: new Date() })
    .where(eq(chatGroups.conversationId, id));
}

/** The name and description an admin had in front of them when they decided. */
export interface ReviewedText {
  name: string;
  description: string | null;
}

/**
 * An admin's decision, in one statement with what it means for members: approving publishes the submitted name and
 * description and marks the approval, and rejecting withdraws it, so the owner's next edit can't reopen the room without an
 * admin. Only if the group is still in the state the admin acted on and, when `reviewed` is given, still says exactly what
 * they read: an owner can edit a group that's waiting without its status changing, and approving must never publish words
 * no admin saw. False if it doesn't.
 */
export async function setGroupModeration(db: DbClient, tenantId: string, id: string, patch: ModerationPatch, from: ChatGroupRow["moderationStatus"], reviewed?: ReviewedText): Promise<boolean> {
  const to = patch.moderationStatus;
  const approving = to === "APPROVED";
  const rows = await db
    .update(chatGroups)
    .set({
      ...patch,
      ...(approving ? { approvedName: sql`${chatGroups.name}`, approvedDescription: sql`${chatGroups.description}`, approvedAt: patch.moderatedAt } : {}),
      ...(to === "REJECTED" ? { approvedAt: null } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(chatGroups.tenantId, tenantId),
        eq(chatGroups.conversationId, id),
        eq(chatGroups.moderationStatus, from),
        reviewed ? and(eq(chatGroups.name, reviewed.name), sql`${chatGroups.description} is not distinct from ${reviewed.description}`) : undefined,
      ),
    )
    .returning({ id: chatGroups.conversationId });
  return rows.length > 0;
}

/** What the cap on owned groups counts: those that aren't archived and that an admin hasn't removed. */
export async function countOwnedGroups(db: DbClient, tenantId: string, ownerMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatGroups)
    .where(and(eq(chatGroups.tenantId, tenantId), eq(chatGroups.ownerMembershipId, ownerMembershipId), isNull(chatGroups.archivedAt), ne(chatGroups.moderationStatus, "REMOVED")));
  return row?.count ?? 0;
}

/**
 * DISCOVER: live open groups nobody has archived. One with an edit waiting stays, because a card only ever shows the approved
 * name and description, and it can be joined meanwhile. MINE: groups the viewer is in and may see. OWNED: theirs, whatever
 * moderation made of them. Only of the visibilities given, which is how the institution's switches apply.
 */
export async function listGroups(
  db: DbClient,
  tenantId: string,
  viewerMembershipId: string,
  q: { scope: ChatGroupScope; q?: string; cursor?: string; limit: number; visibilities: ChatGroupVisibility[] },
): Promise<CursorPage<GroupViewRow>> {
  if (q.visibilities.length === 0) return { data: [], nextCursor: null };
  const conds: SQL[] = [eq(chatGroups.tenantId, tenantId), inArray(chatGroups.visibility, q.visibilities)];
  // Not one whose owner is suspended, as other content lists leave out a suspended author's: nobody could run it. Suspending
  // an owner hands their live groups on, so this only meets one an admin approved or restored during the suspension.
  if (q.scope === "DISCOVER") conds.push(eq(chatGroups.visibility, "OPEN"), groupLive(), isNull(chatGroups.archivedAt), eq(owners.status, "APPROVED"));
  else if (q.scope === "MINE") conds.push(eq(chatParticipants.state, "ACTIVE"), or(groupLive(), eq(chatGroups.ownerMembershipId, viewerMembershipId))!);
  else conds.push(eq(chatGroups.ownerMembershipId, viewerMembershipId));
  if (q.q) conds.push(ilike(shownName, `%${escapeLike(q.q)}%`));
  const keyset = keysetCondition(chatGroups.createdAt, chatGroups.conversationId, decodeCursor(q.cursor), "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select(viewColumns)
    .from(chatGroups)
    .leftJoin(chatParticipants, viewerJoin(viewerMembershipId))
    .leftJoin(owners, eq(owners.id, chatGroups.ownerMembershipId))
    .where(and(...conds))
    .orderBy(desc(chatGroups.createdAt), desc(chatGroups.conversationId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.group.createdAt.toISOString(), id: r.group.conversationId }), (r) => r);
}

/**
 * Invitations a member can see: not suppressed, not lapsed, to a live group that isn't archived, of a kind the institution
 * has on. Anything else stays out of sight rather than being refused, so nothing here reveals what was held back.
 */
function visibleInvites(tenantId: string, viewerMembershipId: string, visibilities: ChatGroupVisibility[], since: Date): SQL {
  return and(
    eq(chatParticipants.tenantId, tenantId),
    eq(chatParticipants.membershipId, viewerMembershipId),
    eq(chatParticipants.state, "INVITED"),
    eq(chatParticipants.inviteSuppressed, false),
    gt(chatParticipants.invitedAt, since),
    groupLive(),
    isNull(chatGroups.archivedAt),
    visibilities.length > 0 ? inArray(chatGroups.visibility, visibilities) : sql`false`,
  )!;
}

export interface InviteRow extends GroupViewRow {
  participant: ParticipantRow;
  inviter: ChatSender | null;
}

export async function listInvites(
  db: DbClient,
  tenantId: string,
  viewerMembershipId: string,
  q: { cursor?: string; limit: number; visibilities: ChatGroupVisibility[]; since: Date },
): Promise<CursorPage<InviteRow>> {
  const conds: SQL[] = [visibleInvites(tenantId, viewerMembershipId, q.visibilities, q.since)];
  const keyset = keysetCondition(sql`${chatParticipants.invitedAt}`, chatParticipants.conversationId, decodeCursor(q.cursor), "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({ ...viewColumns, participant: chatParticipants, inviter: { id: inviters.id, fullName: inviters.fullName, avatarUrl: inviters.avatarUrl } })
    .from(chatParticipants)
    .innerJoin(chatGroups, eq(chatGroups.conversationId, chatParticipants.conversationId))
    .leftJoin(owners, eq(owners.id, chatGroups.ownerMembershipId))
    .leftJoin(inviters, eq(inviters.id, chatParticipants.invitedByMembershipId))
    .where(and(...conds))
    .orderBy(desc(chatParticipants.invitedAt), desc(chatParticipants.conversationId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: r.participant.invitedAt!.toISOString(), id: r.group.conversationId }), (r) => r);
}

export async function countInvites(db: DbClient, tenantId: string, viewerMembershipId: string, visibilities: ChatGroupVisibility[], since: Date): Promise<number> {
  if (visibilities.length === 0) return 0;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatParticipants)
    .innerJoin(chatGroups, eq(chatGroups.conversationId, chatParticipants.conversationId))
    .where(visibleInvites(tenantId, viewerMembershipId, visibilities, since));
  return row?.count ?? 0;
}

/** Of these members, those with an invitation to this group that's waiting and that they can see, with when it was made. */
export async function findVisibleInvitations(db: DbClient, conversationId: string, membershipIds: string[], since: Date): Promise<Array<{ membershipId: string; invitedAt: Date }>> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ membershipId: chatParticipants.membershipId, invitedAt: chatParticipants.invitedAt })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.conversationId, conversationId),
        inArray(chatParticipants.membershipId, membershipIds),
        eq(chatParticipants.state, "INVITED"),
        eq(chatParticipants.inviteSuppressed, false),
        gt(chatParticipants.invitedAt, since),
      ),
    );
  return rows.flatMap((r) => (r.invitedAt ? [{ membershipId: r.membershipId, invitedAt: r.invitedAt }] : []));
}

/** Everyone with an invitation to this group that's waiting and shown to them. */
export async function listWaitingInviteeIds(db: DbClient, conversationId: string, since: Date): Promise<string[]> {
  const rows = await db
    .select({ id: chatParticipants.membershipId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.state, "INVITED"), eq(chatParticipants.inviteSuppressed, false), gt(chatParticipants.invitedAt, since)));
  return rows.map((r) => r.id);
}

/** Invitations a group has waiting, delivered or not: the inviter can't tell those apart, so neither can the cap. */
export async function countPendingInvites(db: DbClient, conversationId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.state, "INVITED"), gt(chatParticipants.invitedAt, since)));
  return row?.count ?? 0;
}

export interface GroupMemberRow {
  participant: ParticipantRow;
  member: ChatSender;
  blockedByMe: boolean;
}

/** Ordered by who has been in it longest, which is also who would own it next. */
const memberSince = sql`coalesce(${chatParticipants.joinedAt}, ${chatParticipants.createdAt})`;

export async function listGroupMembers(db: DbClient, conversationId: string, viewerMembershipId: string, q: { cursor?: string; limit: number }): Promise<CursorPage<GroupMemberRow>> {
  const conds: SQL[] = [eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.state, "ACTIVE")];
  const keyset = keysetCondition(memberSince, chatParticipants.membershipId, decodeCursor(q.cursor), "asc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select({
      participant: chatParticipants,
      member: senderColumns,
      blockedByMe: sql<boolean>`exists (select 1 from ${chatBlocks} where ${chatBlocks.blockerMembershipId} = ${viewerMembershipId} and ${chatBlocks.blockedMembershipId} = ${memberships.id})`,
    })
    .from(chatParticipants)
    .innerJoin(memberships, eq(memberships.id, chatParticipants.membershipId))
    .where(and(...conds))
    .orderBy(asc(memberSince), asc(chatParticipants.membershipId))
    .limit(q.limit + 1);
  return buildCursorPage(rows, q.limit, (r) => ({ v: (r.participant.joinedAt ?? r.participant.createdAt).toISOString(), id: r.participant.membershipId }), (r) => r);
}

/**
 * Who takes over from an owner: the member who has been in it longest and could run it, so approved and not a current pupil,
 * whom every group route turns away.
 */
export async function findSuccessor(tx: Tx, tenant: Pick<TenantRow, "type" | "timezone">, conversationId: string, excludingMembershipId: string, now: Date): Promise<ChatSender | undefined> {
  const [row] = await tx
    .select(senderColumns)
    .from(chatParticipants)
    .innerJoin(memberships, eq(memberships.id, chatParticipants.membershipId))
    .where(
      and(
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.state, "ACTIVE"),
        ne(chatParticipants.membershipId, excludingMembershipId),
        eq(memberships.status, "APPROVED"),
        notCurrentPupil(tenant, now),
      ),
    )
    .orderBy(asc(memberSince), asc(chatParticipants.membershipId))
    .limit(1);
  return row;
}

/** Of these members, the participant rows they already have here. */
export async function findParticipantsAmong(db: DbClient, conversationId: string, membershipIds: string[]): Promise<Map<string, ParticipantRow>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await db
    .select()
    .from(chatParticipants)
    .where(and(eq(chatParticipants.conversationId, conversationId), inArray(chatParticipants.membershipId, membershipIds)));
  return new Map(rows.map((r) => [r.membershipId, r]));
}

/** Puts a member in a state of the group, whatever row they had, which a member who left or was removed still has. */
export async function upsertParticipant(tx: Tx, key: Pick<ParticipantInsert, "conversationId" | "membershipId" | "tenantId">, changes: Omit<Partial<ParticipantInsert>, "conversationId" | "membershipId" | "tenantId">): Promise<void> {
  await tx
    .insert(chatParticipants)
    .values({ ...key, ...changes })
    .onConflictDoUpdate({ target: [chatParticipants.conversationId, chatParticipants.membershipId], set: changes });
}

/**
 * The pupil rule of isCurrentPupil, in SQL, for a list that has to leave pupils out before it's cut to a page. The same
 * arithmetic: YYYYMMDD as a number compares like a date. Only a school has pupils.
 */
function notCurrentPupil(tenant: Pick<TenantRow, "type" | "timezone">, now: Date): SQL | undefined {
  if (tenant.type !== "SCHOOL") return undefined;
  const t = wallPartsInZone(now, tenant.timezone);
  const today = t.year * 10000 + t.month * 100 + t.day;
  const dob = memberships.dateOfBirth;
  return sql`not (
    ${memberships.batchYear} > ${t.year}
    or (${dob} is null and ${memberships.batchYear} = ${t.year})
    or (${dob} is not null and (extract(year from ${dob})::int + 18) * 10000 + extract(month from ${dob})::int * 100 + extract(day from ${dob})::int > ${today})
  )`;
}

/**
 * Whether the inviter already chats with this member: they're both in some group, or have a direct chat that was accepted.
 * Those are people the inviter can already see, in a member list or their inbox.
 */
function sharesAChatWith(inviterMembershipId: string): SQL {
  return sql`exists (
    select 1 from ${chatParticipants} mine
    join ${chatParticipants} theirs on theirs.conversation_id = mine.conversation_id
    join ${chatConversations} c on c.id = mine.conversation_id
    where mine.membership_id = ${inviterMembershipId} and mine.state = 'ACTIVE'
      and theirs.membership_id = ${memberships.id} and theirs.state = 'ACTIVE'
      and (c.kind = 'GROUP' or c.direct_state = 'ACCEPTED')
  )`;
}

/**
 * Members this one could invite: approved, not a current pupil, not in the group or invited to it already, and not someone
 * they blocked. Never filtered by who blocked them, because leaving those out would tell them. With `onlyKnown`, for an
 * institution that has switched its directory off, only people the inviter already chats with, so the search can't stand in
 * for the directory it switched off.
 */
export async function listInviteCandidates(
  db: DbClient,
  tenant: Pick<TenantRow, "id" | "type" | "timezone">,
  conversationId: string,
  inviterMembershipId: string,
  q: { q?: string; limit: number; now: Date; inviteSince: Date; onlyKnown: boolean },
): Promise<ChatSender[]> {
  const taken = db
    .select({ id: chatParticipants.membershipId })
    .from(chatParticipants)
    .where(
      and(
        eq(chatParticipants.conversationId, conversationId),
        eq(chatParticipants.membershipId, memberships.id),
        or(eq(chatParticipants.state, "ACTIVE"), and(eq(chatParticipants.state, "INVITED"), gt(chatParticipants.invitedAt, q.inviteSince))),
      ),
    );
  const blocked = db
    .select({ id: chatBlocks.blockedMembershipId })
    .from(chatBlocks)
    .where(and(eq(chatBlocks.blockerMembershipId, inviterMembershipId), eq(chatBlocks.blockedMembershipId, memberships.id)));
  return db
    .select(senderColumns)
    .from(memberships)
    .where(
      and(
        eq(memberships.tenantId, tenant.id),
        eq(memberships.status, "APPROVED"),
        ne(memberships.id, inviterMembershipId),
        notExists(taken),
        notExists(blocked),
        notCurrentPupil(tenant, q.now),
        q.onlyKnown ? sharesAChatWith(inviterMembershipId) : undefined,
        q.q ? ilike(memberships.fullName, `%${escapeLike(q.q)}%`) : undefined,
      ),
    )
    .orderBy(asc(memberships.fullName), asc(memberships.id))
    .limit(q.limit);
}

/** Of these members, those the inviter has blocked. */
export async function findBlockedAmong(db: DbClient, blockerMembershipId: string, membershipIds: string[]): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ id: chatBlocks.blockedMembershipId })
    .from(chatBlocks)
    .where(and(eq(chatBlocks.blockerMembershipId, blockerMembershipId), inArray(chatBlocks.blockedMembershipId, membershipIds)));
  return rows.map((r) => r.id);
}

// --- The invitation ledger ---

/** Records that a member turned down someone's invitation or message request, or renews it. */
export async function recordInviteDecline(db: DbClient, values: { tenantId: string; declinerMembershipId: string; inviterMembershipId: string }): Promise<void> {
  const declinedAt = new Date();
  await db
    .insert(chatInviteDeclines)
    .values({ ...values, declinedAt })
    .onConflictDoUpdate({ target: [chatInviteDeclines.declinerMembershipId, chatInviteDeclines.inviterMembershipId], set: { declinedAt } });
}

/** Of these members, those who have declined this inviter since `since`. */
export async function findDeclinersAmong(db: DbClient, inviterMembershipId: string, membershipIds: string[], since: Date): Promise<string[]> {
  if (membershipIds.length === 0) return [];
  const rows = await db
    .select({ id: chatInviteDeclines.declinerMembershipId })
    .from(chatInviteDeclines)
    .where(and(eq(chatInviteDeclines.inviterMembershipId, inviterMembershipId), inArray(chatInviteDeclines.declinerMembershipId, membershipIds), gt(chatInviteDeclines.declinedAt, since)));
  return rows.map((r) => r.id);
}

/**
 * Hides every invitation these members sent that's still waiting, for an account being deleted. A row can't simply go,
 * because a member re-invited after leaving or being removed keeps that history in it, so it lapses like any other.
 */
export async function suppressInvitesBy(db: DbClient, inviterMembershipIds: string[]): Promise<Array<{ tenantId: string; conversationId: string; membershipId: string }>> {
  if (inviterMembershipIds.length === 0) return [];
  return db
    .update(chatParticipants)
    .set({ inviteSuppressed: true })
    .where(and(inArray(chatParticipants.invitedByMembershipId, inviterMembershipIds), eq(chatParticipants.state, "INVITED"), eq(chatParticipants.inviteSuppressed, false)))
    .returning({ tenantId: chatParticipants.tenantId, conversationId: chatParticipants.conversationId, membershipId: chatParticipants.membershipId });
}

/**
 * Hides every invitation waiting for `inviteeMembershipId` from `inviterMembershipId`: after a block or a decline, either
 * way round. To the inviter they look the same as before. Returns the groups whose invitation it hid, which the invitee's
 * own devices should hear about.
 */
export async function suppressInvitesFrom(db: DbClient, inviteeMembershipId: string, inviterMembershipId: string): Promise<string[]> {
  const rows = await db
    .update(chatParticipants)
    .set({ inviteSuppressed: true })
    .where(
      and(
        eq(chatParticipants.membershipId, inviteeMembershipId),
        eq(chatParticipants.invitedByMembershipId, inviterMembershipId),
        eq(chatParticipants.state, "INVITED"),
        eq(chatParticipants.inviteSuppressed, false),
      ),
    )
    .returning({ conversationId: chatParticipants.conversationId });
  return rows.map((r) => r.conversationId);
}

/** Groups these two members are both in now, for telling one of them that how the other shows there changed. */
export async function listSharedGroupIds(db: DbClient, membershipId: string, otherMembershipId: string): Promise<string[]> {
  const theirs = alias(chatParticipants, "theirs");
  const rows = await db
    .select({ id: chatParticipants.conversationId })
    .from(chatParticipants)
    .innerJoin(theirs, and(eq(theirs.conversationId, chatParticipants.conversationId), eq(theirs.membershipId, otherMembershipId), eq(theirs.state, "ACTIVE")))
    .innerJoin(chatGroups, eq(chatGroups.conversationId, chatParticipants.conversationId))
    .where(and(eq(chatParticipants.membershipId, membershipId), eq(chatParticipants.state, "ACTIVE")));
  return rows.map((r) => r.id);
}

// --- Demo data ---

/**
 * Writes a whole group with real `seq` values, for the seed, which has no chat API or realtime to go through. Approved and
 * live. `members` join in order, the first owning it; `invited` are waiting for an answer from the owner.
 */
export async function seedGroup(
  tx: Tx,
  input: {
    tenantId: string;
    name: string;
    description: string | null;
    visibility: ChatGroupVisibility;
    members: Array<{ id: string; joinedAt: Date }>;
    messages: Array<{ senderId: string; body: string; at: Date }>;
    invited?: Array<{ id: string; at: Date }>;
  },
): Promise<string> {
  const { tenantId, name, description, visibility, members, messages, invited = [] } = input;
  const owner = members[0]!;
  const last = messages[messages.length - 1]?.at ?? owner.joinedAt;
  const [conversation] = await tx
    .insert(chatConversations)
    .values({ tenantId, kind: "GROUP", origin: "GROUP", lastSeq: messages.length, lastMessageAt: last, createdAt: owner.joinedAt, updatedAt: last })
    .returning({ id: chatConversations.id });
  const id = conversation!.id;
  await tx.insert(chatGroups).values({
    conversationId: id,
    tenantId,
    name,
    description,
    approvedName: name,
    approvedDescription: description,
    visibility,
    ownerMembershipId: owner.id,
    memberCount: members.length,
    moderationStatus: "APPROVED",
    moderatedAt: owner.joinedAt,
    approvedAt: owner.joinedAt,
    createdAt: owner.joinedAt,
    updatedAt: last,
  });
  if (messages.length > 0) {
    await tx.insert(chatMessages).values(messages.map((m, i) => ({ tenantId, conversationId: id, seq: i + 1, senderMembershipId: m.senderId, kind: "TEXT" as const, body: m.body, createdAt: m.at })));
  }
  // As joining does: an open group's history is everyone's, and an invite-only group's starts for each member when they join.
  const joinedSeqOf = (joinedAt: Date) => (visibility === "OPEN" ? 0 : messages.filter((m) => m.at < joinedAt).length);
  await tx.insert(chatParticipants).values([
    ...members.map((m, i) => ({
      conversationId: id,
      membershipId: m.id,
      tenantId,
      state: "ACTIVE" as const,
      role: i === 0 ? ("OWNER" as const) : ("MEMBER" as const),
      joinedSeq: joinedSeqOf(m.joinedAt),
      lastReadSeq: messages.length,
      joinedAt: m.joinedAt,
      createdAt: m.joinedAt,
    })),
    ...invited.map((m) => ({ conversationId: id, membershipId: m.id, tenantId, state: "INVITED" as const, invitedByMembershipId: owner.id, invitedAt: m.at, createdAt: m.at })),
  ]);
  return id;
}
