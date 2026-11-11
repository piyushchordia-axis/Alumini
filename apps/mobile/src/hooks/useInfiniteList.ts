import { listMayLoadMore, listPlaceholder, listRefreshing, listUpdating, listView, type CursorPage } from "@illuminize/shared";
import { infiniteQueryOptions, useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useState } from "react";

/**
 * How a cursor list is fetched and cached: the hook's query, and a fetch ahead of a list not yet open (prefetchDirectory),
 * so that one lands under the same key, with the same pages, and reads the next cursor the same way when it refreshes.
 */
export function cursorListOptions<P extends CursorPage<unknown>>(queryKey: QueryKey, fetchPage: (cursor: string | undefined) => Promise<P>) {
  return infiniteQueryOptions({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: P) => last.nextCursor ?? undefined,
  });
}

export interface InfiniteListOptions {
  /** Off while the list isn't asked for, such as a tab that isn't open. */
  enabled?: boolean;
  /**
   * Keeps the rows on screen while a new key loads, when this accepts the key they were listed under: one with other
   * filters (onlyFiltersChanged) for rows that only open a page. They stay, `isPlaceholderData`, until the new rows
   * come. Off unless given: the feed reads its first page (`first.pinned`), which another key's rows would get wrong.
   */
  keepPreviousWhile?: (previousKey: QueryKey) => boolean;
}

/**
 * Cursor-paginated list wrapper around useInfiniteQuery; `items` is the flattened page data, and `view` what its results
 * area draws (listView, which ListEmpty takes): the skeleton, the error, the empty state or the rows, and nothing while
 * it's switched off. `retry` is the error's Try again: the error (`error`) stays up, `retrying`, until its answer comes,
 * so the button pressed keeps focus (no rows are kept meanwhile: listPlaceholder).
 *
 * With `keepPreviousWhile`, `updating` says the rows are kept from the search before (faded, with UpdatingNote).
 * `loadMore` never asks for kept rows' next page, which belongs to their own search (listMayLoadMore), and `refreshing`
 * (the FlatList's) isn't the new search's load, which TanStack counts as a refetch while kept rows show (listRefreshing).
 */
export function useInfiniteList<P extends CursorPage<unknown>>(queryKey: QueryKey, fetchPage: (cursor: string | undefined) => Promise<P>, options: boolean | InfiniteListOptions = true) {
  const { enabled = true, keepPreviousWhile } = typeof options === "boolean" ? { enabled: options } : options;
  // The error a retry is answering, kept on screen while TanStack clears it for the retry.
  const [retried, setRetried] = useState<Error | null>(null);
  const retrying = retried !== null;
  const query = useInfiniteQuery({
    ...cursorListOptions(queryKey, fetchPage),
    placeholderData: listPlaceholder(keepPreviousWhile, retrying),
    enabled,
  });
  const items = (query.data?.pages.flatMap((p) => p.data) ?? []) as P["data"];
  const first = query.data?.pages[0] as P | undefined;
  const loadMore = () => {
    if (listMayLoadMore(query)) void query.fetchNextPage();
  };
  const retry = () => {
    if (retrying) return;
    if (query.error) setRetried(query.error);
    void query.refetch().finally(() => setRetried(null));
  };
  const state = { status: query.status, fetchStatus: query.fetchStatus, isPlaceholderData: query.isPlaceholderData, retrying };
  return {
    ...query,
    items,
    first,
    loadMore,
    error: query.error ?? retried,
    view: listView(state, items.length),
    updating: listUpdating(state, items.length),
    refreshing: listRefreshing(query),
    retry,
    retrying,
  };
}
