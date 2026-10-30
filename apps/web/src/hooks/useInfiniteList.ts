import type { CursorPage } from "@illuminize/shared";
import { useInfiniteQuery, type QueryKey } from "@tanstack/react-query";

/** Cursor-paginated list wrapper around useInfiniteQuery; `items` is the flattened page data. */
export function useInfiniteList<P extends CursorPage<unknown>>(queryKey: QueryKey, fetchPage: (cursor: string | undefined) => Promise<P>, enabled = true) {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled,
  });
  const items = (query.data?.pages.flatMap((p) => p.data) ?? []) as P["data"];
  const first = query.data?.pages[0] as P | undefined;
  return { ...query, items, first };
}
