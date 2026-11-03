import { enabledGroupVisibilities, resolveFeatures, resolveNotificationPrefs, type ChatPushKind } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { PermanentJobError, type JobHandler } from "../../jobs/JobQueue";
import { keys } from "../../redis/keys";
import { findConversationWithGroup, findParticipantsWithNews, findUnmutedParticipants, type ChatGroupRow, type ConversationRow } from "../../repositories/chat.repo";
import { findGroupById, findVisibleInvitations } from "../../repositories/chatGroups.repo";
import { findMembershipsByIds } from "../../repositories/memberships.repo";
import { findNotificationPrefsByMemberships } from "../../repositories/notifications.repo";
import { findTenantWithSettingsById } from "../../repositories/tenants.repo";
import { PUSH_BATCH_SIZE } from "../notifications/ExpoPushChannel";
import { PushSendError, type PushMessage } from "../notifications/NotificationChannel";
import { enabledKinds, inviteCutoff, isGroupLive, peerIdOf, threadKindOf } from "./common";
import { chatRecipientOf, chatRecipients, type ChatRecipient } from "./fanout";

/**
 * What a lock screen says, and all it says: there's never a body, because a message's words would pass through third parties
 * and couldn't be recalled if an admin later removed them.
 */
const TITLES: Record<ChatPushKind, (peerName: string | null) => string> = {
  CHAT_MESSAGE: (name) => (name ? `New message from ${name}` : "New message"),
  // Nobody has agreed to anything yet, so a stranger's name stays off the screen as well as their words.
  CHAT_REQUEST: () => "New message request",
  CHAT_ACCEPTED: (name) => (name ? `${name} accepted your message request` : "Your message request was accepted"),
  CHAT_OPENED: (name) => (name ? `You can now message ${name}` : "A new chat is open"),
  // The same for an invitation: neither who sent it nor the group's name shows until they look.
  CHAT_GROUP_INVITE: () => "You've been invited to a group",
};

/** A group's messages go under the name an admin approved, never one still waiting for review. */
const groupMessageTitle = (approvedName: string | null) => (approvedName ? `New message in ${approvedName}` : "New message in a group");

/** An invitation's push is claimed for this long, which outlasts every retry of its job. */
const INVITE_CLAIM_SEC = 24 * 60 * 60;

/** The institution's switch and the thread as they are now, because the job may have waited. A suspended institution drops out at chatRecipients. */
async function readFresh(ctx: AppContext, tenantId: string, conversationId: string): Promise<{ slug: string; conversation: ConversationRow; group: ChatGroupRow | null } | null> {
  const row = await findTenantWithSettingsById(ctx.db, tenantId);
  if (!row) return null;
  const found = await findConversationWithGroup(ctx.db, tenantId, conversationId);
  if (!found || (found.conversation.kind === "GROUP" && !found.group)) return null;
  if (!enabledKinds(resolveFeatures(row.tenant.type, row.settings.features)).includes(threadKindOf(found.conversation, found.group))) return null;
  return { slug: row.tenant.slug, conversation: found.conversation, group: found.group };
}

const wantsPush = async (ctx: AppContext, membershipIds: string[]) => {
  const prefs = await findNotificationPrefsByMemberships(ctx.db, membershipIds);
  return new Set(membershipIds.filter((id) => resolveNotificationPrefs(prefs.get(id)).categories.CHAT === "IN_APP_PUSH"));
};

/** A chat push still undelivered after this long, to a phone that was off, says nothing useful, so Expo drops it rather than deliver it late. */
export const CHAT_PUSH_TTL_SEC = 3600;

interface ChatPushItem {
  recipient: ChatRecipient;
  title: string;
}

/**
 * Packs members' messages into Expo-sized batches, never splitting one member's devices across two unless they alone have
 * more than a batch holds. That's what lets a failed batch say exactly who has had their push and who hasn't.
 */
export function batchByMember(members: Array<{ membershipId: string; messages: PushMessage[] }>, size = PUSH_BATCH_SIZE): Array<{ messages: PushMessage[]; membershipIds: string[] }> {
  const batches: Array<{ messages: PushMessage[]; membershipIds: string[] }> = [];
  let current: { messages: PushMessage[]; membershipIds: string[] } = { messages: [], membershipIds: [] };
  const flush = () => {
    if (current.messages.length > 0) batches.push(current);
    current = { messages: [], membershipIds: [] };
  };
  for (const member of members) {
    if (member.messages.length === 0) continue;
    if (current.messages.length + member.messages.length > size) flush();
    for (let i = 0; i < member.messages.length; i += size) {
      if (i > 0) flush();
      current.messages.push(...member.messages.slice(i, i + size));
      current.membershipIds.push(member.membershipId);
    }
  }
  flush();
  return batches;
}

/**
 * Sends now, from this job, rather than handing finished messages to `push.send`: that queue can be minutes behind an
 * announcement and retries without looking again, while everything checked here (the device's owner, a suspension, a mute,
 * a read) is only true now. A failure retries this whole job, which checks it all again. Before it does, `onUnsent` hears
 * which members got nothing, so the caller can let the retry reach them and only them: whatever failed, looking up their
 * devices or any batch.
 */
async function send(ctx: AppContext, slug: string, conversationId: string, kind: ChatPushKind, items: ChatPushItem[], onUnsent?: (membershipIds: string[]) => Promise<unknown>): Promise<void> {
  const push = ctx.push;
  if (!push || items.length === 0) return;
  const told = new Set<string>();
  try {
    // Looking up devices fails like a batch does, before anyone has been told, so it lets everyone go again too.
    const each = await push.prepareEach(
      items.map((i) => ({ userId: i.recipient.userId, title: i.title, data: { type: kind, conversationId } })),
      { tenantSlug: slug },
    );
    const batches = batchByMember(items.map((item, i) => ({ membershipId: item.recipient.membershipId, messages: (each[i] ?? []).map((m) => ({ ...m, ttl: CHAT_PUSH_TTL_SEC })) })));
    for (const batch of batches) {
      await push.sendBatch(batch.messages);
      for (const id of batch.membershipIds) told.add(id);
    }
  } catch (err) {
    await onUnsent?.(items.map((i) => i.recipient.membershipId).filter((id) => !told.has(id)));
    if (err instanceof PushSendError && !err.retryable) throw new PermanentJobError(err.message, { cause: err });
    throw err;
  }
}

/** Each recipient's push about a direct thread, titled with the other member's name. */
async function directItems(ctx: AppContext, conversation: ConversationRow, kind: ChatPushKind, recipients: ChatRecipient[]): Promise<ChatPushItem[]> {
  const peerIds = recipients.map((r) => peerIdOf(conversation, r.membershipId)).filter((id): id is string => !!id);
  const names = new Map((await findMembershipsByIds(ctx.db, conversation.tenantId, peerIds)).map((m) => [m.id, m.fullName]));
  return recipients.map((recipient) => {
    const peerId = peerIdOf(conversation, recipient.membershipId);
    return { recipient, title: TITLES[kind](peerId ? (names.get(peerId) ?? null) : null) };
  });
}

/**
 * Tells whoever hasn't read a conversation that it has news, and then stays quiet towards them until they read it or
 * `quietSec` passes. Each recipient is claimed before anything goes, so a job retried after a later batch failed can't push
 * twice to anyone an earlier batch reached. Only an accepted direct thread, because messages queued before a thread went
 * back to being a request wouldn't have its consent any more, and only a group its members can see.
 */
export const pushConversation: JobHandler<"chat.pushConversation"> = async (ctx, { tenantId, conversationId, quietSec }) => {
  if (!ctx.push) return;
  const fresh = await readFresh(ctx, tenantId, conversationId);
  if (!fresh) return;
  const { conversation, group } = fresh;
  if (group ? !isGroupLive(group) : conversation.directState !== "ACCEPTED") return;
  const recipients = await chatRecipients(ctx.db, conversationId);
  const withNews = new Set(await findParticipantsWithNews(ctx.db, conversationId, recipients.map((r) => r.membershipId), new Date()));
  const wants = await wantsPush(ctx, [...withNews]);
  const candidates = recipients.filter((r) => wants.has(r.membershipId));
  // Everything that reads before the claims, so nothing between them and `send` can fail and leave them taken, which would
  // let a retry tell nobody. From there on, `send` gives back every claim it didn't use.
  const named = group ? candidates.map((recipient) => ({ recipient, title: groupMessageTitle(group.approvedName) })) : await directItems(ctx, conversation, "CHAT_MESSAGE", candidates);
  const quietKey = (membershipId: string) => keys.chatPushQuiet(conversationId, membershipId);
  const claimed = await Promise.all(named.map((i) => ctx.redis.set(quietKey(i.recipient.membershipId), "1", "EX", quietSec, "NX")));
  const items = named.filter((_, i) => claimed[i] === "OK");
  await send(ctx, fresh.slug, conversationId, "CHAT_MESSAGE", items, (unsent) => Promise.all(unsent.map((id) => ctx.redis.del(quietKey(id)))));
};

/**
 * Tells a direct thread's other member about one thing that happened. Passing the member who did it also drops anyone who
 * has them blocked, so someone who asked and then blocked never learns of an answer. A job that waited behind a change of
 * state says nothing, because what it would say is no longer true.
 */
export const pushEvent: JobHandler<"chat.pushEvent"> = async (ctx, { tenantId, conversationId, kind, actorMembershipId }) => {
  if (!ctx.push) return;
  const fresh = await readFresh(ctx, tenantId, conversationId);
  if (!fresh || fresh.conversation.kind !== "DIRECT" || fresh.conversation.directState !== (kind === "CHAT_REQUEST" ? "PENDING" : "ACCEPTED")) return;
  const others = (await chatRecipients(ctx.db, conversationId, { actorMembershipId })).filter((r) => r.membershipId !== actorMembershipId);
  const unmuted = new Set(await findUnmutedParticipants(ctx.db, conversationId, others.map((r) => r.membershipId), new Date()));
  const wants = await wantsPush(ctx, [...unmuted]);
  await send(ctx, fresh.slug, conversationId, kind, await directItems(ctx, fresh.conversation, kind, others.filter((r) => wants.has(r.membershipId))));
};

/**
 * Tells members they've been invited to a group, with the same words whoever invited them to whatever group. Everything is
 * read again now: an invitation held back from the start, or since declined, accepted, lapsed or hidden by a block, or to a
 * group since archived, hidden by moderation or switched off, says nothing. Each invitation is claimed, so a retry pushes
 * nobody twice.
 */
export const pushGroupInvite: JobHandler<"chat.pushGroupInvite"> = async (ctx, { tenantId, conversationId, inviteeMembershipIds }) => {
  if (!ctx.push) return;
  const row = await findTenantWithSettingsById(ctx.db, tenantId);
  if (!row || row.tenant.status !== "ACTIVE") return;
  const group = await findGroupById(ctx.db, tenantId, conversationId);
  if (!group || !isGroupLive(group) || group.archivedAt || !enabledGroupVisibilities(resolveFeatures(row.tenant.type, row.settings.features)).includes(group.visibility)) return;
  const waiting = await findVisibleInvitations(ctx.db, conversationId, inviteeMembershipIds, inviteCutoff(new Date()));
  const recipients = (await Promise.all(waiting.map((w) => chatRecipientOf(ctx.db, w.membershipId)))).filter((r): r is ChatRecipient => !!r);
  const wants = await wantsPush(ctx, recipients.map((r) => r.membershipId));
  const invitedAt = new Map(waiting.map((w) => [w.membershipId, w.invitedAt.getTime()]));
  const claimKey = (membershipId: string) => keys.chatPushInvite(conversationId, membershipId, invitedAt.get(membershipId) ?? 0);
  const candidates = recipients.filter((r) => wants.has(r.membershipId));
  const claimed = await Promise.all(candidates.map((r) => ctx.redis.set(claimKey(r.membershipId), "1", "EX", INVITE_CLAIM_SEC, "NX")));
  const items = candidates.filter((_, i) => claimed[i] === "OK").map((recipient) => ({ recipient, title: TITLES.CHAT_GROUP_INVITE(null) }));
  // Nothing can fail between the claims and `send`, which gives back every claim it didn't use.
  await send(ctx, row.tenant.slug, conversationId, "CHAT_GROUP_INVITE", items, (unsent) => Promise.all(unsent.map((id) => ctx.redis.del(claimKey(id)))));
};
