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
  /** Threads with something unread plus requests waiting, or 0 when there's nothing to show. */
  count: number;
  /** The accessible name of the Messages link or tab. */
  label: string;
}

/** The Messages badge, the same on both apps. */
export function chatBadgeLabel(badge: ChatBadgeDto | undefined): ChatBadgeLabel {
  const count = (badge?.unread ?? 0) + (badge?.requests ?? 0);
  return { count, label: count > 0 ? `Messages, ${count} unread` : "Messages" };
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
