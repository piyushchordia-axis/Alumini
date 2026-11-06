import { SECTION_LABELS, type MemberSection } from "../lib/sections";
import type { ChatBadgeDto } from "../types/dto";

const HOUR_MS = 60 * 60 * 1000;

export type ChatMuteOption = "HOURS_8" | "WEEK_1" | "UNTIL_TURNED_ON";

/** In the order both apps offer them. */
export const CHAT_MUTE_OPTIONS: ReadonlyArray<{ value: ChatMuteOption; label: string }> = [
  { value: "HOURS_8", label: "8 hours" },
  { value: "WEEK_1", label: "1 week" },
  { value: "UNTIL_TURNED_ON", label: "Until I turn it back on" },
];

/** A date past any real conversation's life, because `until: null` is how a member unmutes. */
const FOREVER = "9999-12-31T00:00:00.000Z";

/** The `until` to send for a choice. `now` comes from the caller, because a render can't read the clock. */
export function chatMuteUntil(option: ChatMuteOption, now: Date): string {
  switch (option) {
    case "HOURS_8":
      return new Date(now.getTime() + 8 * HOUR_MS).toISOString();
    case "WEEK_1":
      return new Date(now.getTime() + 7 * 24 * HOUR_MS).toISOString();
    case "UNTIL_TURNED_ON":
      return FOREVER;
  }
}

/** Whether a mute is the "until I turn it back on" kind, which a screen describes without a date. */
export function isMutedUntilTurnedOn(until: string | null | undefined): boolean {
  return !!until && new Date(until).getUTCFullYear() >= new Date(FOREVER).getUTCFullYear();
}

export interface ChatBadgeLabel {
  /** What the badge counts, or 0 when there's nothing to show. */
  count: number;
  /** The accessible name of the link or tab it sits on. */
  label: string;
}

/** The Messages badge, the same on both apps: threads with something unread plus requests waiting. */
export function chatBadgeLabel(badge: ChatBadgeDto | undefined): ChatBadgeLabel {
  const count = (badge?.unread ?? 0) + (badge?.requests ?? 0);
  const name = SECTION_LABELS.messages;
  return { count, label: count > 0 ? `${name}, ${count} unread` : name };
}

/** The Groups badge, the same on both apps: invitations waiting for an answer. */
export function groupsBadgeLabel(badge: ChatBadgeDto | undefined): ChatBadgeLabel {
  const count = badge?.invites ?? 0;
  const name = SECTION_LABELS.groups;
  return { count, label: count > 0 ? `${name}, ${count} ${count === 1 ? "invitation" : "invitations"}` : name };
}

/** The badges sections have, the same on every bar, sidebar and More: unread chats on Messages, invitations on Groups. */
export function sectionBadges(badge: ChatBadgeDto | undefined): Partial<Record<MemberSection, ChatBadgeLabel>> {
  return { messages: chatBadgeLabel(badge), groups: groupsBadgeLabel(badge) };
}

/**
 * The badge on More: a section behind it has its badge there, so More adds them up and its name says what's inside, such
 * as "More, Groups, 1 invitation". Only `overflow` counts, because a section on the bar shows its own.
 */
export function moreBadgeLabel(overflow: readonly MemberSection[], badges: Partial<Record<MemberSection, ChatBadgeLabel>>): ChatBadgeLabel {
  const inside = overflow.map((s) => badges[s]).filter((b): b is ChatBadgeLabel => !!b && b.count > 0);
  const count = inside.reduce((sum, b) => sum + b.count, 0);
  return { count, label: count > 0 ? ["More", ...inside.map((b) => b.label)].join(", ") : "More" };
}

/**
 * What's left to send after `sent` went, when the member kept typing while a first message was on its way. The composer
 * sends the trimmed text, so a draft that still begins with it has the rest after it. One that doesn't was changed, and is
 * kept whole rather than guessed at.
 */
export function unsentRemainder(draft: string, sent: string): string {
  if (draft.trim() === sent || !draft.trim()) return "";
  const start = draft.trimStart();
  return start.startsWith(sent) ? start.slice(sent.length).trim() : draft;
}
