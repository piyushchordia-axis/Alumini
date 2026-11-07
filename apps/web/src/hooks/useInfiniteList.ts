import { listView, nextPageError, type CursorPage } from "@illuminize/shared";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Cursor-paginated list wrapper around useInfiniteQuery; `items` is the flattened page data, and `view` what its results
 * area draws (listView): the skeleton, the error, the empty state or the rows, and nothing while it's switched off.
 * `retry` is the error's Retry loading: the error (`error`) stays up, `retrying`, until its answer comes, so the button
 * pressed keeps focus. `nextPageError` is what went wrong with a page Load more asked for, said beside it.
 */
export function useInfiniteList<P extends CursorPage<unknown>>(queryKey: QueryKey, fetchPage: (cursor: string | undefined) => Promise<P>, enabled = true) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  // The error a retry is answering, kept on screen while TanStack clears it for the retry.
  const [retried, setRetried] = useState<Error | null>(null);
  const items = (query.data?.pages.flatMap((p) => p.data) ?? []) as P["data"];
  const first = query.data?.pages[0] as P | undefined;
  const retrying = retried !== null;
  const retry = () => {
    if (retrying) return;
    if (query.error) setRetried(query.error);
    void query.refetch().finally(() => setRetried(null));
  };
  return {
    ...query,
    items,
    first,
    error: query.error ?? retried,
    view: listView({ status: query.status, fetchStatus: query.fetchStatus, isPlaceholderData: query.isPlaceholderData, retrying }, items.length),
    retry,
    retrying,
    nextPageError: nextPageError(query),
  };
}
