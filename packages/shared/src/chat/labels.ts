import { DELETED_MEMBER_NAME } from "../constants";
import type { ChatConversationDto, ChatMemberDto } from "../types/dto";

/** Who a thread or a message is with. Null means they deleted their account. */
export const peerName = (peer: ChatMemberDto | null | undefined) => peer?.fullName ?? DELETED_MEMBER_NAME;

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

/** What an inbox row says under the name. A request's own words show only once it's opened. */
export function conversationPreview(c: Pick<ChatConversationDto, "state" | "lastMessage">): string {
  if (c.state === "REQUEST_SENT") return "Request sent";
  if (c.state === "REQUEST_RECEIVED") return "Wants to send you a message";
  if (c.state === "REQUEST_DECLINED") return "Request declined";
  const last = c.lastMessage;
  if (!last) return c.state === "CLOSED" ? "Conversation closed" : "";
  const text = last.body ?? "This message was removed";
  return last.mine ? `You: ${text}` : text;
}
