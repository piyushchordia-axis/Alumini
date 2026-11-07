import type { ChatConversationDto } from "../types/dto";
import { rerequestOpenedText } from "./labels";

const DAY_MS = 86_400_000;

/** How long after the date to ask again a thread that still can't send is fetched once more: the device's clock may be ahead of the server's. */
export const REREQUEST_RECHECK_MS = 30_000;

type WatchedThread = Pick<ChatConversationDto, "group" | "peer" | "blockedByMe" | "state" | "canSend" | "canRerequestAt">;

/**
 * How long until a thread that can't send yet is worth fetching again to find the box open: a second after its date to ask
 * again, while that's at most a day away (a timer for longer would only wait, and could overflow). Null when there's
 * nothing to wait for.
 */
export function rerequestRefetchIn(c: WatchedThread, now: Date): number | null {
  if (c.canSend || c.group || !c.peer || c.blockedByMe || !c.canRerequestAt) return null;
  const ms = new Date(c.canRerequestAt).getTime() - now.getTime();
  return ms > 0 && ms <= DAY_MS ? ms + 1000 : null;
}

/** The time to draw a thread's footer at: the minute clock, or the moment the date to ask again went by if that's later, so the date's line goes at once. */
export const rerequestDrawAt = (now: Date, passedAt: Date | null): Date => (passedAt && passedAt > now ? passedAt : now);

export interface RerequestWatchOptions {
  /** Fetches the thread again, answering with what it found. */
  refetch: () => Promise<{ data?: ChatConversationDto } | undefined>;
  /** Says the box is back, when a fetch of the watch's own finds the thread can send. */
  announce: (text: string) => void;
  /** The moment the date went by, by this device's clock, for `rerequestDrawAt`. */
  passed: (at: Date) => void;
}

export interface RerequestWatch {
  /** Each thread the screen draws, with the minute clock. */
  update(c: WatchedThread | undefined, now: Date): void;
  stop(): void;
}

/**
 * Brings the box back by itself in a thread left open past its date to ask again, on both apps. From the first update
 * within a day of the date, it sets a timer for a second after it. Then it says the date has gone (`passed`), fetches the
 * thread, and fetches it once more 30 seconds later unless an update that can send, or with another date, has stopped it
 * first. An answer to its own fetches that can send is announced. It reads the thread's DTO alone, as the footer does, so it
 * does the same whether a request is waiting, declined or met by a block.
 */
export function watchRerequest(opts: RerequestWatchOptions): RerequestWatch {
  let armedFor: string | null = null;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let stopped = false;
  const clear = () => {
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
  };
  const fetchAgain = async () => {
    const answer = await opts.refetch().catch(() => undefined);
    const text = answer?.data?.canSend ? rerequestOpenedText(answer.data) : null;
    if (text && !stopped) opts.announce(text);
  };
  return {
    update(c, now) {
      if (stopped) return;
      const at = c?.canRerequestAt ?? null;
      // The box is back, or the thread has another date or none: the timer set for this one has nothing left to do.
      if (armedFor !== null && (!c || c.canSend || at !== armedFor)) {
        clear();
        armedFor = null;
      }
      // Set once for a date, and kept as the minute clock passes it, which would otherwise stop it before it fires.
      if (!c || !at || at === armedFor || rerequestRefetchIn(c, now) === null) return;
      armedFor = at;
      timers.push(
        setTimeout(
          () => {
            opts.passed(new Date());
            // Set before the fetch, so an answer that can send, however soon it comes, clears it.
            timers.push(setTimeout(() => void fetchAgain(), REREQUEST_RECHECK_MS));
            void fetchAgain();
          },
          Math.max(new Date(at).getTime() - Date.now(), 0) + 1000,
        ),
      );
    },
    stop() {
      stopped = true;
      clear();
    },
  };
}
