import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PROFILE, auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("tenant admin settings + branding", () => {
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
  const api = () => request(ctx.app);

  it("updates approval mode and the change applies to the next registration", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "AUTO_APPROVE" });
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);

    const current = await api().get(`${base}/admin/settings`).set(admin.headers);
    expect(current.body.data.settings.memberApprovalMode).toBe("AUTO_APPROVE");
    expect(current.body.data.branding.slug).toBe(tenant.slug);
    expect((await api().get(`${base}/admin/settings`).set(member.headers)).status).toBe(403);

    expect((await api().patch(`${base}/admin/settings`).set(admin.headers).send({ minBatchYear: 2020, maxBatchYear: 2010 })).status).toBe(400);
    const upd = await api().patch(`${base}/admin/settings`).set(admin.headers).send({ memberApprovalMode: "ADMIN_APPROVAL", minBatchYear: 2000 });
    expect(upd.body.data).toMatchObject({ memberApprovalMode: "ADMIN_APPROVAL", minBatchYear: 2000 });

    const user = await createUser(ctx);
    const session = await loginAs(ctx, user.phoneE164);
    const reg = await api().post(`${base}/memberships`).set(auth(session.accessToken)).send(PROFILE);
    expect(reg.body.data.status).toBe("PENDING");
    expect((await api().post(`${base}/memberships`).set(auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken)).send({ ...PROFILE, startYear: 1995, batchYear: 1999 })).status).toBe(400);

    const audit = await api().get(`${base}/admin/audit?action=tenant.settings`).set(admin.headers);
    expect(audit.body.total).toBe(1);
  });

  it("tells members whether their content waits for an admin, so a form can say so before it's sent", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const mode = async () => (await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.contentModerationMode;
    expect(await mode()).toBe("AUTO_APPROVE");
    await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ contentModerationMode: "ADMIN_APPROVAL" }).expect(200);
    expect(await mode()).toBe("ADMIN_APPROVAL");
  });

  it("updates branding visible on the public tenant page", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    expect((await api().patch(`${base}/admin/branding`).set(admin.headers).send({ primaryColor: "blue" })).status).toBe(400);
    const upd = await api().patch(`${base}/admin/branding`).set(admin.headers).send({ name: "Renamed College", primaryColor: "#123456", tagline: "New tagline", websiteUrl: "https://example.org" });
    expect(upd.body.data).toMatchObject({ name: "Renamed College", primaryColor: "#123456", tagline: "New tagline" });
    const pub = await api().get(`/api/v1/tenants/${tenant.slug}`);
    expect(pub.body.data).toMatchObject({ name: "Renamed College", primaryColor: "#123456", websiteUrl: "https://example.org" });
    expect((await api().get(`/api/v1/tenants`)).body.data[0].name).toBe("Renamed College");
  });

  it("sets the institution's time zone (validated) and serves it through the cache", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.timezone).toBe("Asia/Kolkata");
    expect((await api().patch(`${base}/admin/branding`).set(admin.headers).send({ timezone: "Mars/Olympus" })).status).toBe(400);
    const upd = await api().patch(`${base}/admin/branding`).set(admin.headers).send({ timezone: "Europe/London" });
    expect(upd.body.data.timezone).toBe("Europe/London");
    // Twice: the second read is served from the (versioned) Redis cache.
    expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.timezone).toBe("Europe/London");
    expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.timezone).toBe("Europe/London");
  });
});
