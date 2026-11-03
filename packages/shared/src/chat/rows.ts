import { localTimeZone, wallPartsInZone } from "../lib/time";
import type { ThreadItem } from "./cache";

/** Messages from one sender run together when they're this close and on the same day. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

export type ChatRow =
  | { type: "day"; key: string; label: string }
  | {
      type: "message";
      key: string;
      item: ThreadItem;
      mine: boolean;
      /** First of a run from one sender, so it shows the name. */
      startsGroup: boolean;
      /** Last of a run from one sender, so it shows the time. */
      endsGroup: boolean;
      timeLabel: string;
    };

export interface GroupOptions {
  /** Defaults to the device's zone. */
  timeZone?: string;
  /** Defaults to the device's language. */
  locale?: string;
}

const dayNumber = (at: Date, timeZone: string) => {
  const { year, month, day } = wallPartsInZone(at, timeZone);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

function dayLabel(at: Date, now: Date, timeZone: string, locale: string | undefined): string {
  const days = dayNumber(now, timeZone) - dayNumber(at, timeZone);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const sameYear = wallPartsInZone(at, timeZone).year === wallPartsInZone(now, timeZone).year;
  return new Intl.DateTimeFormat(locale, { timeZone, day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) }).format(at);
}

const itemTime = (item: ThreadItem) => new Date(item.message?.createdAt ?? item.pending!.createdAt);

/** Who sent it, for grouping. A deleted member's messages never run together, because two deleted members would look like one. */
function senderOf(item: ThreadItem, myMembershipId: string): string | null {
  if (item.pending) return myMembershipId;
  return item.message.kind === "SYSTEM" ? null : (item.message.sender?.id ?? null);
}

/**
 * Builds a thread's rows, oldest first: a label at each new day, and each message marked as starting or ending a run from
 * one sender. `now` comes from the caller, because a render can't read the clock.
 */
export function groupMessages(items: ThreadItem[], myMembershipId: string, now: Date, options: GroupOptions = {}): ChatRow[] {
  const timeZone = options.timeZone ?? localTimeZone();
  const time = new Intl.DateTimeFormat(options.locale, { timeZone, hour: "numeric", minute: "2-digit" });
  const continues = (a: ThreadItem | undefined, b: ThreadItem | undefined) => {
    if (!a || !b) return false;
    const sender = senderOf(a, myMembershipId);
    if (sender === null || sender !== senderOf(b, myMembershipId)) return false;
    const [at, bt] = [itemTime(a), itemTime(b)];
    return bt.getTime() - at.getTime() <= GROUP_WINDOW_MS && dayNumber(at, timeZone) === dayNumber(bt, timeZone);
  };
  const rows: ChatRow[] = [];
  // A day can head the list twice: unconfirmed sends come after every server message, so one that failed yesterday follows
  // today's. Its second label gets its own key, and the first keeps the plain one, so loading older pages doesn't remount it.
  const daysSeen = new Map<number, number>();
  items.forEach((item, i) => {
    const at = itemTime(item);
    const previous = items[i - 1];
    const day = dayNumber(at, timeZone);
    if (!previous || dayNumber(itemTime(previous), timeZone) !== day) {
      const seen = daysSeen.get(day) ?? 0;
      daysSeen.set(day, seen + 1);
      rows.push({ type: "day", key: seen === 0 ? `day-${day}` : `day-${day}-${seen + 1}`, label: dayLabel(at, now, timeZone, options.locale) });
    }
    rows.push({
      type: "message",
      key: item.key,
      item,
      mine: senderOf(item, myMembershipId) === myMembershipId,
      startsGroup: !continues(previous, item),
      endsGroup: !continues(item, items[i + 1]),
      timeLabel: time.format(at),
    });
  });
  return rows;
}
