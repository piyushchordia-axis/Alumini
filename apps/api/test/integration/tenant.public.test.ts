import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("public tenant routes", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("reports health", async () => {
    const res = await request(ctx.app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "ok", db: "ok", redis: "ok" });
  });

  it("lists only active tenants and caches the list", async () => {
    await createTenant(ctx, { slug: "alpha-college", name: "Alpha College" });
    await createTenant(ctx, { slug: "beta-school", name: "Beta School", status: "SUSPENDED" });

    const res = await request(ctx.app).get("/api/v1/tenants");
    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { slug: string }) => t.slug)).toEqual(["alpha-college"]);

    // cached: adding another tenant is not visible until TTL expires
    await createTenant(ctx, { slug: "gamma-uni", name: "Gamma University" });
    const cached = await request(ctx.app).get("/api/v1/tenants");
    expect(cached.body.data).toHaveLength(1);

    // search bypasses the cache
    const searched = await request(ctx.app).get("/api/v1/tenants?q=gamma");
    expect(searched.body.data.map((t: { slug: string }) => t.slug)).toEqual(["gamma-uni"]);
  });

  it("returns public tenant details with settings", async () => {
    await createTenant(ctx, { slug: "alpha-college", memberApprovalMode: "ADMIN_APPROVAL" });
    const res = await request(ctx.app).get("/api/v1/tenants/alpha-college");
    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe("alpha-college");
    expect(res.body.data.settings.memberApprovalMode).toBe("ADMIN_APPROVAL");
    expect(res.body.data.settings.features.jobs).toBe(true);
    expect(res.body.data).not.toHaveProperty("contentModerationMode");
  });

  it("404s for unknown or inactive tenants and 400s for invalid slugs", async () => {
    await createTenant(ctx, { slug: "closed-college", status: "ARCHIVED" });
    expect((await request(ctx.app).get("/api/v1/tenants/nope")).status).toBe(404);
    const inactive = await request(ctx.app).get("/api/v1/tenants/closed-college");
    expect(inactive.status).toBe(404);
    expect(inactive.body.error.code).toBe("TENANT_NOT_FOUND");
    const bad = await request(ctx.app).get("/api/v1/tenants/Bad_Slug");
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_ERROR");
  });
});
