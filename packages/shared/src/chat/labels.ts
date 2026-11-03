import { BLOCKED_MEMBER_NAME, DELETED_MEMBER_NAME } from "../constants";
import type { ChatConversationDto, ChatGroupDto, ChatMemberDto, ChatMessageDto } from "../types/dto";

/** Who a thread or a message is with. Null means they deleted their account. */
export const peerName = (peer: ChatMemberDto | null | undefined) => peer?.fullName ?? DELETED_MEMBER_NAME;

/** Who wrote a message, as a group thread names them: what stands in for someone this member blocked, or for an account that's gone. */
export const messageSenderName = (message: Pick<ChatMessageDto, "sender" | "redacted">) => (message.redacted ? BLOCKED_MEMBER_NAME : peerName(message.sender));

/**
 * A group's system line, read on from the member it's about. Its text is fixed and names nobody ("joined the group"), so the
 * name goes in front, and for the member themselves "You", with the verb to match ("You are now the group's owner").
 */
export function systemLineText(message: Pick<ChatMessageDto, "sender" | "redacted" | "body">, mine: boolean): string {
  const text = message.body ?? "";
  if (mine) return `You ${text.replace(/^is /, "are ").replace(/^was /, "were ")}`.trim();
  return `${messageSenderName(message)} ${text}`.trim();
}

/**
 * What blocking does, said before it's done, on both apps: a direct message sent while blocked never arrives, even after an
 * unblock, while in a group a blocked member's messages are only hidden for as long as the block lasts.
 */
export const BLOCK_EXPLAINED =
  "They won't be told. Nothing they send you directly while blocked will reach you, even if you unblock them later. In groups, their messages are hidden from you while they're blocked. You can unblock them from Blocked members in Messages.";

/** The same, at the top of Blocked members. */
export const BLOCKED_LIST_EXPLAINED =
  "Blocked members aren't told. Nothing they send you directly reaches you, and unblocking doesn't bring back what they sent while blocked. In groups, their messages show again once you unblock them.";

/**
 * What a thread says when a send was turned away for going too fast, which puts the words back to send again: the member's
 * own limit, or a busy group's, which isn't theirs to slow down for. Null for any other failure.
 */
export function sendLimitNotice(code: string | null | undefined): string | null {
  if (code === "RATE_LIMITED") return "You're sending messages quickly. Wait a moment, then send again.";
  if (code === "CHAT_GROUP_BUSY") return "This group is very busy right now. Try again in a moment.";
  return null;
}

/**
 * What leaving a group does, said before it's done, the same on both apps. For an owner, what becomes of the group: it
 * passes to whoever has been in longest, with their changes waiting for review dropped, or it's archived when nobody could
 * take it over.
 */
export function groupLeaveText(g: Pick<ChatGroupDto, "visibility" | "archived" | "isOwner" | "memberCount" | "review">): string {
  const rejoin = g.visibility === "OPEN" && !g.archived ? "You can join again from Discover." : "You'd need a new invitation to come back.";
  if (g.archived) return "It's archived, so you won't be able to read it again.";
  if (!g.isOwner) return rejoin;
  if (g.review && !g.review.shownToMembers) return "Members can't see it now, so nobody can take it over: leaving archives it.";
  if (g.memberCount <= 1) return "You're the only one in it, so leaving archives it.";
  const dropped = g.review?.moderationStatus === "PENDING" ? " Your changes waiting for review are dropped." : "";
  return `The member who has been in it longest becomes its owner.${dropped} ${rejoin}`;
}

/** What an inbox row or a thread header is called: a group's name, or the other member's. */
export const conversationTitle = (c: Pick<ChatConversationDto, "peer" | "group">) => c.group?.name ?? peerName(c.peer);

/** Muted right now. "Until I turn it back on" is a far-future date, so it reads as muted like any other. */
export const isMuted = (conversation: Pick<ChatConversationDto, "mutedUntil">, now: Date) => !!conversation.mutedUntil && new Date(conversation.mutedUntil) > now;

/**
 * A time in a list of conversations: the time today, then "Yesterday", the weekday this week, otherwise the date. `now`
 * comes from the caller, because a render can't read the clock.
 */
export function formatChatTime(iso: string, now: Date): string {
  const at = new Date(iso);
  if (at.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (at.toDateString() === yesterday.toDateString()) return "Yesterday";
  const days = (now.getTime() - at.getTime()) / 86_400_000;
  if (days < 6) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(at);
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(at);
}

const REMOVED = "This message was removed";

/**
 * What an inbox row says under the name. A request's own words show only once it's opened. A group's preview says who
 * wrote it, and a blocked member's words never show.
 */
export function conversationPreview(c: Pick<ChatConversationDto, "state" | "lastMessage" | "group">): string {
  if (c.state === "REQUEST_SENT") return "Request sent";
  if (c.state === "REQUEST_RECEIVED") return "Wants to send you a message";
  if (c.state === "REQUEST_DECLINED") return "Request declined";
  const last = c.lastMessage;
  if (!last) return c.state === "CLOSED" ? "Conversation closed" : "";
  if (c.group) {
    if (last.kind === "SYSTEM") return systemLineText(last, last.mine);
    if (last.redacted) return "Message from a blocked member";
    const who = last.mine ? "You" : peerName(last.sender);
    return last.body === null ? REMOVED : `${who}: ${last.body}`;
  }
  const text = last.body ?? REMOVED;
  return last.mine ? `You: ${text}` : text;
}
