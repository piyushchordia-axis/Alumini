import { CHAT_MAX_REQUESTS_PER_PAIR, CHAT_REREQUEST_AFTER_DAYS, isCurrentPupil, resolveFeatures, type ChatConversationDto, type ChatConversationKind, type ChatThreadState, type TenantFeatures } from "@illuminize/shared";
import type { DbClient } from "../../db/client";
import { AppError } from "../../lib/errors";
import type { ConversationRow, ParticipantRow, ThreadRow } from "../../repositories/chat.repo";
import { findTenantWithSettingsById } from "../../repositories/tenants.repo";
import type { TenantContext, TenantRow } from "../../types/request";

export type ChatTenant = TenantRow & { features: TenantFeatures };

const DAY_MS = 24 * 60 * 60 * 1000;

export function chatTenantOf(tenantCtx: TenantContext): ChatTenant {
  return { ...tenantCtx.tenant, features: resolveFeatures(tenantCtx.tenant.type, tenantCtx.settings.features) };
}

/** The institution as it is right now, for anything that sends: the request's copy can be 300 seconds old. */
export async function freshChatTenant(db: DbClient, tenantId: string): Promise<ChatTenant> {
  const row = await findTenantWithSettingsById(db, tenantId);
  if (!row || row.tenant.status !== "ACTIVE") throw AppError.forbidden("This institution is not active", "TENANT_INACTIVE");
  return { ...row.tenant, features: resolveFeatures(row.tenant.type, row.settings.features) };
}

/** Which conversation kinds this institution has switched on. Groups arrive with their own feature. */
export function enabledKinds(features: TenantFeatures): ChatConversationKind[] {
  return features.messaging ? ["DIRECT"] : [];
}

export function assertKindEnabled(features: TenantFeatures, kind: ChatConversationKind): void {
  if (!enabledKinds(features).includes(kind)) throw AppError.forbidden("Messaging is switched off for this institution", "FEATURE_DISABLED");
}

export function peerIdOf(conversation: Pick<ConversationRow, "directLowId" | "directHighId">, membershipId: string): string | null {
  return conversation.directLowId === membershipId ? conversation.directHighId : conversation.directLowId;
}

/** Whether a member can be reached at all. A block doesn't come into it, because this decides what their contacts are told. */
export function isReachable(tenant: Pick<TenantRow, "type" | "timezone">, member: { status: string; batchYear: number; dateOfBirth: string | null } | null | undefined): boolean {
  return !!member && member.status === "APPROVED" && !isCurrentPupil(tenant, member);
}

export const contactUnavailable = () => AppError.conflict("This member can't be contacted", "CONTACT_UNAVAILABLE");
export const blockedByYou = () => AppError.conflict("Unblock this member to send them a message", "CHAT_BLOCKED_BY_YOU");
/** The same words for every reason, because a different refusal would give a decline away. */
export const requestPending = () => AppError.conflict("You can't send more in this conversation yet", "CHAT_REQUEST_PENDING");

/**
 * The thread as this member believes it stands. Normally that's the conversation row. A send withheld from the other member
 * leaves that row alone, because the blocker reads it, and its sender's copy moves on here instead, so they see exactly what
 * they'd see if nothing were wrong.
 */
export function asSeenBy(conversation: ConversationRow, participant: Pick<ParticipantRow, "membershipId" | "withheldState" | "withheldRequestedAt" | "withheldRequestCount">): ConversationRow {
  if (!participant.withheldState) return conversation;
  if (participant.withheldState === "ACCEPTED") return { ...conversation, directState: "ACCEPTED" };
  return { ...conversation, directState: participant.withheldState, origin: "MESSAGE_REQUEST", originId: null, requesterMembershipId: participant.membershipId, requestedAt: participant.withheldRequestedAt, requestCount: participant.withheldRequestCount ?? 0 };
}

/**
 * When this member may next ask, or null if they've used their requests. Depends only on `requested_at` and
 * `request_count`, which is what keeps a decline or a block from showing.
 */
export function nextRequestAt(conversation: Pick<ConversationRow, "requesterMembershipId" | "requestedAt" | "requestCount" | "lastMessageAt">, membershipId: string): Date | null {
  if (conversation.requesterMembershipId === membershipId && conversation.requestCount >= CHAT_MAX_REQUESTS_PER_PAIR) return null;
  return new Date((conversation.requestedAt ?? conversation.lastMessageAt).getTime() + CHAT_REREQUEST_AFTER_DAYS * DAY_MS);
}

/** What a send does in this thread. REQUEST: asks (again). ACCEPT: answers their request by replying. WAIT: refused. */
export type SendPlan = "SEND" | "REQUEST" | "ACCEPT" | "WAIT";

export function planSend(conversation: ConversationRow, membershipId: string, now: Date): SendPlan {
  const mayAskAgain = () => {
    const at = nextRequestAt(conversation, membershipId);
    return at !== null && now >= at;
  };
  switch (conversation.directState) {
    case "ACCEPTED":
      return "SEND";
    case "PENDING":
    case "DECLINED":
      if (conversation.requesterMembershipId !== membershipId) return "ACCEPT";
      return mayAskAgain() ? "REQUEST" : "WAIT";
    case "CLOSED":
      return mayAskAgain() ? "REQUEST" : "WAIT";
    default:
      return "WAIT";
  }
}

function threadState(conversation: ConversationRow, membershipId: string): ChatThreadState {
  switch (conversation.directState) {
    case "ACCEPTED":
      return "ACCEPTED";
    case "CLOSED":
      return "CLOSED";
    default:
      if (conversation.requesterMembershipId === membershipId) return "REQUEST_SENT";
      return conversation.directState === "PENDING" ? "REQUEST_RECEIVED" : "REQUEST_DECLINED";
  }
}

export const unreadOf = (conversation: Pick<ConversationRow, "lastSeq">, participant: Pick<ParticipantRow, "lastReadSeq" | "frozenSortAt">): number => (participant.frozenSortAt ? 0 : Math.max(conversation.lastSeq - participant.lastReadSeq, 0));

/** Everything about a thread that depends on who's asking, and when. */
export function threadView(tenant: Pick<TenantRow, "type" | "timezone">, row: ThreadRow, now: Date): Pick<ChatConversationDto, "origin" | "state" | "canSend" | "canRerequestAt" | "blockedByMe" | "unread" | "lastReadSeq" | "mutedUntil" | "lastMessageAt"> {
  const { participant, peer } = row;
  const me = participant.membershipId;
  const conversation = asSeenBy(row.conversation, participant);
  const state = threadState(conversation, me);
  const plan = planSend(conversation, me, now);
  // Only worth saying where a send is refused until later: elsewhere it would be a date with no meaning, and a thread whose other member is gone has no later.
  const waits = (state === "REQUEST_SENT" || state === "CLOSED") && !!peer;
  const blockedByMe = !!row.blockedByMe;
  return {
    origin: conversation.origin,
    state,
    canSend: plan !== "WAIT" && !blockedByMe && isReachable(tenant, peer),
    canRerequestAt: waits ? (nextRequestAt(conversation, me)?.toISOString() ?? null) : null,
    blockedByMe,
    unread: unreadOf(conversation, participant),
    lastReadSeq: participant.lastReadSeq,
    mutedUntil: participant.mutedUntil?.toISOString() ?? null,
    lastMessageAt: (participant.frozenSortAt ?? conversation.lastMessageAt).toISOString(),
  };
}
