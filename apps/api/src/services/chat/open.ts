import type { AppContext } from "../../context";
import type { Tx } from "../../db/client";
import { blocksBetween, changeDirectState, findMessageByClientKey, getOrCreateDirectConversation, limitLockWait, lockConversation, lockPair, updateConversation, type ChatMessageRow } from "../../repositories/chat.repo";
import { findMembershipById } from "../../repositories/memberships.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { assertKindEnabled, contactUnavailable, freshChatTenant, isReachable } from "./common";
import { appendMessage, publishChanged, queuePushEvent } from "./fanout";

export interface OpenDirectInput {
  tenantId: string;
  aId: string;
  bId: string;
  origin: "MENTORSHIP" | "REFERRAL";
  originId: string;
  /** The note that started it, which becomes the first message. */
  seedMessage?: { senderMembershipId: string; body: string };
  /** Who agreed just now and doesn't need telling. Leave it out and both members get a push. */
  actorMembershipId?: string;
}

/**
 * Opens the pair's thread because both sides have agreed elsewhere: a mentorship or referral was accepted. Runs inside the
 * caller's transaction. Creates it ACCEPTED if there's no thread. Explicit consent wins over PENDING, DECLINED or CLOSED,
 * which become ACCEPTED and take this origin. An ACCEPTED thread is reused and keeps its origin, or ending this connection
 * could close a chat that had nothing to do with it. Blocks are handled silently before this is reached, so one here means a
 * race, and it refuses like any other unavailable contact.
 */
export async function openDirectFromOrigin(ctx: AppContext, tx: Tx, input: OpenDirectInput): Promise<{ conversationId: string; created: boolean; message: ChatMessageRow | null }> {
  const { tenantId, aId, bId, origin, originId, seedMessage, actorMembershipId = null } = input;
  await limitLockWait(tx);
  const tenant = await freshChatTenant(tx, tenantId);
  assertKindEnabled(tenant.features, "DIRECT");
  const a = await findMembershipById(tx, tenantId, aId);
  const b = await findMembershipById(tx, tenantId, bId);
  if (!isReachable(tenant, a) || !isReachable(tenant, b)) throw contactUnavailable();
  await lockPair(tx, tenantId, aId, bId);
  const now = new Date();
  const { conversation, created } = await getOrCreateDirectConversation(tx, { tenantId, aId, bId, values: { origin, originId, directState: "ACCEPTED", requesterMembershipId: null, requestedAt: null, requestCount: 0, lastMessageAt: now } });
  const blocks = await blocksBetween(tx, aId, bId);
  if (blocks.byMe || blocks.byOther) throw contactUnavailable();

  const opening = !created && conversation.directState !== "ACCEPTED";
  if (opening) await changeDirectState(tx, conversation.id, { directState: "ACCEPTED", origin, originId });
  const opened = created || opening;

  let message: ChatMessageRow | null = null;
  if (seedMessage) {
    const clientKey = `origin-${originId}`;
    message = (await findMessageByClientKey(tx, conversation.id, seedMessage.senderMembershipId, clientKey)) ?? null;
    if (!message) {
      const sender = seedMessage.senderMembershipId === aId ? a! : b!;
      // Opening the chat tells them, so its first message isn't a second push.
      message = await appendMessage(ctx, tx, { tenantSlug: tenant.slug, conversation, sender, body: seedMessage.body, clientKey, noPush: opened });
    }
  }
  if (opened) {
    await publishChanged(ctx, tx, tenant.slug, conversation.id);
    await queuePushEvent(ctx, tx, { tenantId, conversationId: conversation.id, kind: "CHAT_OPENED", actorMembershipId });
  }
  return { conversationId: conversation.id, created, message };
}

/**
 * Ends the chat a mentorship or referral opened, leaving it read-only. Only if that's what opened it and nothing else still
 * needs it: the caller says whether another live mentorship or accepted referral connects the pair. Closing counts as the
 * last request, so someone can't turn straight around and ask again.
 */
export async function closeOriginConversation(ctx: AppContext, tx: Tx, input: { tenantId: string; conversationId: string; hasOtherLiveConnection: boolean }): Promise<boolean> {
  await limitLockWait(tx);
  const conversation = await lockConversation(tx, input.tenantId, input.conversationId);
  if (!conversation || conversation.directState !== "ACCEPTED" || input.hasOtherLiveConnection) return false;
  if (conversation.origin !== "MENTORSHIP" && conversation.origin !== "REFERRAL") return false;
  await updateConversation(tx, conversation.id, { directState: "CLOSED", requestedAt: new Date() });
  const tenant = await findTenantById(tx, input.tenantId);
  if (tenant) await publishChanged(ctx, tx, tenant.slug, conversation.id);
  return true;
}
