import { describe, expect, it } from "vitest";
import { ApiCore, MemoryTokenStorage } from "@illuminize/shared/client";

describe("ApiCore.download", () => {
  it("refreshes an expired token once, retries, and returns the file with the server's name", async () => {
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: "old", refreshToken: "r1" });
    const calls: Array<{ url: string; auth?: string; accept?: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const h = init.headers as Record<string, string>;
      calls.push({ url, auth: h.Authorization, accept: h.Accept });
      if (url.endsWith("/auth/refresh")) return Response.json({ data: { accessToken: "new", refreshToken: "r2" } });
      if (h.Authorization === "Bearer old") return Response.json({ error: { code: "TOKEN_EXPIRED", message: "Expired" } }, { status: 401 });
      return new Response("\uFEFFName\r\nAsha\r\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="demo-members-2026-11-01.csv"' } });
    }) as unknown as typeof fetch;
    const core = new ApiCore({ baseUrl: "http://api.test", storage, fetch: fetchImpl });

    const { blob, filename } = await core.download({ path: "/admin/exports/members.csv", tenantSlug: "demo" });
    expect(filename).toBe("demo-members-2026-11-01.csv");
    expect(await blob.text()).toContain("Asha");
    expect(calls.map((c) => [c.url.replace("http://api.test", ""), c.auth])).toEqual([
      ["/api/v1/t/demo/admin/exports/members.csv", "Bearer old"],
      ["/api/v1/auth/refresh", undefined],
      ["/api/v1/t/demo/admin/exports/members.csv", "Bearer new"],
    ]);
    expect(calls[0]!.accept).toBe("*/*");
    expect(await storage.getRefreshToken()).toBe("r2");
  });

  it("turns an error response into an ApiClientError", async () => {
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: "a", refreshToken: "r" });
    const fetchImpl = (async () => Response.json({ error: { code: "RATE_LIMITED", message: "Slow down" } }, { status: 429 })) as unknown as typeof fetch;
    const core = new ApiCore({ baseUrl: "", storage, fetch: fetchImpl });
    await expect(core.download({ path: "/x" })).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});
