import type { ChatBadgeDto, ChatConversationDto, ChatConversationsQuery, ChatDirectLookupDto, ChatDirectResultDto, ChatMessageDto, ChatMessagesQuery, CursorPage } from "@illuminize/shared";
import { isCurrentPupil } from "@illuminize/shared";
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
  type ChatMessageRow,
  type ConversationRow,
  type ParticipantRow,
  type ThreadRow,
} from "../../repositories/chat.repo";
import { findMembershipById } from "../../repositories/memberships.repo";
import type { MembershipRow, TenantContext, TenantRow } from "../../types/request";
import { asSeenBy, assertKindEnabled, blockedByYou, chatTenantOf, contactUnavailable, enabledKinds, freshChatTenant, isReachable, peerIdOf, planSend, requestPending, threadView, unreadOf, type ChatTenant } from "./common";
import { appendMessage, chatRecipientOf, chatRecipients, publishChanged, queuePushEvent } from "./fanout";

export interface ChatActor {
  userId: string;
  membership: MembershipRow;
}

/** New requests a member may send in a day. Counted before the block branch, so being blocked can't change when it runs out. */
const CHAT_REQUEST_LIMIT = { bucket: "chat-request", limit: 20, windowSec: 24 * 60 * 60 };

interface SendInput {
  body: string;
  clientKey: string;
}

function toConversationDto(tenant: Pick<TenantRow, "type" | "timezone">, row: ThreadRow, lastMessage: ChatMessageRow | undefined, now: Date): ChatConversationDto {
  const { conversation, participant, peer } = row;
  const view = threadView(tenant, row, now);
  // A request shows its text only when opened. A requester's own row stays the same whatever became of their request.
  const showsMessage = view.state === "ACCEPTED" || view.state === "CLOSED";
  return {
    id: conversation.id,
    kind: conversation.kind,
    peer: peer ? toChatMemberDto(peer) : null,
    ...view,
    // The stored position can pass what they can see, because unblocking marks withheld rows read, and that would count them.
    lastReadSeq: Math.min(view.lastReadSeq, lastMessage?.seq ?? 0),
    lastMessage: showsMessage && lastMessage ? toChatLastMessageDto(lastMessage, participant.membershipId) : null,
  };
}

async function loadThread(db: DbClient, tenantId: string, membershipId: string, conversationId: string): Promise<ThreadRow> {
  const thread = await findThread(db, tenantId, membershipId, conversationId);
  if (!thread) throw AppError.notFound("Conversation not found");
  return thread;
}

export async function listConversations(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, query: ChatConversationsQuery): Promise<CursorPage<ChatConversationDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const kinds = enabledKinds(tenant.features);
  if (kinds.length === 0) throw AppError.forbidden("Messaging is switched off for this institution", "FEATURE_DISABLED");
  const me = actor.membership.id;
  const page = await listThreads(ctx.db, tenant.id, me, { ...query, kinds });
  const last = await findLastVisibleMessages(ctx.db, me, page.data.map((r) => r.conversation.id));
  const now = new Date();
  // Status is in the query. Whether someone became a pupil depends on the institution's date, so it's checked here, at the cost of a short page.
  const shown = query.inbox === "REQUESTS" ? page.data.filter((r) => isReachable(tenant, r.peer)) : page.data;
  return { data: shown.map((r) => toConversationDto(tenant, r, last.get(r.conversation.id), now)), nextCursor: page.nextCursor };
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
  const thread = await loadThread(ctx.db, tenant.id, me, id);
  assertKindEnabled(tenant.features, thread.conversation.kind);
  const last = await findLastVisibleMessages(ctx.db, me, [id]);
  return toConversationDto(tenant, thread, last.get(id), new Date());
}

export async function listMessages(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, id: string, query: ChatMessagesQuery): Promise<CursorPage<ChatMessageDto>> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const thread = await loadThread(ctx.db, tenant.id, me, id);
  assertKindEnabled(tenant.features, thread.conversation.kind);
  const page = await listThreadMessages(ctx.db, thread.participant, query);
  return { data: page.data.map((r) => toChatMessageDto(r.message, r.sender, me)), nextCursor: page.nextCursor };
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

/** Checked against the institution as it is now, because the request's copy of it can be minutes old. */
function assertMaySend(tenant: ChatTenant, actor: ChatActor, kind: ConversationRow["kind"]): void {
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
    const tenant = await freshChatTenant(tx, tenantId);
    assertMaySend(tenant, actor, conversation.kind);
    return sendLocked(ctx, tx, tenant, actor, { conversation, participant, created: false }, input);
  });
  return toChatMessageDto(message, actor.membership, me);
}

/** Keeps the badge in step on the member's other devices. The change is already saved, so a failure here only gets logged. */
export async function emitUnread(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor): Promise<void> {
  await afterCommit(ctx, ctx.db, async () => {
    const recipient = await chatRecipientOf(ctx.db, actor.membership.id);
    if (recipient) ctx.realtime.emit(rooms.user(recipient.userId), "chat:unread", { tenantSlug: tenantCtx.tenant.slug, membershipId: recipient.membershipId, ...(await getBadge(ctx, tenantCtx, actor)) });
  });
}

export async function markRead(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string, seq: number): Promise<{ lastReadSeq: number }> {
  const tenant = chatTenantOf(tenantCtx);
  const me = actor.membership.id;
  const thread = await loadThread(ctx.db, tenant.id, me, conversationId);
  assertKindEnabled(tenant.features, thread.conversation.kind);
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
  const thread = await loadThread(ctx.db, tenant.id, me, conversationId);
  assertKindEnabled(tenant.features, thread.conversation.kind);
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
    const tenant = await freshChatTenant(tx, tenantId);
    assertKindEnabled(tenant.features, conversation.kind);
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

/** The requester hears nothing, because that's the whole point of a silent decline. */
export function declineRequest(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor, conversationId: string): Promise<ChatConversationDto> {
  const me = actor.membership.id;
  return answerRequest(ctx, tenantCtx, actor, conversationId, async (tx, conversation, tenant) => {
    if (conversation.directState === "DECLINED") return;
    if (conversation.directState !== "PENDING") throw AppError.invalidTransition("Only a request can be declined");
    await updateConversation(tx, conversation.id, { directState: "DECLINED" });
    await updateParticipant(tx, conversation.id, me, { lastReadSeq: conversation.lastSeq });
    await publishChanged(ctx, tx, tenant.slug, conversation.id, { onlyMembershipId: me });
  });
}

/** Counts conversations, not messages. No chat message writes a bell row, so this is all the badge there is. */
export async function getBadge(ctx: AppContext, tenantCtx: TenantContext, actor: ChatActor): Promise<ChatBadgeDto> {
  const tenant = chatTenantOf(tenantCtx);
  const kinds = enabledKinds(tenant.features);
  if (kinds.length === 0) return { unread: 0, requests: 0 };
  const me = actor.membership.id;
  const now = new Date();
  const rows = await listBadgeThreads(ctx.db, tenant.id, me, kinds);
  let unread = 0;
  let requests = 0;
  for (const row of rows) {
    const { participant, peer } = row;
    const conversation = asSeenBy(row.conversation, participant);
    const iAsked = conversation.requesterMembershipId === me;
    if (conversation.directState === "PENDING" && !iAsked) {
      if (isReachable(tenant, peer)) requests += 1;
      continue;
    }
    if (conversation.directState === "DECLINED" && !iAsked) continue;
    const muted = participant.mutedUntil && participant.mutedUntil > now;
    if (!muted && unreadOf(conversation, participant) > 0) unread += 1;
  }
  return { unread, requests };
}
