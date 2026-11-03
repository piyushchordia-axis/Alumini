import { resolveFeatures, resolveNotificationPrefs, type ChatPushKind } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { PermanentJobError, type JobHandler } from "../../jobs/JobQueue";
import { keys } from "../../redis/keys";
import { findConversation, findParticipantsWithNews, findUnmutedParticipants, type ConversationRow } from "../../repositories/chat.repo";
import { findMembershipsByIds } from "../../repositories/memberships.repo";
import { findNotificationPrefsByMemberships } from "../../repositories/notifications.repo";
import { findTenantWithSettingsById } from "../../repositories/tenants.repo";
import { PUSH_BATCH_SIZE } from "../notifications/ExpoPushChannel";
import { PushSendError } from "../notifications/NotificationChannel";
import { enabledKinds, peerIdOf } from "./common";
import { chatRecipients, type ChatRecipient } from "./fanout";

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
};

/** The institution's switch and the thread as they are now, because the job may have waited. A suspended institution drops out at chatRecipients. */
async function readFresh(ctx: AppContext, tenantId: string, conversationId: string) {
  const row = await findTenantWithSettingsById(ctx.db, tenantId);
  if (!row) return null;
  const conversation = await findConversation(ctx.db, tenantId, conversationId);
  if (!conversation || !enabledKinds(resolveFeatures(row.tenant.type, row.settings.features)).includes(conversation.kind)) return null;
  return { slug: row.tenant.slug, conversation };
}

const wantsPush = async (ctx: AppContext, membershipIds: string[]) => {
  const prefs = await findNotificationPrefsByMemberships(ctx.db, membershipIds);
  return new Set(membershipIds.filter((id) => resolveNotificationPrefs(prefs.get(id)).categories.CHAT === "IN_APP_PUSH"));
};

/** A chat push still undelivered after this long, to a phone that was off, says nothing useful, so Expo drops it rather than deliver it late. */
export const CHAT_PUSH_TTL_SEC = 3600;

/**
 * Sends now, from this job, rather than handing finished messages to `push.send`: that queue can be minutes behind an
 * announcement and retries without looking again, while everything checked here (the device's owner, a suspension, a mute,
 * a read) is only true now. A failure retries this whole job, which checks it all again.
 */
async function send(ctx: AppContext, slug: string, conversation: ConversationRow, kind: ChatPushKind, recipients: ChatRecipient[]): Promise<void> {
  if (!ctx.push || recipients.length === 0) return;
  const peerIds = recipients.map((r) => peerIdOf(conversation, r.membershipId)).filter((id): id is string => !!id);
  const names = new Map((await findMembershipsByIds(ctx.db, conversation.tenantId, peerIds)).map((m) => [m.id, m.fullName]));
  const items = recipients.map((r) => {
    const peerId = peerIdOf(conversation, r.membershipId);
    return { userId: r.userId, title: TITLES[kind](peerId ? (names.get(peerId) ?? null) : null), data: { type: kind, conversationId: conversation.id } };
  });
  const messages = (await ctx.push.prepareFor(items, { tenantSlug: slug })).map((m) => ({ ...m, ttl: CHAT_PUSH_TTL_SEC }));
  try {
    for (let i = 0; i < messages.length; i += PUSH_BATCH_SIZE) await ctx.push.sendBatch(messages.slice(i, i + PUSH_BATCH_SIZE));
  } catch (err) {
    if (err instanceof PushSendError && !err.retryable) throw new PermanentJobError(err.message, { cause: err });
    throw err;
  }
}

/**
 * Tells whoever hasn't read a conversation that it has news, and then stays quiet towards them until they read it or
 * `quietSec` passes. Only an accepted thread: messages queued before a thread went back to being a request wouldn't have
 * its consent any more.
 */
export const pushConversation: JobHandler<"chat.pushConversation"> = async (ctx, { tenantId, conversationId, quietSec }) => {
  if (!ctx.push) return;
  const fresh = await readFresh(ctx, tenantId, conversationId);
  if (!fresh || (fresh.conversation.kind === "DIRECT" && fresh.conversation.directState !== "ACCEPTED")) return;
  const recipients = await chatRecipients(ctx.db, conversationId);
  const withNews = new Set(await findParticipantsWithNews(ctx.db, conversationId, recipients.map((r) => r.membershipId), new Date()));
  const wants = await wantsPush(ctx, [...withNews]);
  const candidates = recipients.filter((r) => wants.has(r.membershipId));
  const claimed = await Promise.all(candidates.map((r) => ctx.redis.set(keys.chatPushQuiet(conversationId, r.membershipId), "1", "EX", quietSec, "NX")));
  const told = candidates.filter((_, i) => claimed[i] === "OK");
  try {
    await send(ctx, fresh.slug, fresh.conversation, "CHAT_MESSAGE", told);
  } catch (err) {
    // Nobody was told, as far as anyone knows, so the retry may claim them again. In a group, those in a batch that did go
    // may then hear twice, which beats nobody hearing.
    await Promise.all(told.map((r) => ctx.redis.del(keys.chatPushQuiet(conversationId, r.membershipId))));
    throw err;
  }
};

/**
 * Tells a conversation's other members about one thing that happened. Passing the member who did it also drops anyone who
 * has them blocked, so someone who asked and then blocked never learns of an answer. A job that waited behind a change of
 * state says nothing, because what it would say is no longer true.
 */
export const pushEvent: JobHandler<"chat.pushEvent"> = async (ctx, { tenantId, conversationId, kind, actorMembershipId }) => {
  if (!ctx.push) return;
  const fresh = await readFresh(ctx, tenantId, conversationId);
  if (!fresh || fresh.conversation.directState !== (kind === "CHAT_REQUEST" ? "PENDING" : "ACCEPTED")) return;
  const others = (await chatRecipients(ctx.db, conversationId, { actorMembershipId })).filter((r) => r.membershipId !== actorMembershipId);
  const unmuted = new Set(await findUnmutedParticipants(ctx.db, conversationId, others.map((r) => r.membershipId), new Date()));
  const wants = await wantsPush(ctx, [...unmuted]);
  await send(ctx, fresh.slug, fresh.conversation, kind, others.filter((r) => wants.has(r.membershipId)));
};
