import { isCurrentPupil, resolveFeatures } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient, Tx } from "../../db/client";
import type { JobPayloads } from "../../jobs/definitions";
import { toChatMessageDto } from "../../dto/chat.dto";
import { afterCommit } from "../../lib/transaction";
import { rooms } from "../../realtime/rooms";
import { keys } from "../../redis/keys";
import {
  findBlockersAmong,
  findDeliveryCandidate,
  findDeliveryScope,
  insertNextMessage,
  listDeliveryCandidates,
  thawParticipants,
  updateParticipant,
  type ChatMessageRow,
  type ChatSender,
  type ConversationRow,
  type DeliveryCandidate,
  type DeliveryScope,
} from "../../repositories/chat.repo";
import { enabledKinds, isGroupLive, threadKindOf } from "./common";

export interface ChatRecipient {
  membershipId: string;
  userId: string;
}

const mayBeTold = ({ membership, tenant }: DeliveryCandidate, now: Date) => tenant.status === "ACTIVE" && membership.status === "APPROVED" && !isCurrentPupil(tenant, membership, now);
const toRecipient = ({ membership }: DeliveryCandidate): ChatRecipient => ({ membershipId: membership.id, userId: membership.userId });

/**
 * Whether this member could open the conversation now, as the routes would let them: its kind is switched on, and a group
 * that moderation has hidden is its owner's alone. A group conversation with no group row is nobody's.
 */
function mayOpen(scope: DeliveryScope, membershipId: string): boolean {
  if (scope.conversation.kind === "GROUP" && !scope.group) return false;
  if (!enabledKinds(resolveFeatures(scope.tenantType, scope.storedFeatures)).includes(threadKindOf(scope.conversation, scope.group))) return false;
  return !scope.group || isGroupLive(scope.group) || scope.group.ownerMembershipId === membershipId;
}

export interface RecipientOptions {
  /** Drops anyone who has this member blocked, which is how a blocker hears nothing live from them. */
  actorMembershipId?: string | null;
  /**
   * Keeps active participants who can't open it right now: its kind is switched off, or moderation hid the group. Only for a
   * hint with nothing in it, which is how a group that was just removed leaves their inbox.
   */
  evenIfHidden?: boolean;
}

/**
 * Who may be told anything about this conversation, read fresh each time, because there are no conversation rooms to go
 * stale: an active participant, approved, not a current pupil, in an active institution, who could open it now. Pass the
 * member acting and anyone who has them blocked drops out too. Every chat emit and push goes through this, or
 * chatRecipientOf for one that isn't about a conversation they're in.
 */
export async function chatRecipients(db: DbClient, conversationId: string, opts: RecipientOptions = {}): Promise<ChatRecipient[]> {
  const candidates = await listDeliveryCandidates(db, conversationId);
  if (candidates.length === 0) return [];
  const now = new Date();
  let eligible = candidates.filter((c) => mayBeTold(c, now));
  if (!opts.evenIfHidden) {
    const scope = await findDeliveryScope(db, conversationId);
    eligible = scope ? eligible.filter((c) => mayOpen(scope, c.membership.id)) : [];
  }
  const recipients = eligible.map(toRecipient);
  if (!opts.actorMembershipId) return recipients;
  const blockers = new Set(await findBlockersAmong(db, opts.actorMembershipId, recipients.map((r) => r.membershipId)));
  return recipients.filter((r) => !blockers.has(r.membershipId));
}

/** The same rules for one member, for what's about them rather than a conversation: their badge. */
export async function chatRecipientOf(db: DbClient, membershipId: string): Promise<ChatRecipient | null> {
  const candidate = await findDeliveryCandidate(db, membershipId);
  return candidate && mayBeTold(candidate, new Date()) ? toRecipient(candidate) : null;
}

const toRooms = (recipients: ChatRecipient[]) => recipients.map((r) => rooms.user(r.userId));

export interface ChangedOptions extends RecipientOptions {
  /** Tell only this member, when the change is theirs alone, like a decline or a block, which the other must never hear of. */
  onlyMembershipId?: string;
  /**
   * Tell these members too, whatever their place in it: someone who just left or was removed, whose own devices must let it
   * go, or an invitee, who isn't in it yet. Each still has to be someone chat may tell anything at all.
   */
  alsoMembershipIds?: string[];
}

/**
 * Hints that a thread changed, once `db`'s work has committed. Carries no content. Leave out `onlyMembershipId` to tell
 * everyone allowed to know, or name someone when the change is theirs alone.
 */
export async function publishChanged(ctx: AppContext, db: DbClient, tenantSlug: string, conversationId: string, opts: ChangedOptions = {}): Promise<void> {
  const recipients = await chatRecipients(db, conversationId, { actorMembershipId: opts.actorMembershipId, evenIfHidden: opts.evenIfHidden });
  const to = opts.onlyMembershipId ? recipients.filter((r) => r.membershipId === opts.onlyMembershipId) : recipients;
  const told = new Set(to.map((r) => r.membershipId));
  to.push(...(await recipientsAmong(db, (opts.alsoMembershipIds ?? []).filter((id) => !told.has(id)))));
  await afterCommit(ctx, db, async () => {
    if (to.length > 0) ctx.realtime.emit(toRooms(to), "chat:changed", { tenantSlug, conversationId });
  });
}

/** Each of these members whom chat may tell anything at all, read one at a time, because `db` may be a transaction. */
async function recipientsAmong(db: DbClient, membershipIds: string[]): Promise<ChatRecipient[]> {
  const found: ChatRecipient[] = [];
  for (const membershipId of new Set(membershipIds)) {
    const recipient = await chatRecipientOf(db, membershipId);
    if (recipient) found.push(recipient);
  }
  return found;
}

/**
 * Hints a conversation changed to these members alone, such as someone invited to a group, who isn't in it to be told
 * otherwise. With `onlyTo`, everyone named is looked up the same way and only those in it are told, so the work done can't
 * show who was left out.
 */
export async function publishChangedTo(ctx: AppContext, db: DbClient, tenantSlug: string, conversationId: string, membershipIds: string[], opts: { onlyTo?: ReadonlySet<string> } = {}): Promise<void> {
  const found = await recipientsAmong(db, membershipIds);
  const to = opts.onlyTo ? found.filter((r) => opts.onlyTo!.has(r.membershipId)) : found;
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

/** How a conversation's message pushes bunch up: `windowMs` for a burst to settle, then one push per recipient per `quietSec`. */
export interface ChatPushWindow {
  windowMs: number;
  quietSec: number;
}

export const DIRECT_PUSH_WINDOW: ChatPushWindow = { windowMs: 5_000, quietSec: 120 };
/** A group is busier and less personal, so it waits longer to bunch a burst up and stays quiet for longer after. */
export const GROUP_PUSH_WINDOW: ChatPushWindow = { windowMs: 30_000, quietSec: 600 };

/**
 * Queues the look at who hasn't read a conversation. Messages in one bucket share an id, and the id changes every bucket
 * because BullMQ holds on to a finished job's id, so a constant one would stop pushes for a day (see EnqueueOptions). It runs
 * at the end of the next bucket, because at the end of this one a message sent just before it would beat the reader's read.
 */
export async function queueConversationPush(ctx: Pick<AppContext, "jobs">, input: { tenantId: string; conversationId: string }, window: ChatPushWindow = DIRECT_PUSH_WINDOW, now = Date.now()): Promise<void> {
  const bucket = Math.floor(now / window.windowMs);
  await ctx.jobs.enqueue("chat.pushConversation", { ...input, quietSec: window.quietSec }, { jobId: `chatpush-${input.conversationId}-${bucket}`, delayMs: (bucket + 2) * window.windowMs - now });
}

/** Queues a push about something other than a message, once `db`'s work has committed. */
export async function queuePushEvent(ctx: AppContext, db: DbClient, event: JobPayloads["chat.pushEvent"]): Promise<void> {
  await afterCommit(ctx, db, () => ctx.jobs.enqueue("chat.pushEvent", event));
}

/**
 * Queues the push to members just invited to a group, once `db`'s work has committed. Every invitation written goes in,
 * held back or not, so queueing it can't show the inviter which was which: the job pushes only those their invitee can see.
 */
export async function queueGroupInvitePush(ctx: AppContext, db: DbClient, input: JobPayloads["chat.pushGroupInvite"]): Promise<void> {
  if (input.inviteeMembershipIds.length === 0) return;
  await afterCommit(ctx, db, () => ctx.jobs.enqueue("chat.pushGroupInvite", input));
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
  /** Defaults to a direct chat's. */
  pushWindow?: ChatPushWindow;
  /** No push for this message, because the caller is telling them another way. */
  noPush?: boolean;
  /**
   * Moves the sender's read position up to this message, as writing it means they've read the thread. By default only for
   * a message they wrote: a system line written in their name, like the one saying they're now a group's owner, mustn't mark
   * everything they haven't read as read.
   */
  advancesRead?: boolean;
}

/**
 * Adds a message to a conversation the caller has locked, inside the caller's transaction, and delivers it once that
 * commits. Never opens a transaction or touches ctx.db: nested sends doing that could freeze the whole pool.
 */
export async function appendMessage(ctx: AppContext, tx: Tx, input: AppendInput): Promise<ChatMessageRow> {
  const { conversation, sender, tenantSlug } = input;
  const senderId = sender?.id ?? null;
  const kind = input.kind ?? "TEXT";
  const readsThread = !!senderId && (input.advancesRead ?? kind === "TEXT");
  const row = await insertNextMessage(tx, {
    tenantId: conversation.tenantId,
    conversationId: conversation.id,
    senderMembershipId: senderId,
    kind,
    body: input.body,
    meta: input.meta ?? null,
    clientKey: input.clientKey ?? null,
    withheld: input.withheld ?? false,
    createdAt: new Date(),
  });
  if (readsThread && senderId) await updateParticipant(tx, conversation.id, senderId, { lastReadSeq: row.seq });
  // Whoever can see this has news again. Anyone it's withheld from stays where they were.
  await thawParticipants(tx, conversation.id, input.withheld ? senderId : undefined);

  const recipients = await chatRecipients(tx, conversation.id, { actorMembershipId: senderId });
  const own = recipients.filter((r) => r.membershipId === senderId);
  const others = input.withheld ? [] : recipients.filter((r) => r.membershipId !== senderId);
  await afterCommit(ctx, tx, async () => {
    const payload = (viewer: string | null) => ({ tenantSlug, conversationId: conversation.id, message: toChatMessageDto(row, sender, viewer) });
    if (own.length > 0) ctx.realtime.emit(toRooms(own), "chat:message", payload(senderId));
    if (others.length === 0) return;
    const ids = { tenantId: conversation.tenantId, conversationId: conversation.id };
    if (input.isRequest) {
      ctx.realtime.emit(toRooms(others), "chat:changed", { tenantSlug, conversationId: conversation.id });
      if (!input.noPush) await ctx.jobs.enqueue("chat.pushEvent", { ...ids, kind: "CHAT_REQUEST", actorMembershipId: senderId });
    } else {
      ctx.realtime.emit(toRooms(others), "chat:message", payload(null));
      if (!input.noPush) await queueConversationPush(ctx, ids, input.pushWindow);
    }
  });
  // Writing a message reads the thread, as the read position above says, so the next one from the other side is news again.
  if (readsThread && senderId) await afterCommit(ctx, tx, () => ctx.redis.del(keys.chatPushQuiet(conversation.id, senderId)));
  return row;
}
