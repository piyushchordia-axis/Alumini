import { awaitingFirstAnswer, cardInPages, DIRECTORY_PAGE_SIZE, type DirectoryCardDto, type MemberSection } from "@illuminize/shared";
import { queryOptions, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { cursorListOptions } from "@/hooks/useInfiniteList";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

type DirectoryFilters = Omit<NonNullable<Parameters<typeof api.directory.search>[1]>, "cursor" | "limit">;

/** A page of the directory's cards for `filters`, as the Directory page lists them and the fetch ahead asks for them. */
export const directoryPage =
  (slug: string, filters: DirectoryFilters = {}) =>
  (cursor: string | undefined) =>
    api.directory.search(slug, { ...filters, cursor, limit: DIRECTORY_PAGE_SIZE });

/** The directory's filters (the cities, companies, years and so on its selects offer), kept five minutes. */
export const directoryFiltersQuery = (slug: string) => queryOptions({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });

const ignore = () => {};

/**
 * Fetches the Directory page's first answers ahead: its first page of cards, under the key it opens with (no filters:
 * its own, all unset, hash the same), and its filters. Only what nothing is cached for yet: what is, fresh or not, the
 * page shows as it opens and refreshes itself, and fetching it again here would ask for every page Load more added,
 * under the list being read. A fetch already on its way is joined, and a failure is left for the page to meet.
 */
export function prefetchDirectory(qc: QueryClient, slug: string) {
  const cards = cursorListOptions(qk.directory(slug, {}), directoryPage(slug));
  if (qc.getQueryData(cards.queryKey) === undefined) void qc.infiniteQuery(cards).catch(ignore);
  const filters = directoryFiltersQuery(slug);
  if (qc.getQueryData(filters.queryKey) === undefined) void qc.query(filters).catch(ignore);
}

/**
 * Handlers for a section's link that fetch its page ahead when it's pointed at (a touch points too, just before its
 * tap) or reached with the keyboard: the Directory's, the one that opens on a long list of cards. Other links get none.
 */
export function useFetchAhead(slug: string) {
  const qc = useQueryClient();
  return (section: MemberSection) => {
    if (section !== "directory") return {};
    const fetchAhead = () => prefetchDirectory(qc, slug);
    return { onPointerEnter: fetchAhead, onFocus: fetchAhead };
  };
}

/**
 * The member's card from any directory list cached here (every query under the directory's key), to draw their
 * profile's header from while `profile`, the profile's own query, waits for its first answer (awaitingFirstAnswer);
 * undefined once it has answered, with the profile or an error. Read only: that query stays the source of truth, so the
 * card never goes into its cache.
 */
export function useCachedDirectoryCard(slug: string, membershipId: string, profile: { isPending: boolean; isFetched: boolean }): DirectoryCardDto | undefined {
  const qc = useQueryClient();
  if (!awaitingFirstAnswer(profile)) return undefined;
  return cardInPages(qc.getQueriesData({ queryKey: ["directory", slug] }).map(([, data]) => data), membershipId);
}
