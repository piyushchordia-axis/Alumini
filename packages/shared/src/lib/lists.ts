// How a list's results area reads its query, the same on both apps: the outline while the first answer comes, the
// error with nothing to show (kept, its button busy, while a retry asked for there is on its way), the empty state only
// after a real answer, and the rows (kept through a failed refetch, with a failed next page said beside Load more).

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
