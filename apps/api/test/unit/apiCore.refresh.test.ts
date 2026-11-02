import { ApiCore, ApiClientError, isApiClientError, isTransientError, MemoryTokenStorage } from "@illuminize/shared/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const apiError = (status: number, code: string) => json(status, { error: { code, message: code } });
const expiredToken = () => apiError(401, "TOKEN_EXPIRED");
const fresh = { accessToken: "new-access", refreshToken: "new-refresh" };

describe("ApiCore token refresh", () => {
  let storage: MemoryTokenStorage;
  const onUnauthorized = vi.fn();

  beforeEach(async () => {
    onUnauthorized.mockClear();
    storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: "old-access", refreshToken: "old-refresh" });
  });

  /** The fake API: `refresh` answers POST /auth/refresh, and any other call is expired until the token is the new one. */
  function core(refresh: () => Response | Promise<Response>) {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/auth/refresh")) return refresh();
      const authorized = (init?.headers as Record<string, string>).Authorization === `Bearer ${fresh.accessToken}`;
      return authorized ? json(200, { data: { ok: true } }) : expiredToken();
    });
    return { api: new ApiCore({ baseUrl: "http://api.test", storage, onUnauthorized, fetch: fetchImpl as typeof fetch }), calls };
  }
  const getMe = (api: ApiCore) => api.data<{ ok: boolean }>({ path: "/memberships/me", tenantSlug: "demo" });

  const expectSessionKept = async () => {
    expect(await storage.getAccessToken()).toBe("old-access");
    expect(await storage.getRefreshToken()).toBe("old-refresh");
    expect(onUnauthorized).not.toHaveBeenCalled();
  };
  const expectSignedOut = async () => {
    expect(await storage.getAccessToken()).toBeNull();
    expect(await storage.getRefreshToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  };

  it("refreshes an expired token and retries the request", async () => {
    const { api } = core(() => json(200, { data: fresh }));
    expect(await getMe(api)).toEqual({ ok: true });
    expect(await storage.getAccessToken()).toBe(fresh.accessToken);
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    ["a 500", () => apiError(500, "INTERNAL"), 500],
    ["a 503 with no JSON body", () => new Response("Service Unavailable", { status: 503 }), 503],
    ["a rate limit", () => apiError(429, "RATE_LIMITED"), 429],
  ])("keeps the session when the refresh gets %s, and surfaces that failure rather than the 401", async (_name, refresh, status) => {
    const { api } = core(refresh);
    const err = await getMe(api).catch((e: unknown) => e);
    expect(isApiClientError(err) && err.status).toBe(status);
    expect(isTransientError(err)).toBe(true);
    await expectSessionKept();
  });

  it("keeps the session when the refresh can't reach the server", async () => {
    const { api } = core(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = await getMe(api).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect((err as ApiClientError).status).toBe(0);
    await expectSessionKept();
  });

  it("recovers on the next request once the refresh works again", async () => {
    let down = true;
    const { api } = core(() => (down ? apiError(503, "INTERNAL") : json(200, { data: fresh })));
    await expect(getMe(api)).rejects.toMatchObject({ status: 503 });
    down = false;
    expect(await getMe(api)).toEqual({ ok: true });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it.each([
    ["SESSION_REVOKED", () => apiError(401, "SESSION_REVOKED")],
    ["a malformed token", () => apiError(400, "VALIDATION_ERROR")],
  ])("ends the session when the refresh is refused with %s", async (_name, refresh) => {
    const { api } = core(refresh);
    await expect(getMe(api)).rejects.toMatchObject({ status: 401, code: "TOKEN_EXPIRED" });
    await expectSignedOut();
  });

  it("ends the session when there is no refresh token to try", async () => {
    await storage.setTokens({ accessToken: "old-access", refreshToken: "" });
    const { api, calls } = core(() => json(200, { data: fresh }));
    await expect(getMe(api)).rejects.toMatchObject({ status: 401 });
    expect(calls.some((url) => url.endsWith("/auth/refresh"))).toBe(false);
    expect(await storage.getAccessToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("ends the session on SESSION_REVOKED without trying to refresh", async () => {
    const fetchImpl = vi.fn(async () => apiError(401, "SESSION_REVOKED"));
    const api = new ApiCore({ baseUrl: "http://api.test", storage, onUnauthorized, fetch: fetchImpl as unknown as typeof fetch });
    await expect(getMe(api)).rejects.toMatchObject({ code: "SESSION_REVOKED" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expectSignedOut();
  });

  it("shares one refresh between concurrent requests, and they all see the failure", async () => {
    const { api, calls } = core(() => apiError(503, "INTERNAL"));
    const results = await Promise.allSettled([getMe(api), getMe(api), getMe(api)]);
    expect(results.every((r) => r.status === "rejected" && isTransientError(r.reason))).toBe(true);
    expect(calls.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(1);
    await expectSessionKept();
  });
});
