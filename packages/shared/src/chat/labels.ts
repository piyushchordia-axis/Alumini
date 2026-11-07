import { BLOCKED_MEMBER_NAME, DELETED_MEMBER_NAME, type TenantFeatures } from "../constants";
import { memberYearsLabel } from "../lib/memberYears";
import type { ChatConversationDto, ChatGroupDto, ChatMemberDto, ChatMessageDto } from "../types/dto";
import { composerAttachCaption, messagePreviewText } from "./attachments";

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
 * What a thread, or the screen writing a first message, says when a send was turned away for going too fast, which puts
 * the words back to send again: the member's own limit, or a busy group's, which isn't theirs to slow down for. Null for
 * any other failure, which the caller words itself.
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

/**
 * The other member's years in a direct thread, which an inbox row shows after their name, since the preview has the line
 * below. Nothing for a group, or for a member who deleted their account.
 */
export const peerYears = (c: Pick<ChatConversationDto, "peer" | "group">) => (c.group || !c.peer ? "" : memberYearsLabel(c.peer));

/** The grey line under the other member's name in a direct thread's header: their years, and Muted while it is. */
export const directThreadSubtitle = (c: Pick<ChatConversationDto, "peer" | "group">, muted: boolean) => [peerYears(c), muted && "Muted"].filter(Boolean).join(" · ");

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
 * wrote it, and a blocked member's words never show. Photos and files read as "Photo", "File: {name}" and the like, before
 * any words with them, and never as an address.
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
    return last.body === null ? REMOVED : `${who}: ${messagePreviewText(last.body, last.attachments)}`;
  }
  const text = last.body === null ? REMOVED : messagePreviewText(last.body, last.attachments);
  return last.mine ? `You: ${text}` : text;
}

/**
 * When a request can be sent again, as a thread's footer says it: "6:40 pm today", "6:40 pm tomorrow", otherwise the day
 * and date ("Fri, 4 Dec"), with the year when it isn't this one. Written with formatChatTime's Intl options only, which the
 * phone's Hermes has. `now` comes from the caller, because a render can't read the clock.
 */
export function formatRerequestAt(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = () => new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
  if (at.toDateString() === now.toDateString()) return `${time()} today`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (at.toDateString() === tomorrow.toDateString()) return `${time()} tomorrow`;
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(at);
  const date = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", ...(at.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(at);
  return `${weekday}, ${date}`;
}

/** A footer's line saying when a request can be sent again: `lead`, the date (`at`, emphasised, for `iso`), then `tail`, read as one sentence. */
export interface RerequestLine {
  lead: string;
  at: string;
  tail: string;
  iso: string;
}

/** What a footer panel offers, which each app draws as its own buttons. */
export type ThreadFooterAction = "UNBLOCK" | "ANSWER_REQUEST" | "ACCEPT_DECLINED";

/**
 * What goes under a thread: the message box, with an intro when sending asks again and a caption where photos and files
 * can't be added (composerAttachCaption), or a panel saying why there's no box. Everything the composer says to a
 * requester belongs here, so the tests comparing a waiting, a declined and a blocked request cover it.
 */
export type ThreadFooter =
  | { kind: "composer"; intro: string | null; attachCaption: string | null }
  | { kind: "panel"; title: string; text: string; when: RerequestLine | null; action: ThreadFooterAction | null };

type FooterThread = Pick<ChatConversationDto, "group" | "peer" | "blockedByMe" | "state" | "canSend" | "canAttach" | "canRerequestAt">;

const panel = (title: string, text: string, extra: { when?: RerequestLine | null; action?: ThreadFooterAction } = {}): ThreadFooter => ({ kind: "panel", title, text, when: extra.when ?? null, action: extra.action ?? null });

/** The date to ask again, while it's still to come: once it has passed, the line goes rather than show a date gone by. */
function rerequestLine(c: FooterThread, now: Date, lead: string, tail: string): RerequestLine | null {
  if (!c.canRerequestAt || new Date(c.canRerequestAt).getTime() <= now.getTime()) return null;
  return { lead, at: formatRerequestAt(c.canRerequestAt, now), tail, iso: c.canRerequestAt };
}

/**
 * A thread's footer on both apps, from its DTO and the clock alone, so what a requester reads can't differ between a
 * request waiting, declined or met by a block. An owner's group that can't send says why from `group`'s review, which
 * only its owner gets. `features`, once the institution's are known, lets the attach caption name the switch wherever
 * it's off; they're the institution's, the same for every member.
 */
export function threadFooter(c: FooterThread, now: Date, group?: Pick<ChatGroupDto, "review"> | null, features?: Pick<TenantFeatures, "chatAttachments"> | null): ThreadFooter {
  const name = conversationTitle(c);
  const composer = (intro: string | null): ThreadFooter => ({ kind: "composer", intro, attachCaption: composerAttachCaption(c, features, name) });
  if (c.group) {
    if (c.canSend) return composer(null);
    if (c.group.archived) return panel("This group has been archived", "You can read it, but nobody can send messages in it any more.");
    switch (group?.review?.moderationStatus) {
      case "PENDING":
        return panel("Waiting for an admin to approve this group", "Nobody else can see it yet. Messages can be sent once it's approved.");
      case "REJECTED":
        return panel("An admin didn't approve this group", "Members can't see it, and nobody can send messages in it. You can edit it from Group details and send it for review again.");
      case "REMOVED":
        return panel("An admin removed this group", "Members can't see it, and nobody can send messages in it.");
      default:
        return panel("You can't send messages here right now", "You can still read the conversation.");
    }
  }
  if (!c.peer) return panel("This member deleted their account", "You can read the conversation, but not reply.");
  if (c.blockedByMe) return panel(`You blocked ${name}`, "Unblock them to send messages. Anything they sent while blocked stays hidden.", { action: "UNBLOCK" });
  switch (c.state) {
    case "REQUEST_RECEIVED":
      return panel(`${name} wants to send you a message`, "Accept to reply. If you decline, they won't be told.", { action: "ANSWER_REQUEST" });
    case "REQUEST_DECLINED":
      return panel("You declined this request", `${name} hasn't been told.`, { action: "ACCEPT_DECLINED" });
    case "REQUEST_SENT":
      if (c.canSend) return composer(`Your next message asks ${name} again, as a new request.`);
      return panel("Request sent", `You can send more once ${name} accepts.`, { when: rerequestLine(c, now, "You can ask again from ", " if they haven't accepted by then.") });
    case "CLOSED": {
      if (c.canSend) return composer(`This conversation has closed. Sending a message asks ${name} to chat again.`);
      // Read-only only when its requests are used up. A date gone by while the answer still can't send (as the box is
      // about to come back, or with a clock ahead of the server's) loses its line, but not the promise of one.
      const when = rerequestLine(c, now, "You can send a new request from ", ".");
      return panel("This conversation has closed", c.canRerequestAt ? "You can still read it." : "You can read it, but not reply.", { when });
    }
    case "ACCEPTED":
      if (c.canSend) return composer(null);
      return panel(`You can't message ${name} right now`, "You can still read the conversation.");
  }
}

/** What a thread says when its box comes back while it's open, because the date to ask again has come. */
export function rerequestOpenedText(c: Pick<ChatConversationDto, "state" | "peer" | "group">): string | null {
  if (c.group || !c.peer) return null;
  if (c.state === "REQUEST_SENT") return `You can ask ${peerName(c.peer)} again now.`;
  if (c.state === "CLOSED") return `You can send ${peerName(c.peer)} a new request now.`;
  return null;
}

/** The note on the screen writing a first message: a title, what happens to the message, and a tip for writing it. */
export interface FirstMessageNotice {
  title: string;
  text: string;
  tip: string;
}

/**
 * What the screen writing a first message says above the box, on both apps: that it goes as a request, said as a welcome
 * rather than a warning, with nothing about a decline or the limits on asking again, which only matter once there's a
 * problem. `name` is the other member's full name; until it's known (or with the directory off), "this member".
 */
export function firstMessageNotice(name: string | null | undefined): FirstMessageNotice {
  return {
    title: `Say hello to ${name || "this member"}`,
    text: "Your first message arrives as a request, and you can send more once they accept.",
    tip: "A line about who you are and why you're getting in touch helps them say hello back.",
  };
}
