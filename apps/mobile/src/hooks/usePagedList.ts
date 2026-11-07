import { dedupeById, keepPrevious, listMayLoadMore, listUpdating, listView, pagedNext, type Page } from "@illuminize/shared";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";
import { useMemo } from "react";

/**
 * Infinite scroll over a page-numbered list (useInfiniteList is for cursor lists). Rows come flattened and each once,
 * as a row can reach the next page too when the list changes between two pages, and `total` is the latest page's.
 * `view` is what its ListEmpty draws (listView): the skeleton, the error, the empty state, or nothing.
 *
 * A new key starts with no rows unless `keepPreviousWhile` accepts the key whose rows are on screen, such as one that
 * differs only in the search (onlySearchChanged): those rows stay, as `isPlaceholderData`, until the new ones arrive,
 * and `updating` says so (UpdatingNote over them). Never keep them across a tab change on a list whose rows carry
 * actions, and hold those actions while they're kept.
 *
 * `refetchOnMount: "always"` fetches the list again as the screen opens even when what's cached is recent, for a screen
 * that decides something from the rows (a link's item) and must wait for `isFetchedAfterMount`.
 */
export function usePagedList<T extends { id: string }>(
  queryKey: QueryKey,
  fetchPage: (page: number) => Promise<Page<T>>,
  { keepPreviousWhile, enabled = true, refetchOnMount = true }: { keepPreviousWhile?: (previousKey: QueryKey) => boolean; enabled?: boolean; refetchOnMount?: boolean | "always" } = {},
) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => pagedNext(last.page, last.pageSize, last.total),
    placeholderData: keepPreviousWhile ? keepPrevious(keepPreviousWhile) : undefined,
    enabled,
    refetchOnMount,
  });
  const pages = query.data?.pages;
  const items = useMemo(() => dedupeById(pages?.flatMap((p) => p.data) ?? []), [pages]);
  const total = pages?.[pages.length - 1]?.total ?? 0;
  const loadMore = () => {
    // Not from rows kept for another key: their next page belongs to that key.
    if (listMayLoadMore(query)) void query.fetchNextPage();
  };
  const state = { status: query.status, fetchStatus: query.fetchStatus, isPlaceholderData: query.isPlaceholderData };
  return { ...query, items, total, loadMore, view: listView(state, items.length), updating: listUpdating(state, items.length) };
}
