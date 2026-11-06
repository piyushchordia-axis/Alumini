import { describe, expect, it } from "vitest";
import { withBom } from "@illuminize/shared";
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

  it("hands the file over as text when asked, without its byte order mark, which withBom puts back once", async () => {
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: "a", refreshToken: "r" });
    const csv = "\uFEFFName,Phone\r\nÅsa Nørby,+919100000031\r\n";
    const fetchImpl = (async () =>
      new Response(new TextEncoder().encode(csv), {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="shri-gujarati-samaj-members-2026-11-06.csv"' },
      })) as unknown as typeof fetch;
    const core = new ApiCore({ baseUrl: "", storage, fetch: fetchImpl });

    const { text, filename } = await core.download({ path: "/admin/exports/members.csv", tenantSlug: "shri-gujarati-samaj" }, { as: "text" });
    expect(filename).toBe("shri-gujarati-samaj-members-2026-11-06.csv");
    expect(text).toBe("Name,Phone\r\nÅsa Nørby,+919100000031\r\n");
    expect(withBom(text)).toBe(csv);
    expect(withBom(withBom(text))).toBe(csv);
  });

  it("drops a byte order mark that the decoder kept", async () => {
    const storage = new MemoryTokenStorage();
    // A decoder that keeps the mark, as some platforms' fetch does.
    const keeps = { ok: true, status: 200, headers: new Headers(), text: async () => "\uFEFFName\r\n" } as unknown as Response;
    const core = new ApiCore({ baseUrl: "", storage, fetch: (async () => keeps) as unknown as typeof fetch });
    const { text, filename } = await core.download({ path: "/x.csv" }, { as: "text" });
    expect(text).toBe("Name\r\n");
    expect(filename).toBeNull();
  });

  it("turns an error response into an ApiClientError", async () => {
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: "a", refreshToken: "r" });
    const fetchImpl = (async () => Response.json({ error: { code: "RATE_LIMITED", message: "Slow down" } }, { status: 429 })) as unknown as typeof fetch;
    const core = new ApiCore({ baseUrl: "", storage, fetch: fetchImpl });
    await expect(core.download({ path: "/x" })).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
  });
});
