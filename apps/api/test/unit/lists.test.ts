import {
  LOADING_LABEL,
  UPDATING_RESULTS,
  keepPrevious,
  listHasMore,
  listMayLoadMore,
  listPlaceholder,
  listRefreshing,
  listUpdating,
  listView,
  loadingFirstTime,
  nextPageError,
  onlyFiltersChanged,
  pageRetrying,
  pageView,
  type ListPagingState,
  type ListQueryState,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";
// The apps' own keys, so the tests follow them if they change.
import { qk as mobileKeys } from "../../../mobile/src/lib/queryKeys";
import { qk as webKeys } from "../../../web/src/lib/queryKeys";

const pending = (fetchStatus: ListQueryState["fetchStatus"]): ListQueryState => ({ status: "pending", fetchStatus });
const answered = (fetchStatus: ListQueryState["fetchStatus"] = "idle", isPlaceholderData = false): ListQueryState => ({ status: "success", fetchStatus, isPlaceholderData });
const failed = (fetchStatus: ListQueryState["fetchStatus"] = "idle"): ListQueryState => ({ status: "error", fetchStatus });

describe("a list's view", () => {
  it("draws the rows whenever it has some: fresh, refetching, kept from another search, or kept through a failed refetch", () => {
    expect(listView(answered(), 3)).toBe("rows");
    expect(listView(answered("fetching"), 3)).toBe("rows");
    expect(listView(answered("fetching", true), 3)).toBe("rows");
    expect(listView(failed(), 3)).toBe("rows");
  });

  it("draws the outline while the first answer is on its way, offline (paused) included, so it never claims the list is empty", () => {
    expect(listView(pending("fetching"), 0)).toBe("loading");
    expect(listView(pending("paused"), 0)).toBe("loading");
  });

  it("draws nothing for a list that isn't asked for (its query is switched off), rather than an empty state", () => {
    expect(listView(pending("idle"), 0)).toBe("idle");
  });

  it("draws the outline, not an empty state, while rows kept from another search held none", () => {
    expect(listView(answered("fetching", true), 0)).toBe("loading");
  });

  it("says what went wrong only with nothing to show", () => {
    expect(listView(failed(), 0)).toBe("error");
    expect(listView(failed("fetching"), 0)).toBe("error");
  });

  it("keeps the error up while a retry asked for from it is on its way, so the button pressed (and focus) stays", () => {
    // TanStack sends a query with no data back to pending, its error cleared, for a retry.
    expect(listView({ ...pending("fetching"), retrying: true }, 0)).toBe("error");
    expect(listView({ ...pending("paused"), retrying: true }, 0)).toBe("error");
    // Only a retry asked for there: coming back to a list that failed before draws its outline.
    expect(listView({ ...pending("fetching"), retrying: false }, 0)).toBe("loading");
    // Its answer decides from then on, whatever it was.
    expect(listView({ ...answered(), retrying: true }, 0)).toBe("empty");
    expect(listView({ ...answered(), retrying: true }, 2)).toBe("rows");
    expect(listView({ ...failed(), retrying: true }, 0)).toBe("error");
  });

  it("draws the empty state only after a real answer, and keeps it while that answer is refetched", () => {
    expect(listView(answered(), 0)).toBe("empty");
    expect(listView(answered("fetching"), 0)).toBe("empty");
  });

  it("is named Loading for screen readers, as the phone's progressbar and the e2e scripts call it", () => {
    expect(LOADING_LABEL).toBe("Loading");
  });
});

describe("a detail or form page's view", () => {
  it("draws the page whenever it has its data: fresh, refetching, or kept through a refetch that failed", () => {
    expect(pageView(answered(), true)).toBe("page");
    expect(pageView(answered("fetching"), true)).toBe("page");
    // The web post, event, funding and business pages used to swap themselves for the error here.
    expect(pageView(failed(), true)).toBe("page");
    expect(pageView(failed("fetching"), true)).toBe("page");
  });

  it("draws its outline under its header and Back while the first answer is on its way, offline (paused) included", () => {
    expect(pageView(pending("fetching"), false)).toBe("loading");
    expect(pageView(pending("paused"), false)).toBe("loading");
  });

  it("draws nothing for a page whose query is switched off (a form with nothing to edit yet)", () => {
    expect(pageView(pending("idle"), false)).toBe("idle");
  });

  it("says what went wrong in place only with nothing to show, and an answer that held nothing is a page that isn't there", () => {
    expect(pageView(failed(), false)).toBe("error");
    expect(pageView(failed("fetching"), false)).toBe("error");
    expect(pageView(answered(), false)).toBe("error");
  });

  it("keeps the error up while a retry asked for from it is on its way, so the button pressed (and focus) stays", () => {
    // TanStack sends a query with no data back to pending, its error cleared, for a retry.
    expect(pageView({ ...pending("fetching"), retrying: true }, false)).toBe("error");
    expect(pageView({ ...pending("paused"), retrying: true }, false)).toBe("error");
    // Only a retry asked for there: coming back to a page that failed before draws its outline.
    expect(pageView({ ...pending("fetching"), retrying: false }, false)).toBe("loading");
    // Its answer decides from then on.
    expect(pageView({ ...answered(), retrying: true }, true)).toBe("page");
    expect(pageView({ ...failed(), retrying: true }, false)).toBe("error");
  });

  it("counts a retry as on its way only for the query whose error it was pressed on, not one whose key changed since", () => {
    // Pressed on the error that came at 1000; the refetch keeps that error's time while it's on its way.
    expect(pageRetrying(1_000, 1_000)).toBe(true);
    // Nothing pressed.
    expect(pageRetrying(null, 1_000)).toBe(false);
    // Another key (26 weeks in place of 12) that never failed, or failed at another time: its own outline or error.
    expect(pageRetrying(1_000, 0)).toBe(false);
    expect(pageRetrying(1_000, 2_000)).toBe(false);
    // The retry failed: a newer error, which the page shows with its button free again.
    expect(pageRetrying(1_000, 1_500)).toBe(false);
    // A query that has never failed can't be retrying, whatever was pressed.
    expect(pageRetrying(0, 0)).toBe(false);
  });
});

describe("a failed next page", () => {
  const error = new Error("Network error");

  it("is said beside Load more when the page the member asked for failed, while the rows stay", () => {
    expect(nextPageError({ isFetchNextPageError: true, error })).toBe(error);
    expect(listView(failed(), 20)).toBe("rows");
  });

  it("stays quiet when a background refetch of the rows shown failed, or nothing failed", () => {
    expect(nextPageError({ isFetchNextPageError: false, error })).toBeNull();
    expect(nextPageError({ isFetchNextPageError: false, error: null })).toBeNull();
  });
});

describe("a form's first answer", () => {
  it("is awaited only until the query has answered once, so a refetch never swaps the form for a skeleton", () => {
    expect(loadingFirstTime({ isLoading: true, isFetched: false })).toBe(true);
    expect(loadingFirstTime({ isLoading: true, isFetched: true })).toBe(false);
    expect(loadingFirstTime({ isLoading: false, isFetched: false })).toBe(false);
    expect(loadingFirstTime({ isLoading: false, isFetched: true })).toBe(false);
  });
});

describe("results kept while a new search loads", () => {
  for (const [app, qk] of [
    ["web", webKeys],
    ["phone", mobileKeys],
  ] as const) {
    describe(`on the ${app}`, () => {
      // As the directory builds its filters at each render: every filter named, the unused ones undefined, and the
      // institution's own questions as a list made afresh.
      const directory = (filters: { q?: string; year?: number; field?: string[]; openTo?: string }, slug = "demo") =>
        qk.directory(slug, { q: undefined, year: undefined, openTo: undefined, field: undefined, ...filters, ...(filters.field ? { field: [...filters.field] } : {}) });

      it("keeps the cards for any change of search or filter, a list of the institution's questions included", () => {
        expect(onlyFiltersChanged(directory({ q: "Pri" }), directory({ q: "Priya" }))).toBe(true);
        expect(onlyFiltersChanged(directory({}), directory({ q: "Priya" }))).toBe(true);
        expect(onlyFiltersChanged(directory({ q: "Priya" }), directory({}))).toBe(true);
        expect(onlyFiltersChanged(directory({ q: "Priya" }), directory({ q: "Priya", openTo: "INVESTING" }))).toBe(true);
        expect(onlyFiltersChanged(directory({ year: 2012 }), directory({ year: 2013 }))).toBe(true);
        expect(onlyFiltersChanged(directory({ field: ["house:red"] }), directory({ field: ["house:blue"] }))).toBe(true);
        expect(onlyFiltersChanged(directory({ field: ["house:red"] }), directory({ field: ["house:red", "club:chess"] }))).toBe(true);
        expect(onlyFiltersChanged(directory({}), directory({ field: ["house:red"] }))).toBe(true);
        expect(onlyFiltersChanged(qk.jobs("demo", { q: undefined, jobType: "FULL_TIME" }), qk.jobs("demo", { q: "Backend", jobType: "FULL_TIME" }))).toBe(true);
        expect(onlyFiltersChanged(qk.jobs("demo", {}), qk.jobs("demo", { canRefer: true }))).toBe(true);
      });

      it("compares the filters by value, so a list built afresh with the same values is no change", () => {
        // The same list whose rows were dropped from the cache: nothing to keep in their place.
        expect(onlyFiltersChanged(directory({ q: "Priya", field: ["house:red"] }), directory({ q: "Priya", field: ["house:red"] }))).toBe(false);
        expect(onlyFiltersChanged(directory({}), qk.directory("demo", {}))).toBe(false);
      });

      it("starts over for another institution, another list, a key that isn't a filtered list's, or no list before", () => {
        expect(onlyFiltersChanged(directory({ q: "Priya" }, "other"), directory({ q: "Priya" }))).toBe(false);
        expect(onlyFiltersChanged(qk.jobs("demo", { q: "Priya" }), directory({ q: "Priya" }))).toBe(false);
        expect(onlyFiltersChanged(qk.directoryFilters("demo"), directory({}))).toBe(false);
        expect(onlyFiltersChanged(directory({}), qk.directoryFilters("demo"))).toBe(false);
        expect(onlyFiltersChanged(qk.seekers("demo"), qk.jobs("demo", {}))).toBe(false);
        expect(onlyFiltersChanged(undefined, directory({ q: "Priya" }))).toBe(false);
        expect(onlyFiltersChanged([], [])).toBe(false);
      });
    });
  }

  it("hands TanStack the rows before only when the test accepts the key they were listed under", () => {
    const rows = { pages: [{ data: [{ id: "a" }], nextCursor: null }], pageParams: [undefined] };
    const before = webKeys.directory("demo", { q: "Pri" });
    const now = webKeys.directory("demo", { q: "Priya" });
    const keep = keepPrevious((previousKey) => onlyFiltersChanged(previousKey, now));
    expect(keep(rows, { queryKey: before })).toBe(rows);
    expect(keep(rows, { queryKey: webKeys.directory("other", { q: "Pri" }) })).toBeUndefined();
    // The first load: no list before, or a list before with nothing in it.
    expect(keep(undefined, undefined)).toBeUndefined();
    expect(keep(rows, undefined)).toBeUndefined();
    expect(keep(undefined, { queryKey: before })).toBeUndefined();
  });

  it("says it's updating over kept rows while the answer is on its way or waits for the network, and only then", () => {
    expect(UPDATING_RESULTS).toBe("Updating results…");
    expect(listUpdating(answered("fetching", true), 3)).toBe(true);
    expect(listUpdating(answered("paused", true), 3)).toBe(true);
    // Kept rows that are none show the outline (listView), with nothing said over it.
    expect(listUpdating(answered("fetching", true), 0)).toBe(false);
    expect(listView(answered("fetching", true), 0)).toBe("loading");
    // Its own rows, refetched or not, and a list switched off, say nothing.
    expect(listUpdating(answered("fetching"), 3)).toBe(false);
    expect(listUpdating(answered(), 3)).toBe(false);
    expect(listUpdating(answered("idle", true), 3)).toBe(false);
    expect(listUpdating(pending("fetching"), 0)).toBe(false);
  });

  it("never offers an empty state beside kept rows, or for a search whose answer hasn't come", () => {
    expect(listView(answered("fetching", true), 4)).toBe("rows");
    expect(listView(answered("fetching", true), 0)).not.toBe("empty");
    expect(listView(answered("paused", true), 0)).not.toBe("empty");
  });

  describe("while a retry pressed on the error is on its way", () => {
    const rows = { pages: [{ data: [{ id: "a" }], nextCursor: null }], pageParams: [undefined] };
    const before = webKeys.directory("demo", { q: "Sneha" });
    const now = webKeys.directory("demo", { q: "Priya" });
    const test = (previousKey: readonly unknown[]) => onlyFiltersChanged(previousKey, now);

    it("keeps nothing, so the search before's rows don't come back over the error and take its focused button away", () => {
      // TanStack sends the failed search back to pending, its error cleared, for the retry: placeholder data would
      // stand in, and listView would draw it.
      expect(listPlaceholder(test, true)).toBeUndefined();
      expect(listView({ ...pending("fetching"), retrying: true }, 0)).toBe("error");
      expect(listUpdating({ ...pending("fetching"), retrying: true }, 0)).toBe(false);
    });

    it("keeps the rows again otherwise, and never for a list that doesn't opt in (the feed)", () => {
      expect(listPlaceholder(test, false)?.(rows, { queryKey: before })).toBe(rows);
      expect(listPlaceholder(test, false)?.(rows, { queryKey: webKeys.directory("other", { q: "Sneha" }) })).toBeUndefined();
      expect(listPlaceholder(undefined, false)).toBeUndefined();
      expect(listPlaceholder(undefined, true)).toBeUndefined();
    });
  });
});

describe("a list's next page and pull-to-refresh with rows kept from another search", () => {
  const query = (state: Partial<ListPagingState> = {}): ListPagingState => ({ hasNextPage: false, isFetchingNextPage: false, isRefetching: false, isPlaceholderData: false, ...state });

  it("offers Load more for its own rows only: kept rows' next page belongs to their own search", () => {
    expect(listHasMore(query({ hasNextPage: true }))).toBe(true);
    expect(listHasMore(query({ hasNextPage: true, isPlaceholderData: true }))).toBe(false);
    expect(listHasMore(query())).toBe(false);
  });

  it("asks for the next page at the end of the phone's list only when it offers one not yet on its way", () => {
    expect(listMayLoadMore(query({ hasNextPage: true }))).toBe(true);
    expect(listMayLoadMore(query({ hasNextPage: true, isFetchingNextPage: true }))).toBe(false);
    expect(listMayLoadMore(query({ hasNextPage: true, isPlaceholderData: true }))).toBe(false);
    expect(listMayLoadMore(query())).toBe(false);
  });

  it("spins pull-to-refresh for a refetch of the rows shown, not for a next page or a new search's answer", () => {
    expect(listRefreshing(query({ isRefetching: true }))).toBe(true);
    expect(listRefreshing(query({ isRefetching: true, isFetchingNextPage: true }))).toBe(false);
    // TanStack counts a new search's load as a refetch while kept rows show.
    expect(listRefreshing(query({ isRefetching: true, isPlaceholderData: true }))).toBe(false);
    expect(listRefreshing(query())).toBe(false);
  });
});
