import { LOADING_LABEL, listView, loadingFirstTime, nextPageError, type ListQueryState } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

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
