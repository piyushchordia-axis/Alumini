import { awaitingFirstAnswer, cardInPages, DIRECTORY_PAGE_SIZE, directoryPrefetchSection, type DirectoryCardDto, type MemberSection } from "@illuminize/shared";
import { queryOptions, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { cursorListOptions } from "@/hooks/useInfiniteList";
import { useMembership } from "@/hooks/useMembership";
import { api } from "@/lib/api";
import { qk } from "@/lib/queryKeys";

type DirectoryFilters = Omit<NonNullable<Parameters<typeof api.directory.search>[1]>, "cursor" | "limit">;

/** A page of the directory's cards for `filters`, as the Directory screen lists them and the fetch ahead asks for them. */
export const directoryPage =
  (slug: string, filters: DirectoryFilters = {}) =>
  (cursor: string | undefined) =>
    api.directory.search(slug, { ...filters, cursor, limit: DIRECTORY_PAGE_SIZE });

/** The directory's filters (the cities, companies, years and so on Filters offers), kept five minutes. */
export const directoryFiltersQuery = (slug: string) => queryOptions({ queryKey: qk.directoryFilters(slug), queryFn: () => api.directory.filters(slug), staleTime: 5 * 60_000 });

const ignore = () => {};

/**
 * Fetches the Directory screen's first answers ahead: its first page of cards, under the key it opens with (no filters:
 * its own, all unset, hash the same), and its filters. Only what nothing is cached for yet: what is, fresh or not, the
 * screen shows as it opens and refreshes itself, and fetching it again here would ask for every page scrolling added. A
 * fetch already on its way is joined, and a failure is left for the screen to meet.
 */
export function prefetchDirectory(qc: QueryClient, slug: string) {
  const cards = cursorListOptions(qk.directory(slug, {}), directoryPage(slug));
  if (qc.getQueryData(cards.queryKey) === undefined) void qc.infiniteQuery(cards).catch(ignore);
  const filters = directoryFiltersQuery(slug);
  if (qc.getQueryData(filters.queryKey) === undefined) void qc.query(filters).catch(ignore);
}

/**
 * Called by the tab roots that can be home while the directory is on, Feed and Jobs (directory.test.ts checks no other
 * section can be), with whether their list has had its first answer: on the home section (directoryPrefetchSection),
 * once that answer is in, fetches the directory's first page ahead, once per institution while the screen is mounted.
 * One page of cards on any network, so Directory opens on its cards, and never before what the member opened the app
 * to see.
 */
export function usePrefetchDirectoryAfter(section: MemberSection, answered: boolean) {
  const qc = useQueryClient();
  const { tenant } = useMembership();
  const due = answered && directoryPrefetchSection(tenant.settings.features) === section;
  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!due || fetchedFor.current === tenant.slug) return;
    fetchedFor.current = tenant.slug;
    prefetchDirectory(qc, tenant.slug);
  }, [due, qc, tenant.slug]);
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
