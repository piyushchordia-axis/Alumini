import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from "react";

/** Close enough to the bottom to count as reading the newest message. */
const PINNED_WITHIN_PX = 80;
/** Close enough to the top to fetch older messages before the member gets there. */
const LOAD_OLDER_WITHIN_PX = 200;

interface Options {
  /** The oldest and newest messages on screen, by row key. Day labels don't count, because older messages can join today's. */
  firstKey: string | undefined;
  lastKey: string | undefined;
  /** The newest message is the member's own, which always brings them to the bottom. */
  lastIsMine: boolean;
  hasOlder: boolean;
  loadingOlder: boolean;
  loadOlder: () => void;
}

/**
 * Scrolling for a thread kept in normal DOM order, oldest first, so a screen reader reads it the way it was written.
 * Loading older messages keeps the same message under the member's eyes. A new message scrolls into view only if they were
 * already at the bottom or sent it, and otherwise waits behind a "new messages" button. Resizing (the composer growing, a
 * keyboard opening) keeps them at the bottom if they were there.
 */
export function useChatScroll({ firstKey, lastKey, lastIsMine, hasOlder, loadingOlder, loadOlder }: Options) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const previous = useRef<{ first: string | undefined; last: string | undefined; height: number }>({ first: undefined, last: undefined, height: 0 });
  const lastKeyRef = useRef(lastKey);
  const [pinned, setPinned] = useState(true);
  // The newest message when the member scrolled away from the bottom: anything newer is news to them.
  const [seenKey, setSeenKey] = useState<string | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    lastKeyRef.current = lastKey;
    if (!el) return;
    const before = previous.current;
    if (firstKey !== before.first || lastKey !== before.last) {
      const firstLoad = before.first === undefined && before.last === undefined;
      const prepended = !firstLoad && firstKey !== before.first && lastKey === before.last;
      if (firstLoad) el.scrollTop = el.scrollHeight;
      else if (prepended) el.scrollTop += el.scrollHeight - before.height;
      else if (lastKey !== before.last && (pinnedRef.current || lastIsMine)) el.scrollTop = el.scrollHeight;
    }
    previous.current = { first: firstKey, last: lastKey, height: el.scrollHeight };
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) el.scrollTop = el.scrollHeight;
      previous.current.height = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  const onScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= PINNED_WITHIN_PX;
      if (atBottom !== pinnedRef.current) {
        pinnedRef.current = atBottom;
        setPinned(atBottom);
        if (!atBottom) setSeenKey(lastKeyRef.current);
      }
      if (el.scrollTop <= LOAD_OLDER_WITHIN_PX && hasOlder && !loadingOlder) loadOlder();
    },
    [hasOlder, loadingOlder, loadOlder],
  );

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, []);

  return { ref, onScroll, pinned, hasNew: !pinned && lastKey !== seenKey, jumpToLatest };
}
