import { ApiClientError, fatalQueryError, forgetGuardDataOnAnswer, GUARD_QUERY_META, isTransientError } from "@illuminize/shared/client";
import { QueryCache, QueryClient, QueryObserver } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";

const network = new ApiClientError(0, "NETWORK_ERROR", "offline");
const serverError = new ApiClientError(500, "INTERNAL", "boom");
const badGateway = new ApiClientError(502, "INTERNAL", "Request failed (502)");
const rateLimited = new ApiClientError(429, "RATE_LIMITED", "slow down");
const notMember = new ApiClientError(404, "NOT_A_MEMBER", "not a member");
const inactive = new ApiClientError(403, "TENANT_INACTIVE", "suspended");
const notFound = new ApiClientError(404, "TENANT_NOT_FOUND", "not found");
const cached = { fullName: "Priya" };

describe("isTransientError", () => {
  it("is a network failure, a 5xx or a rate limit", () => {
    expect([network, serverError, badGateway, rateLimited].every(isTransientError)).toBe(true);
  });

  it("is not an answer from the API, nor something that isn't an API error at all", () => {
    const answers = [new ApiClientError(401, "SESSION_REVOKED", "signed out"), inactive, notMember, notFound, new TypeError("Query data cannot be undefined"), null];
    for (const err of answers) expect(isTransientError(err)).toBe(false);
  });
});

describe("fatalQueryError", () => {
  it("has nothing to act on when the query didn't fail", () => {
    expect(fatalQueryError({ data: cached, error: null })).toBeNull();
    expect(fatalQueryError({ data: undefined, error: null })).toBeNull();
  });

  it("keeps the open screen when a refetch fails transiently and data is cached", () => {
    expect(fatalQueryError({ data: cached, error: network })).toBeNull();
    expect(fatalQueryError({ data: cached, error: serverError })).toBeNull();
    expect(fatalQueryError({ data: cached, error: rateLimited })).toBeNull();
  });

  it("is fatal when a transient failure leaves nothing cached", () => {
    expect(fatalQueryError({ data: undefined, error: network })).toBe(network);
    expect(fatalQueryError({ data: null, error: serverError })).toBe(serverError);
  });

  it("acts on an answer from the API even with data cached", () => {
    for (const answer of [notMember, inactive, new ApiClientError(401, "UNAUTHENTICATED", "signed out")]) {
      expect(fatalQueryError({ data: cached, error: answer })).toBe(answer);
    }
  });

  it("acts on an unexpected error rather than hiding it", () => {
    const bug = new TypeError("Query data cannot be undefined");
    expect(fatalQueryError({ data: cached, error: bug })).toBe(bug);
  });
});

describe("a guard query in the real cache", () => {
  /** A query the guards would read, answering with each outcome in turn. An Error rejects, anything else resolves. */
  function guardQuery(outcomes: unknown[]) {
    const client = new QueryClient({ queryCache: new QueryCache({ onError: forgetGuardDataOnAnswer }) });
    const observer = new QueryObserver(client, {
      queryKey: ["membership", "demo"],
      meta: GUARD_QUERY_META,
      retry: false,
      queryFn: async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    });
    const refetch = async () => {
      await observer.refetch();
      return observer.getCurrentResult();
    };
    return { refetch };
  }

  it("keeps its data through transient failures, so the open screen stays", async () => {
    const q = guardQuery([cached, network, serverError, rateLimited]);
    await q.refetch();
    for (let i = 0; i < 3; i++) {
      const state = await q.refetch();
      expect(state.data).toEqual(cached);
      expect(fatalQueryError(state)).toBeNull();
    }
  });

  it.each([
    ["NOT_A_MEMBER", notMember],
    ["TENANT_INACTIVE", inactive],
    ["TENANT_NOT_FOUND", notFound],
  ])("drops its data on %s, so a transient failure afterwards stays fatal", async (_name, answer) => {
    const q = guardQuery([cached, answer, network, serverError]);
    await q.refetch();
    const answered = await q.refetch();
    expect(answered.data).toBeUndefined();
    expect(fatalQueryError(answered)).toBe(answer);
    expect(fatalQueryError(await q.refetch())).toBe(network);
    expect(fatalQueryError(await q.refetch())).toBe(serverError);
  });

  it("recovers on a success after an answer", async () => {
    const q = guardQuery([cached, notMember, cached]);
    await q.refetch();
    await q.refetch();
    const state = await q.refetch();
    expect(state.data).toEqual(cached);
    expect(fatalQueryError(state)).toBeNull();
  });

  it("leaves other queries' data alone", async () => {
    const client = new QueryClient({ queryCache: new QueryCache({ onError: forgetGuardDataOnAnswer }) });
    const outcomes: unknown[] = [cached, notMember];
    const observer = new QueryObserver(client, {
      queryKey: ["posts"],
      retry: false,
      queryFn: async () => {
        const outcome = outcomes.shift();
        if (outcome instanceof Error) throw outcome;
        return outcome;
      },
    });
    await observer.refetch();
    await observer.refetch();
    expect(observer.getCurrentResult().data).toEqual(cached);
  });

  it("keeps its data on an error that isn't the API's", async () => {
    const q = guardQuery([cached, new TypeError("bug")]);
    await q.refetch();
    expect((await q.refetch()).data).toEqual(cached);
  });
});
