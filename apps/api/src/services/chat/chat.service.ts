import type { ChatBadgeDto, ChatConversationDto, ChatConversationsQuery, ChatDirectLookupDto, ChatDirectResultDto, ChatMessageDto, ChatMessagesQuery, CursorPage } from "@illuminize/shared";
import { enabledGroupVisibilities, isCurrentPupil } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toChatLastMessageDto, toChatMemberDto, toChatMessageDto } from "../../dto/chat.dto";
import { AppError } from "../../lib/errors";
import { afterCommit, runInTransaction } from "../../lib/transaction";
import { consumeRateLimit } from "../../middleware/rateLimit";
import { rooms } from "../../realtime/rooms";
import { keys } from "../../redis/keys";
import {
  advanceRead,
  blocksBetween,
  changeDirectState,
  countGroupUnread,
  findBlockedByMember,
  findDirectThreadInInbox,
  findLastVisibleMessages,
  findMessageByClientKey,
  findParticipant,
  findThread,
  getOrCreateDirectConversation,
  limitLockWait,
  listBadgeThreads,
  lockPair,
  listThreadMessages,
  listThreads,
  lockConversation,
  updateConversation,
  updateParticipant,
  type ChatGroupRow,
  type ChatMessageRow,
  type ConversationRow,
  type MessageWithSender,
  type ParticipantRow,
  type ThreadRow,
} from "../../repositories/chat.repo";
import { countInvites, lockGroupRow, recordInviteDecline, suppressInvitesFrom } from "../../repositories/chatGroups.repo";
import { findMembershipById } from "../../repositories/memberships.repo";
import type { MembershipRow, TenantContext, TenantRow } from "../../types/request";
import {
  asSeenBy,
  assertKindEnabled,
  blockedByYou,
  chatTenantOf,
  contactUnavailable,
  enabledKinds,
  freshChatTenant,
  groupSendable,
  inviteCutoff,
  isGroupLive,
  isReachable,
  peerIdOf,
  planSend,
  requestPending,
  threadKindOf,
  threadView,
  toConversationGroupDto,
  unreadOf,
  type ChatTenant,
  type ChatThreadKind,
} from "./common";
import { appendMessage, chatRecipientOf, chatRecipients, GROUP_PUSH_WINDOW, publishChanged, publishChangedTo, queuePushEvent } from "./fanout";

export interface ChatActor {
  userId: string;
  membership: MembershipRow;
}

/** New requests a member may send in a day. Counted before the block branch, so being blocked can't change when it runs out. */
const CHAT_REQUEST_LIMIT = { bucket: "chat-request", limit: 20, windowSec: 24 * 60 * 60 };

/** What one group takes, on top of each member's own limits, so however many members join in, a room can't be flooded. */
const GROUP_SEND_LIMIT = { bucket: "chat-send-group", limit: 120, windowSec: 60 };

interface SendInput {
  body: string;
  clientKey: string;
}

/**
 * Senders whose messages this member sees redacted: in a group, everyone they blocked. Never in a direct thread, where a
 * block withholds what comes after and leaves the history as it was.
 */
async function redactedSendersFor(db: DbClient, membershipId: string, inGroup: boolean): Promise<Set<string>> {
  return new Set(inGroup ? await findBlockedByMember(db, membershipId) : []);
}

const isRedacted = (message: Pick<ChatMessageRow, "senderMembershipId">, redacted: Set<string>) => !!message.senderMembershipId && redacted.has(message.senderMembershipId);

/** What a page of threads needs besides their rows: each one's newest message, and for groups the counts and who's redacted. */
interface ThreadExtras {
  last: Map<string, MessageWithSender>;
  groupUnread: Map<string, number>;
  redacted: Set<string>;
}

async function loadExtras(db: DbClient, membershipId: string, rows: ThreadRow[]): Promise<ThreadExtras> {
  const groupIds = rows.filter((r) => r.group).map((r) => r.conversation.id);
  return {
    last: await findLastVisibleMessages(db, membershipId, rows.map((r) => r.conversation.id)),
    groupUnread: await countGroupUnread(db, membershipId, groupIds),
    redacted: await redactedSendersFor(db, membershipId, groupIds.length > 0),
  };
}

/** A group thread as one of its members sees it. Always ACCEPTED: nobody asks to join a conversation they're already in. */
function toGroupConversationDto(row: ThreadRow & { group: ChatGroupRow }, extras: ThreadExtras): ChatConversationDto {
  const { conversation, participant, group } = row;
  const me = participant.membershipId;
  const last = extras.last.get(conversation.id);
  return {
    id: conversation.id,
    kind: conversation.kind,
    origin: conversation.origin,
    peer: null,
    group: toConversationGroupDto(group, me),
    state: "ACCEPTED",
    canSend: groupSendable(group),
    canRerequestAt: null,
    blockedByMe: false,
    unread: extras.groupUnread.get(conversation.id) ?? 0,
    lastReadSeq: Math.min(participant.lastReadSeq, last?.message.seq ?? 0),
    mutedUntil: participant.mutedUntil?.toISOString() ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    lastMessage: last ? toChatLastMessageDto(last.message, last.sender, me, { inGroup: true, redacted: isRedacted(last.message, extras.redacted) }) : null,
  };
}

function toConversationDto(tenant: Pick<TenantRow, "type" | "timezone">, row: ThreadRow, extras: ThreadExtras, now: Date): ChatConversationDto {
  const { conversation, participant, peer, group } = row;
  if (group) return toGroupConversationDto({ ...row, group }, extras);
  const last = extras.last.get(conversation.id);
  const view = threadView(tenant, row, now);
  // A request shows its text only when opened. A requester's own row stays the same whatever became of their request.
  const showsMessage = view.state === "ACCEPTED" || view.state === "CLOSED";
  return {
    id: conversation.id,
    kind: conversation.kind,
    peer: peer ? toChatMemberDto(peer) : null,
    group: null,
    ...view,
    // The stored position can pass what they can see, because unblocking marks withheld rows read, and that would count them.
    lastReadSeq: Math.min(view.lastReadSeq, last?.message.seq ?? 0),
    lastMessage: showsMessage && last ? toChatLastMessageDto(last.message, last.sender, participant.membershipId, { inGroup: false, redacted: false }) : null,
  };
}

async function loadThread(db: DbClient, tenantId: string, membershipId: string, conversationId: string): Promise<ThreadRow> {
  const thread = await findThread(db, tenantId, membershipId, conversationId);
  if (!thread) throw AppError.notFound("Conversation not found");
  return thread;
}

/** A thread this member is in, if its kind is switched on. Not being in it is a 404 whatever the switches say. */
async function loadEnabledThread(db: DbClient, tenant: ChatTenant, membershipId: string, conversationId: string): Promise<ThreadRow> {
  const thread = await loadThread(db, tenant.id, membershipId, conversationId);
  assertKindEnabled(tenant.features, threadKindOf(thread.conversation, thread.group));
  return thread;
}

export async function listConversations(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, query: ChatConversationsQuery): Promise<CursorPage<ChatConversationDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const kinds = enabledKinds(tenant.features);
  if (kinds.length === 0) throw AppError.forbidden("Messaging and groups are switched off for this institution", "FEATURE_DISABLED");
  const me = actor.membership.id;
  const page = await listThreads(ctx.db, tenant.id, me, { ...query, kinds });
  // Status is in the query. Whether someone became a pupil depends on the institution's date, so it's checked here, at the cost of a short page.
  const shown = query.inbox === "REQUESTS" ? page.data.filter((r) => isReachable(tenant, r.peer)) : page.data;
  const extras = await loadExtras(ctx.db, me, shown);
  const now = new Date();
  return { data: shown.map((r) => toConversationDto(tenant, r, extras, now)), nextCursor: page.nextCursor };
}

/**
 * The caller's thread with a member, if one of their inboxes lists it, by the same rules as the lists. So someone who asked
 * gets the same answer whatever became of their request, and someone who declined or was never shown one gets none, which
 * is what lets a profile offer to open the thread without saying anything the lists don't.
 */
export async function findDirectThread(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, membershipId: string): Promise<ChatDirectLookupDto> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const main = await findDirectThreadInInbox(ctx.db, tenant.id, me, membershipId, "MAIN");
  if (main) return { conversationId: main.conversation.id };
  const request = await findDirectThreadInInbox(ctx.db, tenant.id, me, membershipId, "REQUESTS");
  return { conversationId: request && isReachable(tenant, request.peer) ? request.conversation.id : null };
}

export async function getConversation(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, id: string): Promise<ChatConversationDto> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const thread = await loadEnabledThread(ctx.db, tenant, me, id);
  return toConversationDto(tenant, thread, await loadExtras(ctx.db, me, [thread]), new Date());
}

export async function listMessages(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, id: string, query: ChatMessagesQuery): Promise<CursorPage<ChatMessageDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const thread = await loadEnabledThread(ctx.db, tenant, me, id);
  const page = await listThreadMessages(ctx.db, thread.participant, query);
  const redacted = await redactedSendersFor(ctx.db, me, !!thread.group);
  return { data: page.data.map((r) => toChatMessageDto(r.message, r.sender, me, isRedacted(r.message, redacted))), nextCursor: page.nextCursor };
}

/**
 * The rules of sending in a thread the caller has locked. A retry comes first and returns the original, because the state
 * may have moved on since the send that lost its response.
 */
async function sendLocked(ctx: AppContext, tx: Tx, tenant: ChatTenant, actor: ChatActor, thread: { conversation: ConversationRow; participant: ParticipantRow; created: boolean }, input: SendInput): Promise<ChatMessageRow> {
  const { conversation, participant, created } = thread;
  const me = actor.membership.id;
  const original = await findMessageByClientKey(tx, conversation.id, me, input.clientKey);
  if (original) return original;

  const peerId = peerIdOf(conversation, me);
  const peer = peerId ? await findMembershipById(tx, tenant.id, peerId) : undefined;
  if (!peer || !isReachable(tenant, peer)) throw contactUnavailable();
  const blocks = await blocksBetween(tx, me, peer.id);
  if (blocks.byMe) throw blockedByYou();

  const now = new Date();
  const seen = asSeenBy(conversation, participant);
  const plan = created ? "REQUEST" : planSend(seen, me, now);
  if (plan === "WAIT") throw requestPending();
  if (plan === "REQUEST") await consumeRateLimit(ctx, CHAT_REQUEST_LIMIT, me);
  const requestCount = created || seen.requesterMembershipId !== me ? 1 : seen.requestCount + 1;
  // Someone who replied while blocked already believes it's accepted, so their first message to get through really accepts it.
  const settlesAcceptance = plan === "ACCEPT" || (plan === "SEND" && conversation.directState !== "ACCEPTED");

  if (blocks.byOther) {
    // Nothing the blocker reads may change, so only the sender's copy moves on. A thread this send created had nothing to read, and nothing froze its blocker's side yet.
    if (created) {
      await updateConversation(tx, conversation.id, { directState: "DECLINED" });
      await updateParticipant(tx, conversation.id, peer.id, { frozenSortAt: now });
    } else if (plan === "REQUEST") {
      await updateParticipant(tx, conversation.id, me, { withheldState: "PENDING", withheldRequestedAt: now, withheldRequestCount: requestCount });
    } else if (plan === "ACCEPT") {
      await updateParticipant(tx, conversation.id, me, { withheldState: "ACCEPTED" });
    }
  } else if (plan === "REQUEST") {
    // A new consent basis: whatever opened this thread before, it's a message request now, so ending some later mentorship can't close it.
    await changeDirectState(tx, conversation.id, { directState: "PENDING", origin: "MESSAGE_REQUEST", originId: null, requesterMembershipId: me, requestedAt: now, requestCount });
  } else if (settlesAcceptance) {
    await changeDirectState(tx, conversation.id, { directState: "ACCEPTED" });
  }

  const row = await appendMessage(ctx, tx, { tenantSlug: tenant.slug, conversation, sender: actor.membership, body: input.body, clientKey: input.clientKey, withheld: blocks.byOther, isRequest: plan === "REQUEST" });
  if (plan === "ACCEPT" || (settlesAcceptance && !blocks.byOther)) await publishChanged(ctx, tx, tenant.slug, conversation.id, { actorMembershipId: me });
  // Asking again uses up the one message, so the asker's other devices must stop offering more. Only theirs, and the same
  // whether or not they're blocked, so it tells them nothing they can't already see.
  else if (plan === "REQUEST" && !created) await publishChanged(ctx, tx, tenant.slug, conversation.id, { onlyMembershipId: me });
  return row;
}

/**
 * Sending in a group the caller has locked, with its row held. A retry comes first, as in a direct thread. Everyone who can
 * see the group gets it, but for a member who blocked the sender, who hears nothing of it live and reads it redacted.
 */
async function sendToGroupLocked(ctx: AppContext, tx: Tx, tenant: ChatTenant, actor: ChatActor, conversation: ConversationRow, group: ChatGroupRow, input: SendInput): Promise<ChatMessageRow> {
  const me = actor.membership.id;
  const original = await findMessageByClientKey(tx, conversation.id, me, input.clientKey);
  if (original) return original;
  if (!groupSendable(group)) throw AppError.conflict(group.archivedAt ? "This group has been archived, so it's read-only" : "This group can't take messages until an admin approves it");
  try {
    await consumeRateLimit(ctx, GROUP_SEND_LIMIT, conversation.id);
  } catch (err) {
    // Not the sender's doing, so not the words for their own limit, which would tell them they're sending too fast.
    if (err instanceof AppError && err.code === "RATE_LIMITED") throw new AppError(429, "CHAT_GROUP_BUSY", "This group is very busy right now. Try again in a moment.", err.details);
    throw err;
  }
  return appendMessage(ctx, tx, { tenantSlug: tenant.slug, conversation, sender: actor.membership, body: input.body, clientKey: input.clientKey, pushWindow: GROUP_PUSH_WINDOW });
}

/** Checked against the institution as it is now, because the request's copy of it can be minutes old. */
function assertMaySend(tenant: ChatTenant, actor: ChatActor, kind: ChatThreadKind): void {
  assertKindEnabled(tenant.features, kind);
  if (isCurrentPupil(tenant, actor.membership)) throw AppError.forbidden("Chat isn't available to current pupils", "FEATURE_DISABLED");
}

/** Sends to a member, opening the thread if there isn't one. */
export async function sendDirect(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, input: SendInput & { membershipId: string }): Promise<ChatDirectResultDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const { message, conversationId } = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const tenant = await freshChatTenant(tx, tenantId);
    assertMaySend(tenant, actor, "DIRECT");
    const target = await findMembershipById(tx, tenantId, input.membershipId);
    if (!target) throw AppError.notFound("Member not found");
    if (target.id === me) throw AppError.badRequest("You can't message yourself");
    await lockPair(tx, tenantId, me, target.id);
    const now = new Date();
    const { conversation, created } = await getOrCreateDirectConversation(tx, {
      tenantId,
      aId: me,
      bId: target.id,
      values: { origin: "MESSAGE_REQUEST", directState: "PENDING", requesterMembershipId: me, requestedAt: now, requestCount: 1, lastMessageAt: now },
    });
    const participant = (await findParticipant(tx, conversation.id, me))!;
    return { message: await sendLocked(ctx, tx, tenant, actor, { conversation, participant, created }, input), conversationId: conversation.id };
  });
  return { conversation: await getConversation(ctx, tenantCtx, actor, conversationId), message: toChatMessageDto(message, actor.membership, me) };
}

export async function sendMessage(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, input: SendInput): Promise<ChatMessageDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  const message = await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const conversation = await lockConversation(tx, tenantId, conversationId);
    const participant = conversation && (await findParticipant(tx, conversation.id, me));
    if (!conversation || !participant || participant.state !== "ACTIVE") throw AppError.notFound("Conversation not found");
    const group = conversation.kind === "GROUP" ? ((await lockGroupRow(tx, conversation.id)) ?? null) : null;
    // A group moderation has hidden is its owner's alone to know of, as on every read.
    if (conversation.kind === "GROUP" && (!group || (!isGroupLive(group) && group.ownerMembershipId !== me))) throw AppError.notFound("Conversation not found");
    const tenant = await freshChatTenant(tx, tenantId);
    assertMaySend(tenant, actor, threadKindOf(conversation, group));
    if (group) return sendToGroupLocked(ctx, tx, tenant, actor, conversation, group, input);
    return sendLocked(ctx, tx, tenant, actor, { conversation, participant, created: false }, input);
  });
  return toChatMessageDto(message, actor.membership, me);
}

/**
 * Keeps these members' badges in step on their devices, once `db`'s work has committed, read then so it counts what was
 * saved. The change is already saved, so a failure here only gets logged.
 */
export async function emitBadges(ctx: AppContext, db: DbClient, tenant: ChatTenant, membershipIds: string[], opts: { onlyTo?: ReadonlySet<string> } = {}): Promise<void> {
  if (membershipIds.length === 0) return;
  await afterCommit(ctx, db, async () => {
    for (const membershipId of new Set(membershipIds)) {
      const recipient = await chatRecipientOf(ctx.db, membershipId);
      if (!recipient) continue;
      // Counted for everyone named, and sent only to those in `onlyTo`, so the work done can't show who was left out.
      const badge = await badgeOf(ctx.db, tenant, membershipId);
      if (!opts.onlyTo || opts.onlyTo.has(membershipId)) ctx.realtime.emit(rooms.user(recipient.userId), "chat:unread", { tenantSlug: tenant.slug, membershipId, ...badge });
    }
  });
}

/** Keeps the badge in step on the member's other devices. */
export async function emitUnread(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor): Promise<void> {
  await emitBadges(ctx, ctx.db, chatTenantOf(tenantCtx), [actor.membership.id]);
}

export async function markRead(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, seq: number): Promise<{ lastReadSeq: number }> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  await loadEnabledThread(ctx.db, tenant, me, conversationId);
  const lastReadSeq = await advanceRead(ctx.db, conversationId, me, seq);
  if (lastReadSeq === undefined) throw AppError.notFound("Conversation not found");
  await afterCommit(ctx, ctx.db, () => ctx.redis.del(keys.chatPushQuiet(conversationId, me)));
  await afterCommit(ctx, ctx.db, async () => {
    const own = (await chatRecipients(ctx.db, conversationId)).filter((r) => r.membershipId === me);
    if (own.length > 0) ctx.realtime.emit(own.map((r) => rooms.user(r.userId)), "chat:read", { tenantSlug: tenant.slug, conversationId, membershipId: me, lastReadSeq });
  });
  await emitUnread(ctx, tenantCtx, actor);
  return { lastReadSeq };
}

export async function setMute(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, until: string | null): Promise<ChatConversationDto> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  await loadEnabledThread(ctx.db, tenant, me, conversationId);
  await updateParticipant(ctx.db, conversationId, me, { mutedUntil: until ? new Date(until) : null });
  await publishChanged(ctx, ctx.db, tenant.slug, conversationId, { onlyMembershipId: me });
  await emitUnread(ctx, tenantCtx, actor);
  return getConversation(ctx, tenantCtx, actor, conversationId);
}

/** Runs a recipient's answer to a request under the lock, on the thread as they see it, with the same refusal for a requester whatever state it's in. */
async function answerRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, answer: (tx: Tx, conversation: ConversationRow, tenant: ChatTenant) => Promise<void>): Promise<ChatConversationDto> {
  const me = actor.membership.id;
  const tenantId = tenantCtx.tenant.id;
  await runInTransaction(ctx, async (tx) => {
    await limitLockWait(tx);
    const conversation = await lockConversation(tx, tenantId, conversationId);
    const participant = conversation && (await findParticipant(tx, conversation.id, me));
    if (!conversation || !participant || participant.state !== "ACTIVE") throw AppError.notFound("Conversation not found");
    if (conversation.kind !== "DIRECT") throw AppError.invalidTransition("Only a message request can be accepted or declined");
    const tenant = await freshChatTenant(tx, tenantId);
    assertKindEnabled(tenant.features, "DIRECT");
    const seen = asSeenBy(conversation, participant);
    const open = seen.directState === "PENDING" || seen.directState === "DECLINED";
    if (open && seen.requesterMembershipId === me) throw requestPending();
    await answer(tx, seen, tenant);
  });
  await emitUnread(ctx, tenantCtx, actor);
  return getConversation(ctx, tenantCtx, actor, conversationId);
}

export function acceptRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string): Promise<ChatConversationDto> {
  const me = actor.membership.id;
  return answerRequest(ctx, tenantCtx, actor, conversationId, async (tx, conversation, tenant) => {
    if (conversation.directState === "ACCEPTED") return;
    if (conversation.directState === "CLOSED") throw AppError.invalidTransition("This conversation has closed. Send a new request instead.");
    const peerId = peerIdOf(conversation, me);
    const peer = peerId ? await findMembershipById(tx, tenant.id, peerId) : undefined;
    if (!peer || !isReachable(tenant, peer)) throw contactUnavailable();
    const blocks = await blocksBetween(tx, me, peer.id);
    if (blocks.byMe) throw blockedByYou();
    // Accepted as far as they can tell. Someone who asked and then blocked them doesn't get to learn it.
    if (blocks.byOther) await updateParticipant(tx, conversation.id, me, { withheldState: "ACCEPTED" });
    else {
      await changeDirectState(tx, conversation.id, { directState: "ACCEPTED" });
      await queuePushEvent(ctx, tx, { tenantId: tenant.id, conversationId: conversation.id, kind: "CHAT_ACCEPTED", actorMembershipId: me });
    }
    await publishChanged(ctx, tx, tenant.slug, conversation.id, { actorMembershipId: me });
  });
}

/**
 * The requester hears nothing, because that's the whole point of a silent decline. It goes in the invitation ledger too, so
 * the requester can't reach them through a group invitation instead, and any group invitations from them already waiting
 * go out of sight with it.
 */
export function declineRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string): Promise<ChatConversationDto> {
  const me = actor.membership.id;
  return answerRequest(ctx, tenantCtx, actor, conversationId, async (tx, conversation, tenant) => {
    if (conversation.directState === "DECLINED") return;
    if (conversation.directState !== "PENDING") throw AppError.invalidTransition("Only a request can be declined");
    await updateConversation(tx, conversation.id, { directState: "DECLINED" });
    await updateParticipant(tx, conversation.id, me, { lastReadSeq: conversation.lastSeq });
    const requester = conversation.requesterMembershipId;
    if (requester) {
      await recordInviteDecline(tx, { tenantId: tenant.id, declinerMembershipId: me, inviterMembershipId: requester });
      for (const groupId of await suppressInvitesFrom(tx, me, requester)) await publishChangedTo(ctx, tx, tenant.slug, groupId, [me]);
    }
    await publishChanged(ctx, tx, tenant.slug, conversation.id, { onlyMembershipId: me });
  });
}

/**
 * Counts conversations, not messages. No chat message writes a bell row, so this is all the badge there is. Group
 * invitations are counted apart, because they belong on Groups.
 */
export async function getBadge(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor): Promise<ChatBadgeDto> {
  return badgeOf(ctx.db, chatTenantOf(tenantCtx), actor.membership.id);
}

async function badgeOf(db: DbClient, tenant: ChatTenant, me: string): Promise<ChatBadgeDto> {
  const kinds = enabledKinds(tenant.features);
  if (kinds.length === 0) return { unread: 0, requests: 0, invites: 0 };
  const now = new Date();
  const invites = await countInvites(db, tenant.id, me, enabledGroupVisibilities(tenant.features), inviteCutoff(now));
  const rows = await listBadgeThreads(db, tenant.id, me, kinds);
  const groupUnread = await countGroupUnread(db, me, rows.filter((r) => r.group).map((r) => r.conversation.id));
  const mutedNow = (p: ParticipantRow) => !!p.mutedUntil && p.mutedUntil > now;
  let unread = 0;
  let requests = 0;
  for (const row of rows) {
    const { participant, peer } = row;
    if (row.group) {
      if (!mutedNow(participant) && (groupUnread.get(row.conversation.id) ?? 0) > 0) unread += 1;
      continue;
    }
    const conversation = asSeenBy(row.conversation, participant);
    const iAsked = conversation.requesterMembershipId === me;
    if (conversation.directState === "PENDING" && !iAsked) {
      if (isReachable(tenant, peer)) requests += 1;
      continue;
    }
    if (conversation.directState === "DECLINED" && !iAsked) continue;
    if (!mutedNow(participant) && unreadOf(conversation, participant) > 0) unread += 1;
  }
  return { unread, requests, invites };
}
