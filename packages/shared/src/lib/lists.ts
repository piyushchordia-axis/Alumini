// How a list's results area reads its query, the same on both apps: the outline while the first answer comes, the
// error with nothing to show (kept, its button busy, while a retry asked for there is on its way), the empty state only
// after a real answer, and the rows (kept through a failed refetch, with a failed next page said beside Load more, and
// kept from the search before, faded under UPDATING_RESULTS, while a new search's answer comes).

/**
 * What a list's results area draws. `idle`: nothing, because the list isn't asked for (its query is switched off, such as
 * a tab that isn't open). `loading`: its outline (a skeleton). `error`: the error and a way to try again, only when
 * there is nothing to show. `empty`: its empty state, after an answer that held nothing. `rows`: what it has.
 */
export type ListView = "idle" | "loading" | "error" | "empty" | "rows";

/** What a screen reader hears while a list first loads: the phone's progressbar label. The web says it with "…". */
export const LOADING_LABEL = "Loading";

/** The parts of a TanStack Query (v5) result that decide a list's view, typed here so shared code needs no TanStack. */
export interface ListQueryState {
  status: "pending" | "error" | "success";
  fetchStatus: "fetching" | "paused" | "idle";
  /** Rows kept from another search while this one loads (`placeholderData`). */
  isPlaceholderData?: boolean;
  /**
   * A retry the member asked for from the list's error, still on its way. TanStack sends a query with no data back to
   * pending for it, which would swap the error, and the focused button, for the outline.
   */
  retrying?: boolean;
}

/**
 * The view of a list holding `count` rows. A first load waiting for the network (paused, offline) is still loading, so
 * it doesn't claim the list is empty; a query switched off is idle. A retry asked for from the error keeps the error up
 * until its answer comes, so focus stays on the button pressed. Rows kept from another search that held none stand for
 * nothing, so they show the outline too, never an empty state that names the wrong search.
 */
export function listView(query: ListQueryState, count: number): ListView {
  if (count > 0) return "rows";
  if (query.status === "pending") return query.fetchStatus === "idle" ? "idle" : query.retrying ? "error" : "loading";
  if (query.isPlaceholderData) return "loading";
  if (query.status === "error") return "error";
  return "empty";
}

/**
 * What went wrong with the next page the member asked for (web Load more), or null. The rows stay, so this is said
 * beside the button; a failed background refetch of rows already shown stays quiet, so it gives null.
 */
export function nextPageError<E>(query: { isFetchNextPageError: boolean; error: E | null }): E | null {
  return query.isFetchNextPageError ? query.error : null;
}

/**
 * A form's query that hasn't had its first answer yet. A form waits only for that: a query with no data goes back to
 * loading on every refetch, which would swap the form, and what's typed in it, for a skeleton.
 */
export function loadingFirstTime(query: { isLoading: boolean; isFetched: boolean }): boolean {
  return query.isLoading && !query.isFetched;
}

/** What a list says over its rows while they are kept from the search before and this one's answer comes. */
export const UPDATING_RESULTS = "Updating results…";

/**
 * Whether the rows on screen are kept from another search while this one's answer is on its way (or waits for the
 * network): the list fades them and says UPDATING_RESULTS. Kept rows that are none show the outline instead
 * (listView), with nothing said over it, and a list switched off says nothing.
 */
export function listUpdating(query: ListQueryState, count: number): boolean {
  return !!query.isPlaceholderData && query.fetchStatus !== "idle" && count > 0;
}

/**
 * TanStack's `placeholderData` for a list that keeps its rows while a new key loads: the rows of the key it showed last
 * (`previousQuery`) when `test` accepts that key (onlyFiltersChanged, onlySearchChanged), otherwise none, so the list
 * starts over. Typed by shape, so shared code needs no TanStack.
 */
export function keepPrevious(test: (previousKey: readonly unknown[]) => boolean) {
  return <T>(previous: T | undefined, previousQuery: { queryKey: readonly unknown[] } | undefined): T | undefined =>
    previous !== undefined && previousQuery !== undefined && test(previousQuery.queryKey) ? previous : undefined;
}

/**
 * The `placeholderData` of a cursor list (useInfiniteList): keepPrevious with the list's test when it keeps its rows,
 * and none while a retry asked for from its error is on its way (`retrying`). TanStack sends a query with no data back
 * to pending for that retry, so kept rows would come back and take the error, and the button pressed, off the screen.
 */
export function listPlaceholder(keepPreviousWhile: ((previousKey: readonly unknown[]) => boolean) | undefined, retrying: boolean) {
  return keepPreviousWhile && !retrying ? keepPrevious(keepPreviousWhile) : undefined;
}

/** The parts of a TanStack infinite query that decide its next page and its pull-to-refresh. */
export interface ListPagingState {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isRefetching: boolean;
  isPlaceholderData: boolean;
}

/** Whether a list offers its next page (web Load more): never from rows kept from another search, whose page it is. */
export function listHasMore(query: Pick<ListPagingState, "hasNextPage" | "isPlaceholderData">): boolean {
  return query.hasNextPage && !query.isPlaceholderData;
}

/** Whether the phone's list asks for its next page as it nears the end: one it offers (listHasMore) not yet on its way. */
export function listMayLoadMore(query: Pick<ListPagingState, "hasNextPage" | "isFetchingNextPage" | "isPlaceholderData">): boolean {
  return listHasMore(query) && !query.isFetchingNextPage;
}

/**
 * Whether the phone's pull-to-refresh spins: a refetch of the rows on screen, not a next page, nor a new search's
 * answer, which TanStack counts as a refetch while rows kept from the search before show.
 */
export function listRefreshing(query: Pick<ListPagingState, "isRefetching" | "isFetchingNextPage" | "isPlaceholderData">): boolean {
  return query.isRefetching && !query.isFetchingNextPage && !query.isPlaceholderData;
}

type Filters = Readonly<Record<string, unknown>>;

function isFilters(value: unknown): value is Filters {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The filters of two keys of one list, the previous key's then the current one's: every part but the last alike and the
 * last an object in both. Null for another list, another institution, no key before, or a key that ends otherwise
 * (`["directory", slug, "filters"]`).
 */
export function listFilters(previousKey: readonly unknown[] | undefined, key: readonly unknown[]): [Filters, Filters] | null {
  if (!previousKey || previousKey.length !== key.length || key.length === 0) return null;
  const last = key.length - 1;
  if (previousKey.some((part, i) => i < last && part !== key[i])) return null;
  const before = previousKey[last];
  const now = key[last];
  return isFilters(before) && isFilters(now) ? [before, now] : null;
}

/** Every filter named in either of two keys' filters. */
export function filterFields(before: Filters, now: Filters): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(now)])];
}

/**
 * Two values of one filter alike: the same value, or lists of the same values in the same order. A page builds its
 * filters afresh at every render, so a list (the directory's `field`) is never the same array twice.
 */
export function sameFilterValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => value === b[i]);
}

/**
 * Whether a list may go on showing the rows of `previousKey` while those of `key` load: when both are the same list
 * (listFilters) with other filters, whichever changed. Only for rows that just open a page (a member, a job); rows that
 * act on the tab they were listed under keep theirs for a new search alone (onlySearchChanged). Keys alike in every
 * filter, compared by value, are the same list whose rows were dropped from the cache, so nothing is kept.
 */
export function onlyFiltersChanged(previousKey: readonly unknown[] | undefined, key: readonly unknown[]): boolean {
  const filters = listFilters(previousKey, key);
  if (!filters) return false;
  const [before, now] = filters;
  return filterFields(before, now).some((field) => !sameFilterValue(before[field], now[field]));
}
