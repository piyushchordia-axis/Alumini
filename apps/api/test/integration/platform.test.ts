import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, memberActivityDays, memberships, users } from "../../src/db/schema";
import { wallPartsInZone } from "@illuminize/shared";
import { refusingAudit, untilSomeoneSleeps, untilSomeoneWaitsFor, withTrigger } from "../helpers/db";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
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
        initialAdmin: { phone: "98111 11111", fullName: "First Admin", startYear: 2001, batchYear: 2005 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.tenant).toMatchObject({ slug: "new-college", country: "IN", primaryColor: "#ff0000", status: "ACTIVE" });
    expect(res.body.data.settings.memberApprovalMode).toBe("ADMIN_APPROVAL");
    expect(res.body.data.admins).toEqual([expect.objectContaining({ fullName: "First Admin", phone: "+919811111111", role: "TENANT_ADMIN", status: "APPROVED", startYear: 2001, batchYear: 2005 })]);
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

  it("gives a new admin the years given, checked as a member's are, or ones that suit the institution's type", async () => {
    let phones = 0;
    const create = (slug: string, type: string, years: object = {}) =>
      api()
        .post("/api/v1/platform/tenants")
        .set(H)
        .send({ slug, name: `Institution ${slug}`, type, initialAdmin: { phone: `+91981100000${++phones}`, fullName: "First Admin", ...years } });
    const thisYear = (res: request.Response) => wallPartsInZone(new Date(), res.body.data.tenant.timezone).year;

    const given = await create("given-college", "COLLEGE", { startYear: 2001, batchYear: 2005 });
    expect(given.body.data.admins[0]).toMatchObject({ startYear: 2001, batchYear: 2005 });
    // Last year for both, and so no current pupil at a school.
    const fallback = await create("plain-school", "SCHOOL");
    expect(fallback.body.data.admins[0]).toMatchObject({ startYear: thisYear(fallback) - 1, batchYear: thisYear(fallback) - 1 });
    // A member of a community since this year, who still belongs.
    const community = await create("new-samaj", "OTHER");
    expect(community.body.data.admins[0]).toMatchObject({ startYear: thisYear(community), batchYear: null });
    expect((await create("old-samaj", "OTHER", { startYear: 1996 })).body.data.admins[0]).toMatchObject({ startYear: 1996, batchYear: null });

    const pathsOf = (res: request.Response) => {
      expect(res.status).toBe(400);
      return Object.fromEntries((res.body.error.details as Array<{ path: string; message: string }>).map((d) => [d.path, d.message]));
    };
    expect(pathsOf(await create("backwards", "COLLEGE", { startYear: 2010, batchYear: 2005 }))).toEqual({ "initialAdmin.batchYear": "Can't be before the year you joined" });
    expect(pathsOf(await create("no-end", "UNIVERSITY", { startYear: 2010 }))).toEqual({ "initialAdmin.batchYear": "Enter the year you left, or will leave" });
    // An end alone is never taken as the start too, even one ahead, which no start may be: the blank start is asked for.
    const ahead = new Date().getFullYear() + 2;
    expect(pathsOf(await create("no-start", "SCHOOL", { batchYear: ahead }))).toEqual({ "initialAdmin.startYear": "Enter the year you joined" });
    expect(pathsOf(await create("left-samaj", "OTHER", { batchYear: 2015 }))).toEqual({ "initialAdmin.startYear": "Enter the year you joined" });
    expect(pathsOf(await create("null-end", "COLLEGE", { startYear: 2010, batchYear: null }))).toEqual({ "initialAdmin.batchYear": "Enter the year you left, or will leave" });
    // Refused before anything is kept: the institution isn't created either.
    expect((await api().get("/api/v1/tenants/backwards")).status).toBe(404);

    const tenantId = given.body.data.tenant.id as string;
    const assigned = await api().post(`/api/v1/platform/tenants/${tenantId}/admins`).set(H).send({ phone: "+919833333333", fullName: "Second Admin", startYear: 2003, batchYear: 2007 });
    expect(assigned.body.data).toMatchObject({ startYear: 2003, batchYear: 2007 });
    const refused = await api().post(`/api/v1/platform/tenants/${tenantId}/admins`).set(H).send({ phone: "+919844444444", fullName: "Third Admin", startYear: 2030 });
    expect(Object.keys(pathsOf(refused))).toContain("startYear");
  });

  it("gives a community's admin no start past the server's year, even when it's already New Year's Day at the institution", async () => {
    // The fallback reads the institution's year; a member's start is capped by the server's clock, here UTC.
    const zone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    process.env.TZ = "UTC";
    const year = new Date().getUTCFullYear();
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:00 UTC on 31 December is 01:30 on 1 January in India.
    vi.setSystemTime(new Date(`${year}-12-31T20:00:00Z`));
    try {
      const headers = auth((await loginAs(ctx, "+919999999999")).accessToken);
      const res = await api()
        .post("/api/v1/platform/tenants")
        .set(headers)
        .send({ slug: "new-year-samaj", name: "New Year Samaj", type: "OTHER", timezone: "Asia/Kolkata", initialAdmin: { phone: "+919855555555", fullName: "First Admin" } });
      expect(res.status).toBe(201);
      expect(wallPartsInZone(new Date(), res.body.data.tenant.timezone).year).toBe(year + 1);
      expect(res.body.data.admins[0]).toMatchObject({ startYear: year, batchYear: null });
      // So the admin can save their profile, which both apps send with the start as stored.
      const admin = auth((await loginAs(ctx, "+919855555555")).accessToken);
      const saved = await api().patch("/api/v1/t/new-year-samaj/memberships/me").set(admin).send({ startYear: year, batchYear: null, city: "Surat" });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
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
    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.tenantId, tenant.id));
    expect(audits.filter((a) => a.action === "platform.tenant.admin.assign").map((a) => [a.targetId, a.metadata])).toEqual([
      [promote.body.data.id, { created: false, from: "PENDING" }],
      [fresh.body.data.id, { created: true, from: null }],
    ]);
    expect(audits.filter((a) => a.action === "platform.tenant.admin.remove").map((a) => a.targetId)).toEqual([fresh.body.data.id]);
  });

  it("won't make a suspended member an admin, which would lift the suspension: they're reinstated first", async () => {
    const { tenant } = await createTenant(ctx);
    const user = await createUser(ctx, { phone: "+919822222222" });
    const suspended = await createMembership(ctx, tenant.id, user.id, { status: "SUSPENDED" });
    await ctx.db.update(memberships).set({ statusReason: "Spam" }).where(eq(memberships.id, suspended.id));
    const res = await api().post(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H).send({ phone: user.phoneE164, fullName: "Promoted" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: "CONFLICT", message: "This member is suspended. Reinstate them first." });
    const [row] = await ctx.db.select().from(memberships).where(eq(memberships.id, suspended.id));
    expect(row).toMatchObject({ status: "SUSPENDED", role: "MEMBER", statusReason: "Spam" });
    expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "platform.tenant.admin.assign"))).toEqual([]);
  });

  it("assigns someone as they register without a deadlock: whichever comes second gets a clean answer", async () => {
    const { tenant } = await createTenant(ctx);
    const phone = "+919855555555";
    // Signed in but not registered yet, so they have no display name, which assigning them sets.
    const session = await loginAs(ctx, phone);
    await withTrigger(ctx, "after insert on memberships", "perform pg_sleep(1); return new;", async () => {
      const registering = api().post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE).then((res) => res);
      await untilSomeoneSleeps(ctx);
      const assigning = api().post(`/api/v1/platform/tenants/${tenant.id}/admins`).set(H).send({ phone, fullName: "Promoted" }).then((res) => res);
      // Staff's insert waits for the registration's, which goes on to update the user's row: staff mustn't hold it by then.
      await untilSomeoneWaitsFor(ctx, "transactionid");
      const [registered, assigned] = await Promise.all([registering, assigning]);
      expect(registered.status).toBe(201);
      expect(assigned.status).toBe(409);
    });
    expect(await ctx.db.select().from(memberships).where(eq(memberships.tenantId, tenant.id))).toEqual([expect.objectContaining({ role: "MEMBER", fullName: PROFILE.fullName })]);
    expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "platform.tenant.admin.assign"))).toEqual([]);
  });

  it("changes nobody's admin role or staff flag unless the change is audited with it", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id, { phone: "+919844444444" });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const admins = `/api/v1/platform/tenants/${tenant.id}/admins`;
    await refusingAudit(ctx, "platform.tenant.admin.assign", async () => {
      expect((await api().post(admins).set(H).send({ phone: member.user.phoneE164, fullName: "Promoted" })).status).toBe(500);
      expect((await api().post(admins).set(H).send({ phone: "+919833333333", fullName: "Brand New" })).status).toBe(500);
    });
    await refusingAudit(ctx, "platform.tenant.admin.remove", async () => {
      expect((await api().delete(`${admins}/${admin.membership.id}`).set(H)).status).toBe(500);
    });
    await refusingAudit(ctx, "platform.admin.grant", async () => {
      expect((await api().post(`/api/v1/platform/users/${member.user.id}/platform-admin`).set(H).send({ enabled: true })).status).toBe(500);
    });
    const rows = await ctx.db.select().from(memberships).where(eq(memberships.tenantId, tenant.id));
    expect(rows.map((r) => [r.id, r.role]).sort()).toEqual(
      [
        [member.membership.id, "MEMBER"],
        [admin.membership.id, "TENANT_ADMIN"],
      ].sort(),
    );
    // The new user went with the refused assignment, and the flag stayed off.
    expect(await ctx.db.select().from(users).where(eq(users.phoneE164, "+919833333333"))).toEqual([]);
    expect((await ctx.db.select().from(users).where(eq(users.id, member.user.id)))[0]!.isPlatformAdmin).toBe(false);
    expect((await ctx.db.select().from(auditLog)).filter((a) => a.action.startsWith("platform."))).toEqual([]);
  });

  it("records billing plans, computes usage and freezes snapshots", async () => {
    const { tenant } = await createTenant(ctx);
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

    // Four members approved in January; activity recorded on specific (India) calendar days.
    const [a, b, c, d] = await Promise.all([0, 1, 2, 3].map(() => memberSession(ctx, tenant.id)));
    await ctx.db.update(memberships).set({ approvedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(memberships.tenantId, tenant.id));
    await ctx.db.insert(memberActivityDays).values([
      { tenantId: tenant.id, membershipId: a!.membership.id, day: "2026-07-03" },
      { tenantId: tenant.id, membershipId: a!.membership.id, day: "2026-07-20" },
      { tenantId: tenant.id, membershipId: b!.membership.id, day: "2026-06-30" },
      { tenantId: tenant.id, membershipId: c!.membership.id, day: "2026-07-31" },
    ]);
    // d was suspended in June (not billable in July); a fifth member joined in August.
    await ctx.db.update(memberships).set({ status: "SUSPENDED", statusChangedAt: new Date("2026-06-15T00:00:00Z") }).where(eq(memberships.id, d!.membership.id));
    const late = await memberSession(ctx, tenant.id);
    await ctx.db.update(memberships).set({ approvedAt: new Date("2026-08-05T00:00:00Z") }).where(eq(memberships.id, late.membership.id));

    const july = await api().get(`${base}/usage?from=2026-07-01&to=2026-07-31`).set(H);
    expect(july.status).toBe(200);
    expect(july.body.data).toMatchObject({ timeZone: "Asia/Kolkata", approvedMembers: 3, activeMembers: 2, newMembers: 0, cycleFraction: 1, estimatedAmountMinor: 10000, plan: { id: p2.body.data.id } });

    // Half a month is billed as half a cycle.
    const firstHalf = await api().get(`${base}/usage?from=2026-07-01&to=2026-07-15`).set(H);
    expect(firstHalf.body.data).toMatchObject({ activeMembers: 1, estimatedAmountMinor: Math.round(5000 * (15 / 31)) });
    expect((await api().get(`${base}/usage?from=2026-01-10&to=2026-01-09`).set(H)).status).toBe(400);
    expect((await api().get(`${base}/usage?from=2026-02-30&to=2026-03-01`).set(H)).status).toBe(400);

    // August: the late joiner is new; nobody was active.
    const august = await api().get(`${base}/usage?from=2026-08-01&to=2026-08-31`).set(H);
    expect(august.body.data).toMatchObject({ approvedMembers: 4, newMembers: 1, activeMembers: 0, estimatedAmountMinor: 0 });

    const snap = await api().post(`${base}/snapshots`).set(H).send({ periodStart: "2026-07-01", periodEnd: "2026-07-31", notes: "Invoice #1" });
    expect(snap.status).toBe(201);
    expect(snap.body.data).toMatchObject({ amountMinor: 10000, activeMemberCount: 2, approvedMemberCount: 3, billingPlanId: p2.body.data.id, notes: "Invoice #1" });
    expect((await api().post(`${base}/snapshots`).set(H).send({ periodStart: "2026-07-01", periodEnd: "2026-07-31" })).status).toBe(409);

    const upd = await api().patch(`/api/v1/platform/billing/plans/${p2.body.data.id}`).set(H).send({ pricePerActiveUserMinor: 6000, notes: "Renegotiated" });
    expect(upd.body.data).toMatchObject({ pricePerActiveUserMinor: 6000, notes: "Renegotiated" });
    expect((await api().patch(`/api/v1/platform/billing/plans/${p2.body.data.id}`).set(H).send({ pricePerActiveUserMinor: null })).status).toBe(400);
    expect((await api().get(base).set(H)).body.data.snapshots).toHaveLength(1);
  });

  it("editing one field of a plan leaves the others alone, and quarterly plans are prorated", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/platform/tenants/${tenant.id}/billing`;
    const plan = await api().post(`${base}/plans`).set(H).send({ billingModel: "FLAT_FEE", flatFeeMinor: 300000, billingCycle: "QUARTERLY", currency: "USD", effectiveFrom: "2026-01-01" });
    expect(plan.status).toBe(201);
    const upd = await api().patch(`/api/v1/platform/billing/plans/${plan.body.data.id}`).set(H).send({ notes: "Paid by wire" });
    expect(upd.body.data).toMatchObject({ billingCycle: "QUARTERLY", currency: "USD", flatFeeMinor: 300000, notes: "Paid by wire" });

    const month = await api().get(`${base}/usage?from=2026-04-01&to=2026-04-30`).set(H);
    expect(month.body.data).toMatchObject({ cycleFraction: 0.3333, estimatedAmountMinor: 100000, currency: "USD" });
    const quarter = await api().get(`${base}/usage?from=2026-04-01&to=2026-06-30`).set(H);
    expect(quarter.body.data).toMatchObject({ cycleFraction: 1, estimatedAmountMinor: 300000 });

    // Ending a plan: effectiveTo can be set, not before it started.
    expect((await api().patch(`/api/v1/platform/billing/plans/${plan.body.data.id}`).set(H).send({ effectiveTo: "2025-12-31" })).status).toBe(400);
    const ended = await api().patch(`/api/v1/platform/billing/plans/${plan.body.data.id}`).set(H).send({ effectiveTo: "2026-06-30" });
    expect(ended.body.data.effectiveTo).toBe("2026-06-30");
  });

  it("records a member's activity day in the billing time zone", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(member.headers);
    const rows = await ctx.db.select().from(memberActivityDays).where(eq(memberActivityDays.membershipId, member.membership.id));
    const todayInIndia = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(rows.map((r) => r.day)).toEqual([todayInIndia]);
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
