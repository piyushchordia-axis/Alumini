import {
  CHAT_GROUP_MAX_MEMBERS,
  CHAT_GROUP_MAX_OWNED,
  CHAT_GROUP_MAX_PENDING_INVITES,
  CHAT_INVITE_DECLINE_DAYS,
  enabledGroupVisibilities,
  type ChatGroupCandidatesQuery,
  type ChatGroupDto,
  type ChatGroupEvent,
  type ChatGroupInviteDto,
  type ChatGroupInviteResultDto,
  type ChatGroupMemberDto,
  type ChatGroupsQuery,
  type ChatGroupVisibility,
  type ChatMemberDto,
  type CursorPage,
  type CursorQuery,
} from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toChatMemberDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { runInTransaction } from "../../lib/transaction";
import { consumeRateLimit } from "../../middleware/rateLimit";
import { findBlockersAmong, findParticipant, limitLockWait, lockPair, updateParticipant, type ChatSender, type ConversationRow, type ParticipantRow } from "../../repositories/chat.repo";
import {
  adjustMemberCount,
  countOwnedGroups,
  countPendingInvites,
  findBlockedAmong,
  findDeclinersAmong,
  findGroupView,
  findParticipantsAmong,
  findSuccessor,
  insertGroup,
  listGroupMembers as listGroupMemberRows,
  listGroups as listGroupRows,
  listInviteCandidates as listInviteCandidateRows,
  listInvites,
  listOwnedGroupIds,
  listWaitingInviteeIds,
  lockGroup,
  lockGroupRow,
  recordInviteDecline,
  suppressInvitesFrom,
  updateGroup as updateGroupRow,
  upsertParticipant,
  type ChatGroupRow,
  type GroupViewRow,
} from "../../repositories/chatGroups.repo";
import { findMembershipsByIds, lockMembership } from "../../repositories/memberships.repo";
import type { TenantContext } from "../../types/request";
import { afterContentWrite, initialStatusFor, statusAfterEdit, type ContentActor } from "../content.common";
import { emitBadges } from "./chat.service";
import {
  assertGroupEnabled,
  blockedByYou,
  canSeeGroup,
  chatTenantById,
  chatTenantOf,
  contactUnavailable,
  freshChatTenant,
  groupSendable,
  inviteCutoff,
  inviteOutstanding,
  inviteVisible,
  isGroupLive,
  isReachable,
  mayInvite,
  shownGroupText,
  wasRemoved,
  type ChatTenant,
} from "./common";
import { appendMessage, publishChanged, publishChangedTo, queueGroupInvitePush } from "./fanout";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Invitations a member may send in a day, each person counting once. */
const INVITE_LIMIT = { bucket: "chat-group-invite", limit: 200, windowSec: 24 * 60 * 60 };

const notFound = () => AppError.notFound("Group not found");
const archivedGroup = () => AppError.conflict("This group has been archived");
const groupFull = () => AppError.conflict(`This group is full: it can have up to ${CHAT_GROUP_MAX_MEMBERS} members`);

/** A group as `membershipId` sees it, flags and all. Only call it for someone canSeeGroup lets see it. */
export function toChatGroupDto({ group, participant, owner }: GroupViewRow, membershipId: string, now: Date): ChatGroupDto {
  const isOwner = group.ownerMembershipId === membershipId;
  const live = isGroupLive(group);
  const archived = !!group.archivedAt;
  const removed = !!participant && wasRemoved(participant);
  // An invitation its invitee can't see is no invitation, as far as they're concerned: someone removed is still removed.
  const myState = !participant ? null : participant.state === "INVITED" ? (inviteVisible(participant, now) ? "INVITED" : removed ? "REMOVED" : null) : participant.state;
  const active = myState === "ACTIVE";
  return {
    id: group.conversationId,
    ...shownGroupText(group, isOwner),
    visibility: group.visibility,
    memberCount: group.memberCount,
    owner: owner ? toChatMemberDto(owner) : null,
    archived,
    myState,
    isOwner,
    canSend: active && groupSendable(group),
    // A removed member comes back only through an invitation they can see.
    canJoin: group.visibility === "OPEN" && live && !archived && !active && (!removed || myState === "INVITED"),
    canInvite: active && mayInvite(group, isOwner),
    canEdit: isOwner && !archived && group.moderationStatus !== "REMOVED",
    canLeave: active,
    createdAt: group.createdAt.toISOString(),
    review: isOwner
      ? {
          name: group.name,
          description: group.description,
          moderationStatus: group.moderationStatus,
          moderationNote: group.moderationNote,
          moderatedAt: group.moderatedAt?.toISOString() ?? null,
          shownToMembers: live,
        }
      : null,
  };
}

/** The group, if this member may know it exists, and whether its kind is switched on. The same 404 whatever the reason. */
async function loadVisible(ctx: AppContext, tenant: ChatTenant, membershipId: string, id: string, now: Date): Promise<GroupViewRow> {
  const view = await findGroupView(ctx.db, tenant.id, id, membershipId);
  if (!view || !canSeeGroup(view.group, view.participant, membershipId, now)) throw notFound();
  assertGroupEnabled(tenant.features, view.group.visibility);
  return view;
}

/** Re-reads a group after a change, for the member who made it. */
async function viewFor(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ChatGroupDto> {
  const view = await findGroupView(ctx.db, tenantCtx.tenant.id, id, actor.membership.id);
  if (!view) throw notFound();
  return toChatGroupDto(view, actor.membership.id, new Date());
}

/**
 * A locked group with this member's own row, for anything that changes who's in it, checked the same way as a read. The
 * institution is read fresh, because its cached copy can be minutes old and these writes can't be undone by switching off.
 */
async function lockVisible(tx: Tx, tenantId: string, membershipId: string, id: string, now: Date): Promise<{ tenant: ChatTenant; conversation: ConversationRow; group: ChatGroupRow; participant: ParticipantRow | undefined }> {
  await limitLockWait(tx);
  const tenant = await freshChatTenant(tx, tenantId);
  const locked = await lockGroup(tx, tenantId, id);
  if (!locked) throw notFound();
  const participant = await findParticipant(tx, id, membershipId);
  if (!canSeeGroup(locked.group, participant, membershipId, now)) throw notFound();
  assertGroupEnabled(tenant.features, locked.group.visibility);
  return { tenant, ...locked, participant };
}

const SYSTEM_TEXT: Record<ChatGroupEvent, string> = {
  JOINED: "joined the group",
  LEFT: "left the group",
  REMOVED: "was removed from the group",
  OWNER_CHANGED: "is now the group's owner",
  ARCHIVED: "archived the group",
};

/**
 * A system line in the thread about one member, who is its sender. No push: these aren't worth waking a phone for. Its text
 * names nobody, so a client puts the sender's name in front, and a member who blocked them sees it redacted like anything
 * else they sent.
 */
async function systemLine(ctx: AppContext, tx: Tx, tenantSlug: string, conversation: ConversationRow, member: ChatSender | null, event: ChatGroupEvent): Promise<void> {
  // Only joining counts as having read it, since the joiner has just arrived. The others are written in a member's name
  // without their reading anything, so a new owner keeps what they haven't read.
  await appendMessage(ctx, tx, { tenantSlug, conversation, sender: member, kind: "SYSTEM", body: SYSTEM_TEXT[event], meta: { event }, noPush: true, advancesRead: event === "JOINED" });
}

/**
 * Tells everyone whose view of a group just changed, once `db`'s work commits: everyone in it (with `evenIfHidden`, those
 * moderation now hides it from too), the members in `alsoTell` whatever their place in it, such as one who just left, and
 * with `invitees` everyone with an invitation waiting, whose Invitations it may have changed. The hint carries nothing, so
 * telling someone whose view didn't change costs them one refetch. Those named, and invitees, get their badge as well.
 */
export async function announceGroupChange(ctx: AppContext, db: DbClient, tenant: ChatTenant, conversationId: string, opts: { evenIfHidden?: boolean; alsoTell?: string[]; invitees?: boolean } = {}): Promise<void> {
  const invitees = opts.invitees ? await listWaitingInviteeIds(db, conversationId, inviteCutoff(new Date())) : [];
  const also = [...new Set([...(opts.alsoTell ?? []), ...invitees])];
  await publishChanged(ctx, db, tenant.slug, conversationId, { evenIfHidden: opts.evenIfHidden, alsoMembershipIds: also });
  await emitBadges(ctx, db, tenant, also);
}

/** Makes a member ACTIVE under the group's lock: the cap, then their row, then the count, then the line saying so. */
async function admit(ctx: AppContext, tx: Tx, tenant: ChatTenant, conversation: ConversationRow, group: ChatGroupRow, member: ChatSender, now: Date): Promise<void> {
  if (group.memberCount >= CHAT_GROUP_MAX_MEMBERS) throw groupFull();
  // An open group's history is open to anyone who joins. An invite-only group's starts for each member when they join.
  const joinedSeq = group.visibility === "OPEN" ? 0 : conversation.lastSeq;
  await upsertParticipant(
    tx,
    { conversationId: group.conversationId, membershipId: member.id, tenantId: tenant.id },
    { state: "ACTIVE", role: "MEMBER", joinedSeq, lastReadSeq: conversation.lastSeq, joinedAt: now, inviteSuppressed: false, mutedUntil: null, frozenSortAt: null, removedAt: null },
  );
  await adjustMemberCount(tx, group.conversationId, 1);
  await systemLine(ctx, tx, tenant.slug, conversation, member, "JOINED");
  // The count changed for everyone, and the newcomer's inbox, Groups lists and invitations all did.
  await announceGroupChange(ctx, tx, tenant, group.conversationId, { alsoTell: [member.id] });
}

/**
 * Hands a group on from its owner, who is going, to whoever has been in it longest and could run it, with a line saying so.
 * Only what members could see goes with it: an edit still waiting for review is dropped, putting the approved name and
 * description back, and so is the admin's note to the old owner, so nobody inherits words they didn't write or a note that
 * wasn't about them. A group members can't see at all (never approved, rejected or removed) isn't handed on, because that
 * would show it to someone it's hidden from: like a group nobody is left to take, it's archived, with no owner. Says whether
 * that archived it.
 */
async function passOwnership(ctx: AppContext, tx: Tx, tenant: ChatTenant, conversation: ConversationRow, group: ChatGroupRow, fromMembershipId: string, now: Date): Promise<{ archived: boolean }> {
  const id = group.conversationId;
  const successor = isGroupLive(group) ? await findSuccessor(tx, tenant, id, fromMembershipId, now) : undefined;
  if (!successor) {
    await updateGroupRow(tx, id, { ownerMembershipId: null, archivedAt: group.archivedAt ?? now });
    return { archived: !group.archivedAt };
  }
  // Demoted first: a group has one active owner, and the index holding it to that checks each statement.
  await updateParticipant(tx, id, fromMembershipId, { role: "MEMBER" });
  await updateParticipant(tx, id, successor.id, { role: "OWNER" });
  const editWaiting = group.moderationStatus === "PENDING";
  await updateGroupRow(tx, id, {
    ownerMembershipId: successor.id,
    moderationNote: null,
    ...(editWaiting ? { name: group.approvedName ?? group.name, description: group.approvedDescription, moderationStatus: "APPROVED" as const } : {}),
  });
  await systemLine(ctx, tx, tenant.slug, conversation, successor, "OWNER_CHANGED");
  return { archived: false };
}

/**
 * Takes a member out of a group under its lock. If they owned it, it passes to whoever has been in longest, or with nobody
 * to take it it's archived, so a group is never left without someone to run it. `anonymous` writes their line with no
 * sender, for an account being deleted, which reads "Deleted member" from then on anyway. Says whether that archived it.
 * Telling anyone is the caller's.
 */
async function depart(ctx: AppContext, tx: Tx, tenant: ChatTenant, conversation: ConversationRow, group: ChatGroupRow, member: ChatSender, state: "LEFT" | "REMOVED", now: Date, opts: { anonymous?: boolean } = {}): Promise<{ archived: boolean }> {
  // A removal outlasts any invitation written over it, and only one they could see lets them back (see wasRemoved).
  await updateParticipant(tx, group.conversationId, member.id, { state, role: "MEMBER", removedAt: state === "REMOVED" ? now : null });
  await adjustMemberCount(tx, group.conversationId, -1);
  await systemLine(ctx, tx, tenant.slug, conversation, opts.anonymous ? null : member, state === "LEFT" ? "LEFT" : "REMOVED");
  if (group.ownerMembershipId !== member.id) return { archived: false };
  return passOwnership(ctx, tx, tenant, conversation, group, member.id, now);
}

/** A member leaving or removed: everyone still in it, the member who went on all their devices, and invitees if it closed. */
async function announceDeparture(ctx: AppContext, tx: Tx, tenant: ChatTenant, conversationId: string, membershipId: string, archived: boolean): Promise<void> {
  await announceGroupChange(ctx, tx, tenant, conversationId, { alsoTell: [membershipId], invitees: archived });
}

// --- Reading ---

export async function listGroups(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: ChatGroupsQuery): Promise<CursorPage<ChatGroupDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const page = await listGroupRows(ctx.db, tenant.id, me, { ...query, visibilities: enabledGroupVisibilities(tenant.features) });
  const now = new Date();
  return { data: page.data.map((r) => toChatGroupDto(r, me, now)), nextCursor: page.nextCursor };
}

export async function getGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ChatGroupDto> {
  const now = new Date();
  return toChatGroupDto(await loadVisible(ctx, chatTenantOf(tenantCtx), actor.membership.id, id, now), actor.membership.id, now);
}

/** Invitations the member can see and answer. One that was suppressed or has lapsed isn't here. */
export async function listMyInvites(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: CursorQuery): Promise<CursorPage<ChatGroupInviteDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const now = new Date();
  const page = await listInvites(ctx.db, tenant.id, me, { ...query, visibilities: enabledGroupVisibilities(tenant.features), since: inviteCutoff(now) });
  return {
    data: page.data.map((r) => ({ group: toChatGroupDto(r, me, now), invitedBy: r.inviter ? toChatMemberDto(r.inviter) : null, invitedAt: r.participant.invitedAt!.toISOString() })),
    nextCursor: page.nextCursor,
  };
}

/** Its active members, longest-standing first. Anyone who may see the group may see who's in it. Invitations never show. */
export async function listGroupMembers(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, query: CursorQuery): Promise<CursorPage<ChatGroupMemberDto>> {
  const me = actor.membership.id;
  await loadVisible(ctx, chatTenantOf(tenantCtx), me, id, new Date());
  const page = await listGroupMemberRows(ctx.db, id, me, query);
  return {
    data: page.data.map((r) => ({ member: toChatMemberDto(r.member), role: r.participant.role, isMe: r.participant.membershipId === me, blockedByMe: !!r.blockedByMe })),
    nextCursor: page.nextCursor,
  };
}

/** Members this one could invite, for a search box. */
export async function listInviteCandidates(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, query: ChatGroupCandidatesQuery): Promise<ChatMemberDto[]> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const now = new Date();
  const { group, participant } = await loadVisible(ctx, tenant, me, id, now);
  if (participant?.state !== "ACTIVE" || !mayInvite(group, group.ownerMembershipId === me)) throw AppError.forbidden("You can't invite anyone to this group");
  // With the directory switched off, this search mustn't become a way round it: only people they already chat with.
  const { features } = tenant; // resolved by chatTenantOf
  const rows = await listInviteCandidateRows(ctx.db, tenant, id, me, { ...query, now, inviteSince: inviteCutoff(now), onlyKnown: !features.directory });
  return rows.map(toChatMemberDto);
}

// --- Owning ---

/** A new group, which follows the institution's content moderation: under admin approval only its creator sees it until then. */
export async function createGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: { name: string; description: string | null; visibility: ChatGroupVisibility }): Promise<ChatGroupDto> {
  const tenantId = tenantCtx.tenant.id;
  const me = actor.membership.id;
  const status = initialStatusFor(tenantCtx, actor, "GROUP");
  const group = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const tenant = await freshChatTenant(tx, tenantId);
    assertGroupEnabled(tenant.features, input.visibility);
    // Held until the insert, or two creates could both count nineteen.
    await lockMembership(tx, tenantId, me);
    if ((await countOwnedGroups(tx, tenantId, me)) >= CHAT_GROUP_MAX_OWNED) throw AppError.conflict(`You can own up to ${CHAT_GROUP_MAX_OWNED} groups. Archive one to start another.`);
    return insertGroup(tx, { tenantId, ownerMembershipId: me, name: input.name, description: input.description, visibility: input.visibility, moderationStatus: status, now: new Date() });
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "GROUP", id: group.conversationId, title: group.name, status, action: "create" });
  return viewFor(ctx, tenantCtx, actor, group.conversationId);
}

/**
 * The owner edits the name and description, which follow the moderation setting like any content. An edit to an approved
 * group under review leaves members seeing the approved text and the room running, and pauses invitations until an admin
 * has looked. Visibility never changes.
 */
export async function editGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: { name?: string; description?: string | null }): Promise<ChatGroupDto> {
  const me = actor.membership.id;
  const now = new Date();
  const result = await runInTransaction(ctx, async (tx) => {
    const { tenant, group } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (group.ownerMembershipId !== me) throw AppError.forbidden("Only the group's owner can change it");
    if (group.archivedAt) throw archivedGroup();
    const name = input.name ?? group.name;
    const description = input.description === undefined ? group.description : input.description;
    if (name === group.name && description === group.description) return null;
    const status = statusAfterEdit(tenantCtx, actor, group.moderationStatus);
    const approved = status === "APPROVED";
    await updateGroupRow(tx, id, {
      name,
      description,
      moderationStatus: status,
      moderationNote: status === group.moderationStatus ? group.moderationNote : null,
      ...(approved ? { approvedName: name, approvedDescription: description, approvedAt: now, moderatedAt: now } : {}),
    });
    // Published at once, members and invitees see the new name. Under review, only the owner's own view changed.
    if (approved) await announceGroupChange(ctx, tx, tenant, id, { invitees: true });
    else await publishChanged(ctx, tx, tenant.slug, id, { onlyMembershipId: me });
    return { name, status };
  });
  if (result) await afterContentWrite(ctx, tenantCtx, actor, { contentType: "GROUP", id, title: result.name, status: result.status, action: "update" });
  return viewFor(ctx, tenantCtx, actor, id);
}

/** Read-only from now on for its members, and gone from Discover. There's no way back. */
export async function archiveGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ChatGroupDto> {
  const me = actor.membership.id;
  const now = new Date();
  const status = await runInTransaction(ctx, async (tx) => {
    const { tenant, conversation, group } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (group.ownerMembershipId !== me) throw AppError.forbidden("Only the group's owner can archive it");
    if (group.archivedAt) return null;
    await updateGroupRow(tx, id, { archivedAt: now });
    await systemLine(ctx, tx, tenant.slug, conversation, actor.membership, "ARCHIVED");
    // Read-only for its members, and its waiting invitations can't be accepted any more.
    await announceGroupChange(ctx, tx, tenant, id, { invitees: true });
    return group.moderationStatus;
  });
  if (status) await afterContentWrite(ctx, tenantCtx, actor, { contentType: "GROUP", id, title: "", status, action: "archive" });
  return viewFor(ctx, tenantCtx, actor, id);
}

/** Takes a member out. Owner only, and only an active member: they need a new invitation to come back. */
export async function removeMember(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, membershipId: string): Promise<void> {
  const me = actor.membership.id;
  const now = new Date();
  await runInTransaction(ctx, async (tx) => {
    const { tenant, conversation, group } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (group.ownerMembershipId !== me) throw AppError.forbidden("Only the group's owner can remove members");
    if (membershipId === me) throw AppError.badRequest("Leave the group instead");
    if (group.archivedAt) throw archivedGroup();
    const target = await findParticipant(tx, id, membershipId);
    const [member] = target?.state === "ACTIVE" ? await findMembershipsByIds(tx, tenant.id, [membershipId]) : [];
    if (!member) throw AppError.notFound("Member not found");
    const { archived } = await depart(ctx, tx, tenant, conversation, group, member, "REMOVED", now);
    await announceDeparture(ctx, tx, tenant, id, member.id, archived);
  });
}

// --- Joining and leaving ---

/** An open group, straight in with its whole history. Someone with an invitation joins by accepting it, or by this. */
export async function joinGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ChatGroupDto> {
  const me = actor.membership.id;
  const now = new Date();
  await runInTransaction(ctx, async (tx) => {
    const { tenant, conversation, group, participant } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (participant?.state === "ACTIVE") return;
    if (group.visibility !== "OPEN") throw AppError.conflict("This group is invite-only. Accept your invitation to join it.");
    if (!groupSendable(group)) throw AppError.conflict("This group isn't taking new members");
    // An invitation they never saw, declined or let lapse doesn't count: that would let them past a removal unasked.
    if (participant && wasRemoved(participant) && !inviteVisible(participant, now)) throw AppError.conflict("You were removed from this group. You need an invitation to join it again.");
    await admit(ctx, tx, tenant, conversation, group, actor.membership, now);
  });
  return viewFor(ctx, tenantCtx, actor, id);
}

/** Leaves, after which an invite-only group is gone from view. An owner hands the group on as they go. */
export async function leaveGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const me = actor.membership.id;
  const now = new Date();
  await runInTransaction(ctx, async (tx) => {
    const { tenant, conversation, group, participant } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (participant?.state !== "ACTIVE") throw AppError.conflict("You aren't in this group");
    const { archived } = await depart(ctx, tx, tenant, conversation, group, actor.membership, "LEFT", now);
    await announceDeparture(ctx, tx, tenant, id, me, archived);
  });
}

// --- Invitations ---

/**
 * Invites members. The answer is the same whether or not each invitation reaches its invitee: one to someone who blocked the
 * inviter, or declined them lately, is stored as suppressed and never shown to them, and nothing the inviter can see tells
 * the two apart. Inviting someone the inviter blocked is refused, because that's the inviter's own doing.
 */
export async function inviteToGroup(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, membershipIds: string[]): Promise<ChatGroupInviteResultDto> {
  const me = actor.membership.id;
  const now = new Date();
  return runInTransaction(ctx, async (tx) => {
    const { tenant, group, participant } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (participant?.state !== "ACTIVE" || !mayInvite(group, group.ownerMembershipId === me)) throw AppError.forbidden("You can't invite anyone to this group");
    if (membershipIds.includes(me)) throw AppError.badRequest("You're already in this group");

    const targets = await findMembershipsByIds(tx, tenant.id, membershipIds);
    if (targets.length !== membershipIds.length) throw AppError.notFound("Member not found");
    if (targets.some((t) => !isReachable(tenant, t))) throw contactUnavailable();
    // Each pair under the lock a block takes, one at a time in a fixed order: a block landing now is either seen below or
    // waits for this to commit and then hides what it wrote, so an invitation can't slip past a block made meanwhile.
    for (const target of [...membershipIds].sort()) await lockPair(tx, tenant.id, me, target);
    if ((await findBlockedAmong(tx, me, membershipIds)).length > 0) throw blockedByYou();

    const existing = await findParticipantsAmong(tx, id, membershipIds);
    const fresh = membershipIds.filter((m) => {
      const p = existing.get(m);
      return p?.state !== "ACTIVE" && !(p && inviteOutstanding(p, now));
    });
    if ((await countPendingInvites(tx, id, inviteCutoff(now))) + fresh.length > CHAT_GROUP_MAX_PENDING_INVITES) {
      throw AppError.conflict(`A group can have up to ${CHAT_GROUP_MAX_PENDING_INVITES} invitations waiting. Try again once some have been answered.`);
    }
    // Counted per person newly invited, and only once nothing is left to refuse the call, so a refused call or inviting
    // someone again costs nothing. The same count whether or not each invitation is shown.
    if (fresh.length > 0) await consumeRateLimit(ctx, INVITE_LIMIT, me, fresh.length);
    const suppressed = new Set([...(await findBlockersAmong(tx, me, membershipIds)), ...(await findDeclinersAmong(tx, me, membershipIds, new Date(now.getTime() - CHAT_INVITE_DECLINE_DAYS * DAY_MS)))]);

    let invited = 0;
    // Every invitation this call wrote, and of those the ones put in front of their invitees, who are the only ones to hear of it.
    const written: string[] = [];
    const shown = new Set<string>();
    for (const membershipId of membershipIds) {
      const p = existing.get(membershipId);
      if (p?.state === "ACTIVE") continue;
      invited += 1;
      const outstanding = !!p && inviteOutstanding(p, now);
      // An invitation they can see stands as it is, whoever sent it.
      if (p && outstanding && !p.inviteSuppressed) continue;
      // Otherwise this one is written: a new invitation, or this inviter's in place of one that was held back. Whether it
      // is held back too depends only on its invitee and this inviter, never on anything the inviter can see.
      const quiet = suppressed.has(membershipId);
      const key = { conversationId: id, membershipId, tenantId: tenant.id };
      const invitation = { invitedByMembershipId: me, invitedAt: now, inviteSuppressed: quiet };
      await upsertParticipant(tx, key, outstanding ? invitation : { state: "INVITED", role: "MEMBER", ...invitation });
      written.push(membershipId);
      if (!quiet) shown.add(membershipId);
    }
    // The same work for every invitation written, shown or not, with only the shown ones told, so not even how long this
    // takes can tell the inviter which were held back. The push job looks again and skips those.
    await publishChangedTo(ctx, tx, tenant.slug, id, written, { onlyTo: shown });
    await emitBadges(ctx, tx, tenant, written, { onlyTo: shown });
    await queueGroupInvitePush(ctx, tx, { tenantId: tenant.id, conversationId: id, inviteeMembershipIds: written });
    return { invited };
  });
}

/** Accepts an invitation the member can see: in, with history from now on for an invite-only group. */
export async function acceptInvite(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<ChatGroupDto> {
  const me = actor.membership.id;
  const now = new Date();
  await runInTransaction(ctx, async (tx) => {
    const { tenant, conversation, group, participant } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (participant?.state === "ACTIVE") return;
    if (!participant || !inviteVisible(participant, now)) throw AppError.conflict("This invitation is no longer open");
    if (!groupSendable(group)) throw AppError.conflict("This group isn't taking new members");
    await admit(ctx, tx, tenant, conversation, group, actor.membership, now);
  });
  return viewFor(ctx, tenantCtx, actor, id);
}

/**
 * Declines an invitation. The row stays as it was to the inviter, and the decline goes in the ledger, which keeps that
 * inviter's invitations away from this member for a while, starting with any others of theirs already waiting. Nobody is
 * told.
 */
export async function declineInvite(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const me = actor.membership.id;
  const now = new Date();
  await runInTransaction(ctx, async (tx) => {
    const { tenant, participant } = await lockVisible(tx, tenantCtx.tenant.id, me, id, now);
    if (!participant || !inviteVisible(participant, now)) throw AppError.conflict("This invitation is no longer open");
    await updateParticipant(tx, id, me, { inviteSuppressed: true });
    const inviter = participant.invitedByMembershipId;
    const alsoHidden = inviter ? await suppressInvitesFrom(tx, me, inviter) : [];
    if (inviter) await recordInviteDecline(tx, { tenantId: tenant.id, declinerMembershipId: me, inviterMembershipId: inviter });
    for (const groupId of new Set([id, ...alsoHidden])) await publishChangedTo(ctx, tx, tenant.slug, groupId, [me]);
    await emitBadges(ctx, tx, tenant, [me]);
  });
}

// --- When a member can't stay owner ---

/**
 * When an admin suspends a member, whoever has been in each of their live groups longest takes it over, because a suspended
 * owner can't run it, and one with nobody else to take it is archived, as when an owner leaves: otherwise it would carry on
 * in Discover with nobody able to run it. They stay a member, and what they wrote stays. A group members can't see anyway
 * (waiting for its first approval, rejected or removed) stays theirs as it is, for when the suspension is lifted. Runs in
 * the suspension's transaction.
 */
export async function handOverGroupsOf(ctx: AppContext, tx: Tx, tenantId: string, membershipId: string): Promise<void> {
  const ids = await listOwnedGroupIds(tx, tenantId, membershipId);
  if (ids.length === 0) return;
  const tenant = await chatTenantById(tx, tenantId);
  const now = new Date();
  for (const id of ids) {
    const locked = await lockGroup(tx, tenantId, id);
    if (!locked || locked.group.ownerMembershipId !== membershipId || !isGroupLive(locked.group)) continue;
    const { archived } = await passOwnership(ctx, tx, tenant, locked.conversation, locked.group, membershipId, now);
    await announceGroupChange(ctx, tx, tenant, id, { invitees: archived });
  }
}

/**
 * Takes a member whose account is being deleted out of a group whose conversation the caller holds: the same count, hand-over
 * and archive as leaving, with a line that names nobody, because they'll read as "Deleted member" from then on. What they
 * wrote stays.
 */
export async function departForDeletion(ctx: AppContext, tx: Tx, tenant: ChatTenant, conversation: ConversationRow, membershipId: string): Promise<void> {
  const group = await lockGroupRow(tx, conversation.id, "update");
  const participant = await findParticipant(tx, conversation.id, membershipId);
  if (!group || participant?.state !== "ACTIVE") return;
  const [member] = await findMembershipsByIds(tx, tenant.id, [membershipId]);
  if (!member) return;
  const { archived } = await depart(ctx, tx, tenant, conversation, group, member, "LEFT", new Date(), { anonymous: true });
  await announceGroupChange(ctx, tx, tenant, conversation.id, { invitees: archived });
}
