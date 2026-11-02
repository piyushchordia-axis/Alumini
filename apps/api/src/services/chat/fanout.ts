import { isCurrentPupil } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import { toChatMessageDto } from "../../dto/chat.dto";
import { afterCommit } from "../../lib/transaction";
import { rooms } from "../../realtime/rooms";
import { findBlockersAmong, findDeliveryCandidate, insertNextMessage, listDeliveryCandidates, thawParticipants, updateParticipant, type ChatMessageRow, type ChatSender, type ConversationRow, type DeliveryCandidate } from "../../repositories/chat.repo";

export interface ChatRecipient {
  membershipId: string;
  userId: string;
}

const mayBeTold = ({ membership, tenant }: DeliveryCandidate, now: Date) => tenant.status === "ACTIVE" && membership.status === "APPROVED" && !isCurrentPupil(tenant, membership, now);
const toRecipient = ({ membership }: DeliveryCandidate): ChatRecipient => ({ membershipId: membership.id, userId: membership.userId });

/**
 * Who may be told anything about this conversation, read fresh each time, because there are no conversation rooms to go
 * stale: an active participant, approved, not a current pupil, in an active institution. Pass the member acting and anyone
 * who has them blocked drops out too. Every chat emit goes through this, or chatRecipientOf for one that isn't about a
 * conversation.
 */
export async function chatRecipients(db: DbClient, conversationId: string, opts: { actorMembershipId?: string | null } = {}): Promise<ChatRecipient[]> {
  const candidates = await listDeliveryCandidates(db, conversationId);
  const now = new Date();
  const eligible = candidates.filter((c) => mayBeTold(c, now)).map(toRecipient);
  if (!opts.actorMembershipId) return eligible;
  const blockers = new Set(await findBlockersAmong(db, opts.actorMembershipId, eligible.map((r) => r.membershipId)));
  return eligible.filter((r) => !blockers.has(r.membershipId));
}

/** The same rules for one member, for what's about them rather than a conversation: their badge. */
export async function chatRecipientOf(db: DbClient, membershipId: string): Promise<ChatRecipient | null> {
  const candidate = await findDeliveryCandidate(db, membershipId);
  return candidate && mayBeTold(candidate, new Date()) ? toRecipient(candidate) : null;
}

const toRooms = (recipients: ChatRecipient[]) => recipients.map((r) => rooms.user(r.userId));

/**
 * Hints that a thread changed, once `db`'s work has committed. Carries no content. Leave out `onlyMembershipId` to tell
 * everyone allowed to know, or name someone when the change is theirs alone, like a decline or a block, which the other
 * member must never hear about.
 */
export async function publishChanged(ctx: AppContext, db: DbClient, tenantSlug: string, conversationId: string, opts: { actorMembershipId?: string | null; onlyMembershipId?: string } = {}): Promise<void> {
  const recipients = await chatRecipients(db, conversationId, { actorMembershipId: opts.actorMembershipId });
  const to = opts.onlyMembershipId ? recipients.filter((r) => r.membershipId === opts.onlyMembershipId) : recipients;
  await afterCommit(ctx, db, async () => {
    if (to.length > 0) ctx.realtime.emit(toRooms(to), "chat:changed", { tenantSlug, conversationId });
  });
}

/** Tells every participant a message became a tombstone. */
export async function publishRemoved(ctx: AppContext, db: DbClient, tenantSlug: string, message: Pick<ChatMessageRow, "id" | "conversationId" | "seq">): Promise<void> {
  const recipients = await chatRecipients(db, message.conversationId);
  await afterCommit(ctx, db, async () => {
    if (recipients.length > 0) ctx.realtime.emit(toRooms(recipients), "chat:removed", { tenantSlug, conversationId: message.conversationId, messageId: message.id, seq: message.seq });
  });
}

export interface AppendInput {
  tenantSlug: string;
  /** Locked by the caller. */
  conversation: Pick<ConversationRow, "id" | "tenantId">;
  sender: ChatSender | null;
  kind?: ChatMessageRow["kind"];
  body: string;
  meta?: Record<string, unknown> | null;
  clientKey?: string | null;
  /** Only the sender's own devices will ever hear of it. */
  withheld?: boolean;
  /** It's a request the others haven't accepted, so they're told something arrived and not what it says. */
  isRequest?: boolean;
}

/**
 * Adds a message to a conversation the caller has locked, inside the caller's transaction, and delivers it once that
 * commits. Never opens a transaction or touches ctx.db: nested sends doing that could freeze the whole pool.
 */
export async function appendMessage(ctx: AppContext, tx: Tx, input: AppendInput): Promise<ChatMessageRow> {
  const { conversation, sender, tenantSlug } = input;
  const senderId = sender?.id ?? null;
  const row = await insertNextMessage(tx, {
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    senderMembershipId: senderId,
    kind: input.kind ?? "TEXT",
    body: input.body,
    meta: input.meta ?? null,
    clientKey: input.clientKey ?? null,
    withheld: input.withheld ?? false,
    createdAt: new Date(),
  });
  if (senderId) await updateParticipant(tx, conversation.id, senderId, { lastReadSeq: row.seq });
  // Whoever can see this has news again. Anyone it's withheld from stays where they were.
  await thawParticipants(tx, conversation.id, input.withheld ? senderId : undefined);

  const recipients = await chatRecipients(tx, conversation.id, { actorMembershipId: senderId });
  const own = recipients.filter((r) => r.membershipId === senderId);
  const others = input.withheld ? [] : recipients.filter((r) => r.membershipId !== senderId);
  await afterCommit(ctx, tx, async () => {
    const payload = (viewer: string | null) => ({ tenantSlug, conversationId: conversation.id, message: toChatMessageDto(row, sender, viewer) });
    if (own.length > 0) ctx.realtime.emit(toRooms(own), "chat:message", payload(senderId));
    if (others.length === 0) return;
    if (input.isRequest) ctx.realtime.emit(toRooms(others), "chat:changed", { tenantSlug, conversationId: conversation.id });
    else ctx.realtime.emit(toRooms(others), "chat:message", payload(null));
  });
  return row;
}
