import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { memberships } from "../../src/db/schema";
import { PROFILE, auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("platform admin", () => {
  let ctx: TestContext;
  let platform: { accessToken: string; user: { id: string } };
  let H: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    platform = await loginAs(ctx, "+919999999999");
    H = auth(platform.accessToken);
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  it("rejects non-platform users", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    expect((await api().get("/api/v1/platform/tenants").set(admin.headers)).status).toBe(403);
    expect((await api().get("/api/v1/platform/tenants")).status).toBe(401);
  });

  it("onboards a tenant with settings and an initial admin who can immediately administer it", async () => {
    const res = await api()
      .post("/api/v1/platform/tenants")
      .set(H)
      .send({
        slug: "new-college",
        name: "New College",
        type: "COLLEGE",
        city: "Jaipur",
        country: "in",
        primaryColor: "#ff0000",
        settings: { memberApprovalMode: "ADMIN_APPROVAL", contentModerationMode: "ADMIN_APPROVAL" },
        initialAdmin: { phone: "98111 11111", fullName: "First Admin", batchYear: 2005 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.tenant).toMatchObject({ slug: "new-college", country: "IN", primaryColor: "#ff0000", status: "ACTIVE" });
    expect(res.body.data.settings.memberApprovalMode).toBe("ADMIN_APPROVAL");
    expect(res.body.data.admins).toEqual([expect.objectContaining({ fullName: "First Admin", phone: "+919811111111", role: "TENANT_ADMIN", status: "APPROVED", batchYear: 2005 })]);
    expect(res.body.data.counts.approvedMembers).toBe(1);
    expect((await api().post("/api/v1/platform/tenants").set(H).send({ slug: "new-college", name: "Dup" })).status).toBe(409);

    expect((await api().get("/api/v1/tenants/new-college")).status).toBe(200);
    const adminSession = await loginAs(ctx, "+919811111111");
    const dashboard = await api().get("/api/v1/t/new-college/admin/dashboard").set(auth(adminSession.accessToken));
    expect(dashboard.status).toBe(200);

    const list = await api().get("/api/v1/platform/tenants?q=new").set(H);
    expect(list.body.total).toBe(1);
    expect(list.body.data[0]).toMatchObject({ slug: "new-college", counts: { approvedMembers: 1 }, billingModel: null });

    const upd = await api().patch(`/api/v1/platform/tenants/${res.body.data.tenant.id}`).set(H).send({ status: "SUSPENDED", tagline: "Paused" });
    expect(upd.body.data.tenant).toMatchObject({ status: "SUSPENDED", tagline: "Paused" });
    expect((await api().get("/api/v1/tenants/new-college")).status).toBe(404);
    const blocked = await api().get("/api/v1/t/new-college/admin/dashboard").set(auth(adminSession.accessToken));
    expect(blocked.body.error.code).toBe("TENANT_INACTIVE");
    expect((await api().get("/api/v1/t/new-college/admin/dashboard").set(H)).status).toBe(200);

    const settings = await api().patch(`/api/v1/platform/tenants/${res.body.data.tenant.id}/settings`).set(H).send({ allowSelfRegistration: false, features: { funding: false } });
    expect(settings.body.data).toMatchObject({ allowSelfRegistration: false, features: { funding: false, jobs: true } });
  });

  it("assigns and removes tenant admins for existing and new users", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const pending = await createUser(ctx, { phone: "+919822222222" });
    const session = await loginAs(ctx, pending.phoneE164);
    await api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);

    const promote = await api().post(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H).send({ phone: pending.phoneE164, fullName: "Promoted" });
    expect(promote.status).toBe(201);
    expect(promote.body.data).toMatchObject({ role: "TENANT_ADMIN", status: "APPROVED", fullName: "Test Member" });

    const fresh = await api().post(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H).send({ phone: "+919833333333", fullName: "Brand New" });
    expect(fresh.status).toBe(201);
    expect(fresh.body.data).toMatchObject({ fullName: "Brand New", role: "TENANT_ADMIN" });

    const admins = await api().get(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H);
    expect(admins.body.data).toHaveLength(2);

    expect((await api().delete(`/api/v1/platform/tenants/${tenant.id}/admins/${fresh.body.data.id}`).set(H)).status).toBe(204);
    expect((await api().get(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H)).body.data).toHaveLength(1);
    const [row] = await ctx.db.select().from(memberships).where(eq(memberships.id, fresh.body.data.id));
    expect(row?.role).toBe("MEMBER");
  });

  it("records billing plans, computes usage and freezes snapshots", async () => {
    const { tenant } = await createTenant(ctx);
    for (let i = 0; i < 3; i++) await memberSession(ctx, tenant.id); // active today (touchActivity via login? no — memberSession hits no tenant route)
    const base = `/api/v1/platform/tenants/${tenant.id}/billing`;

    const bad = await api().post(`${base}/plans`).set(H).send({ billingModel: "PER_ACTIVE_USER", effectiveFrom: "2026-01-01" });
    expect(bad.status).toBe(400);
    const p1 = await api().post(`${base}/plans`).set(H).send({ billingModel: "FLAT_FEE", flatFeeMinor: 1000000, effectiveFrom: "2026-01-01", notes: "Pilot" });
    expect(p1.status).toBe(201);
    const p2 = await api().post(`${base}/plans`).set(H).send({ billingModel: "PER_ACTIVE_USER", pricePerActiveUserMinor: 5000, effectiveFrom: "2026-06-01" });
    expect(p2.status).toBe(201);

    const billing = await api().get(base).set(H);
    expect(billing.body.data.currentPlan.id).toBe(p2.body.data.id);
    expect(billing.body.data.plans.find((p: { id: string }) => p.id === p1.body.data.id).effectiveTo).toBe("2026-05-31");

    // make members "active" inside a period by touching a tenant route
    const member = await memberSession(ctx, tenant.id);
    await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(member.headers);
    const today = new Date().toISOString().slice(0, 10);
    const usage = await api().get(`${base}/usage?from=${today}&to=${today}`).set(H);
    expect(usage.status).toBe(200);
    expect(usage.body.data).toMatchObject({ approvedMembers: 4, activeMembers: 1, plan: { id: p2.body.data.id }, estimatedAmountMinor: 5000, currency: "INR" });
    expect((await api().get(`${base}/usage?from=2026-01-10&to=2026-01-09`).set(H)).status).toBe(400);

    const snap = await api().post(`${base}/snapshots`).set(H).send({ periodStart: today, periodEnd: today, notes: "Invoice #1" });
    expect(snap.status).toBe(201);
    expect(snap.body.data).toMatchObject({ amountMinor: 5000, activeMemberCount: 1, billingPlanId: p2.body.data.id });
    expect((await api().post(`${base}/snapshots`).set(H).send({ periodStart: today, periodEnd: today })).status).toBe(409);

    const upd = await api().patch(`/api/v1/platform/billing/plans/${p2.body.data.id}`).set(H).send({ pricePerActiveUserMinor: 6000, notes: "Renegotiated" });
    expect(upd.body.data).toMatchObject({ pricePerActiveUserMinor: 6000, notes: "Renegotiated" });
    expect((await api().get(base).set(H)).body.data.snapshots).toHaveLength(1);
  });

  it("reports platform stats, searches users and toggles platform admins", async () => {
    const { tenant } = await createTenant(ctx, { slug: "stat-u" });
    const member = await memberSession(ctx, tenant.id, { phone: "+919844444444" });
    await api().post(`/api/v1/t/${tenant.slug}/posts`).set(member.headers).send({ body: "hello" });

    const stats = await api().get("/api/v1/platform/stats").set(H);
    expect(stats.body.data).toMatchObject({ tenants: { total: 1, byStatus: { ACTIVE: 1 } }, memberships: { APPROVED: 1 }, content: { posts: 1 } });
    expect(stats.body.data.perTenant[0]).toMatchObject({ slug: "stat-u", counts: { approvedMembers: 1, activeMembers30d: 1 } });

    const users = await api().get("/api/v1/platform/users?phone=9844").set(H);
    expect(users.body.total).toBe(1);
    expect(users.body.data[0].memberships[0].tenant.slug).toBe("stat-u");

    const self = await api().post(`/api/v1/platform/users/${platform.user.id}/platform-admin`).set(H).send({ enabled: false });
    expect(self.status).toBe(403);
    const grant = await api().post(`/api/v1/platform/users/${member.user.id}/platform-admin`).set(H).send({ enabled: true });
    expect(grant.body.data.isPlatformAdmin).toBe(true);
    const relogin = await loginAs(ctx, "+919844444444");
    expect(relogin.user.isPlatformAdmin).toBe(true);
    expect((await api().get("/api/v1/platform/stats").set(auth(relogin.accessToken))).status).toBe(200);

    const audit = await api().get("/api/v1/platform/audit?action=platform.admin").set(H);
    expect(audit.body.total).toBe(1);
  });
});
