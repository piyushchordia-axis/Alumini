import { pageRetrying, pageView, type PageView } from "@illuminize/shared";
import { useState } from "react";

/** The parts of a TanStack query a screen reads, named rather than spread, so the query still re-renders only for those. */
interface PageQuery {
  data: unknown;
  error: Error | null;
  /** When its latest error came (0 for none): a refetch keeps it, and a query whose key changed has its own. */
  errorUpdatedAt: number;
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  refetch: () => Promise<unknown>;
}

export interface PageState {
  /** What the screen draws under its bar (shared pageView). */
  view: PageView;
  /** What went wrong, kept while a retry asked for from it is on its way (TanStack clears it for the retry). */
  error: unknown;
  /** The error's Retry loading: the error stays up, `retrying`, until the answer comes, so the button keeps focus. */
  retry: () => void;
  retrying: boolean;
}

/**
 * How a detail or form screen reads its query, as useInfiniteList does for a list, and as the web's usePageQuery: its
 * outline while the first answer comes, the screen itself whenever it has its data (a refetch failing in the background
 * keeps it there), and the error in place, under the screen's bar and Back, only with nothing to show (PageLoad draws
 * the first and the last).
 */
export function usePageQuery(query: PageQuery): PageState {
  const [retried, setRetried] = useState<{ error: Error; at: number } | null>(null);
  // Only for the query whose error it was pressed on: one whose key changed meanwhile (another range) shows its own state.
  const retrying = pageRetrying(retried?.at ?? null, query.errorUpdatedAt);
  const retry = () => {
    if (retrying) return;
    const pressed = query.error ? { error: query.error, at: query.errorUpdatedAt } : null;
    setRetried(pressed);
    // A retry settling late, after another was pressed, leaves that one's state alone.
    void query.refetch().finally(() => setRetried((now) => (now === pressed ? null : now)));
  };
  return { view: pageView({ status: query.status, fetchStatus: query.fetchStatus, retrying }, query.data !== undefined), error: query.error ?? (retrying ? retried?.error : null), retry, retrying };
}
