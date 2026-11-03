import {
  CHAT_GROUP_INVITE_TTL_DAYS,
  CHAT_MAX_REQUESTS_PER_PAIR,
  CHAT_REREQUEST_AFTER_DAYS,
  enabledGroupVisibilities,
  isCurrentPupil,
  resolveFeatures,
  type ChatConversationDto,
  type ChatConversationGroupDto,
  type ChatGroupVisibility,
  type ChatThreadState,
  type TenantFeatures,
} from "@illuminize/shared";
import type { DbClient } from "../../db/client";
import { AppError } from "../../lib/errors";
import { GROUP_KIND_OF, type ChatGroupRow, type ChatThreadKind, type ConversationRow, type ParticipantRow, type ThreadRow } from "../../repositories/chat.repo";
import { findTenantWithSettingsById } from "../../repositories/tenants.repo";
import type { TenantContext, TenantRow } from "../../types/request";

export type ChatTenant = TenantRow & { features: TenantFeatures };
export type { ChatThreadKind };

const DAY_MS = 24 * 60 * 60 * 1000;

export function chatTenantOf(tenantCtx: TenantContext): ChatTenant {
  return { ...tenantCtx.tenant, features: resolveFeatures(tenantCtx.tenant.type, tenantCtx.settings.features) };
}

/** The institution as it is right now, for anything that sends: the request's copy can be 300 seconds old. */
export async function freshChatTenant(db: DbClient, tenantId: string): Promise<ChatTenant> {
  const tenant = await chatTenantById(db, tenantId);
  if (tenant.status !== "ACTIVE") throw AppError.forbidden("This institution is not active", "TENANT_INACTIVE");
  return tenant;
}

/** The institution as it is now, whatever its status, for what has to happen even in a suspended one, like an account's deletion. */
export async function chatTenantById(db: DbClient, tenantId: string): Promise<ChatTenant> {
  const row = await findTenantWithSettingsById(db, tenantId);
  if (!row) throw AppError.forbidden("This institution is not active", "TENANT_INACTIVE");
  return { ...row.tenant, features: resolveFeatures(row.tenant.type, row.settings.features) };
}

/**
 * Which kinds of thread this institution has switched on. Direct threads need `messaging`, open groups `groups`, and
 * invite-only groups both, because an invite-only group of two is a private chat.
 */
export function enabledKinds(features: TenantFeatures): ChatThreadKind[] {
  return [...(features.messaging ? (["DIRECT"] as const) : []), ...enabledGroupVisibilities(features).map((v) => GROUP_KIND_OF[v])];
}

export function threadKindOf(conversation: Pick<ConversationRow, "kind">, group: Pick<ChatGroupRow, "visibility"> | null): ChatThreadKind {
  if (conversation.kind === "DIRECT") return "DIRECT";
  if (!group) throw new Error("A group conversation without its group");
  return GROUP_KIND_OF[group.visibility];
}

const KIND_OFF: Record<ChatThreadKind, string> = {
  DIRECT: "Messaging is switched off for this institution",
  OPEN_GROUP: "Groups are switched off for this institution",
  INVITE_ONLY_GROUP: "Invite-only groups need messaging, which is switched off for this institution",
};

export function assertKindEnabled(features: TenantFeatures, kind: ChatThreadKind): void {
  if (!enabledKinds(features).includes(kind)) throw AppError.forbidden(KIND_OFF[kind], "FEATURE_DISABLED");
}

export function assertGroupEnabled(features: TenantFeatures, visibility: ChatGroupVisibility): void {
  assertKindEnabled(features, GROUP_KIND_OF[visibility]);
}

// --- Groups ---

/** Members may see it: an admin approved it and hasn't since rejected or removed it. An edit waiting for review leaves it so. */
export const isGroupLive = (g: Pick<ChatGroupRow, "approvedAt" | "moderationStatus">): boolean => !!g.approvedAt && (g.moderationStatus === "APPROVED" || g.moderationStatus === "PENDING");

/** Messages can be sent in it. An archived group, or one moderation has frozen or not yet let out, is read-only. */
export const groupSendable = (g: Pick<ChatGroupRow, "approvedAt" | "moderationStatus" | "archivedAt">): boolean => isGroupLive(g) && !g.archivedAt;

/**
 * Who may invite: the owner, or in an open group anyone in it. Never while an edit waits for review, because inviting is how
 * a group grows, and never once it's archived.
 */
export const mayInvite = (g: Pick<ChatGroupRow, "moderationStatus" | "archivedAt" | "visibility">, isOwner: boolean): boolean => g.moderationStatus === "APPROVED" && !g.archivedAt && (isOwner || g.visibility === "OPEN");

const INVITE_TTL_MS = CHAT_GROUP_INVITE_TTL_DAYS * DAY_MS;

/** The oldest invitation still counted as waiting at `now`. */
export const inviteCutoff = (now: Date): Date => new Date(now.getTime() - INVITE_TTL_MS);

/** An invitation waiting for an answer, delivered or not. */
export const inviteOutstanding = (p: Pick<ParticipantRow, "state" | "invitedAt">, now: Date): boolean => p.state === "INVITED" && !!p.invitedAt && p.invitedAt > inviteCutoff(now);

/** An invitation its invitee can see. */
export const inviteVisible = (p: Pick<ParticipantRow, "state" | "invitedAt" | "inviteSuppressed">, now: Date): boolean => inviteOutstanding(p, now) && !p.inviteSuppressed;

/**
 * The owner removed them and nobody has let them back in since. An invitation overwrites their state, so it's the separate
 * mark that says so, and only an invitation they can see gets them past it.
 */
export const wasRemoved = (p: Pick<ParticipantRow, "state" | "removedAt">): boolean => p.state === "REMOVED" || !!p.removedAt;

/**
 * Whether a member may know a group exists. Its owner always. Otherwise only while it's live: then anyone in it, and while
 * it isn't archived, anyone for an open group or the invitee of an invite-only one. Everyone else gets a 404, never a 403,
 * on every route, so an invite-only group can't be confirmed by asking about it.
 */
export function canSeeGroup(group: Pick<ChatGroupRow, "ownerMembershipId" | "approvedAt" | "moderationStatus" | "archivedAt" | "visibility">, participant: Pick<ParticipantRow, "state" | "invitedAt" | "inviteSuppressed"> | null | undefined, membershipId: string, now: Date): boolean {
  if (group.ownerMembershipId === membershipId) return true;
  if (!isGroupLive(group)) return false;
  if (participant?.state === "ACTIVE") return true;
  if (group.archivedAt) return false;
  return group.visibility === "OPEN" || (!!participant && inviteVisible(participant, now));
}

/**
 * The name a member sees: always the approved one, so unreviewed words never reach anyone but their author. The owner sees
 * their own until it has first been approved, which is the only time nobody else can see the group at all.
 */
export function shownGroupText(group: Pick<ChatGroupRow, "name" | "description" | "approvedName" | "approvedDescription">, isOwner: boolean): { name: string; description: string | null } {
  if (group.approvedName !== null) return { name: group.approvedName, description: group.approvedDescription };
  return isOwner ? { name: group.name, description: group.description } : { name: "", description: null };
}

export function toConversationGroupDto(group: ChatGroupRow, membershipId: string): ChatConversationGroupDto {
  const isOwner = group.ownerMembershipId === membershipId;
  return { name: shownGroupText(group, isOwner).name, visibility: group.visibility, memberCount: group.memberCount, archived: !!group.archivedAt, isOwner };
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
