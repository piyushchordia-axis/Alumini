import { zonedWallTimeToUtc } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, invitations, memberActivityDays, memberFieldValues, outboundMessages, postComments, posts, tenantBillingPlans, tenantProfileFields, tenants, users } from "../../src/db/schema";
import { streamCsv } from "../../src/lib/csvStream";
import { createLogger } from "../../src/lib/logger";
import { errorHandler } from "../../src/middleware/errorHandler";
import { billingCountsForPeriod } from "../../src/repositories/memberships.repo";
import { analyticsRange } from "../../src/services/analytics.service";
import { addDays, billingPeriod } from "../../src/services/billing.periods";
import { EXPORT_BATCH } from "../../src/services/exports.service";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** Splits a CSV download into rows of cells (no embedded newlines in these fixtures). */
function parseRows(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .split("\r\n")
    .filter(Boolean)
    .map((line) => {
      const cells: string[] = [];
      let cur = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i]!;
        if (quoted && ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          quoted = !quoted;
        } else if (ch === "," && !quoted) {
          cells.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells;
    });
}

const csvRequest = (r: request.Test) => r.buffer(true).parse((res, cb) => {
  let data = "";
  res.setEncoding("utf8");
  res.on("data", (c: string) => (data += c));
  res.on("end", () => cb(null, data));
});

describe.skipIf(!dbAvailable)("admin analytics and exports", () => {
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

  async function setup(timezone = "Asia/Kolkata") {
    const { tenant } = await createTenant(ctx, { name: "Analytics College" });
    await ctx.db.update(tenants).set({ timezone }).where(eq(tenants.id, tenant.id));
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", fullName: "Admin Person", approvedAt: new Date("2020-01-01T00:00:00Z") });
    return { tenant: { ...tenant, timezone }, admin, base: `/api/v1/t/${tenant.slug}/admin` };
  }

  it("buckets sign-ups by week in the institution's time zone", async () => {
    const { tenant, admin, base } = await setup("Asia/Kolkata");
    const tz = tenant.timezone;
    const r = analyticsRange(tz, 12);
    const monday = r.weekList[10]!; // last full week
    // 00:30 Monday in India is still Sunday in UTC: it belongs to the Monday week, not the one before.
    const mondayEarly = new Date(zonedWallTimeToUtc(`${monday}T00:30`, tz)!);
    const sundayLate = new Date(zonedWallTimeToUtc(`${addDays(monday, -1)}T23:30`, tz)!);
    expect(mondayEarly.getUTCDay()).toBe(0);
    for (const at of [mondayEarly, sundayLate]) {
      const u = await createUser(ctx);
      await createMembership(ctx, tenant.id, u.id, { approvedAt: at });
    }
    const pending = await createUser(ctx);
    await createMembership(ctx, tenant.id, pending.id, { status: "PENDING" });

    const res = await api().get(`${base}/analytics?weeks=12`).set(admin.headers);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.timeZone).toBe(tz);
    expect(d.weeks).toHaveLength(12);
    expect(d.weeks[11]).toBe(r.weekList[11]);
    expect(d.series.joined[10]).toBe(1);
    expect(d.series.joined[9]).toBe(1);
    expect(d.series.registered[11]).toBe(4); // everyone was created this week; joined counts approvals only
    expect(d.kpis).toMatchObject({ members: 3, newMembers: 2, newMembersPrev: 0 });

    const member = await memberSession(ctx, tenant.id);
    expect((await api().get(`${base}/analytics`).set(member.headers)).status).toBe(403);
    expect((await api().get(`${base}/analytics?weeks=1`).set(admin.headers)).status).toBe(400);
  });

  it("counts active members the way billing does, and content per week", async () => {
    const { tenant, admin, base } = await setup("Asia/Kolkata");
    const r = analyticsRange(tenant.timezone, 4);
    const ms = await Promise.all([0, 1, 2].map(async () => createMembership(ctx, tenant.id, (await createUser(ctx)).id, { approvedAt: new Date("2021-01-01T00:00:00Z") })));
    const [a, b, c] = ms as [(typeof ms)[0], (typeof ms)[0], (typeof ms)[0]];
    const day = (membershipId: string, d: string) => ctx.db.insert(memberActivityDays).values({ tenantId: tenant.id, membershipId, day: d });
    await day(a.id, r.firstWeek);
    await day(a.id, r.today);
    await day(b.id, addDays(r.firstWeek, 1));
    await day(c.id, addDays(r.firstWeek, -3)); // the period before
    await day(b.id, addDays(r.firstWeek, -10));

    const inWeek = (i: number) => new Date(zonedWallTimeToUtc(`${addDays(r.weekList[i]!, 2)}T12:00`, tenant.timezone)!);
    const [p1] = await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: a.id, body: "One", moderationStatus: "APPROVED", createdAt: inWeek(0) }).returning();
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: a.id, body: "Two", moderationStatus: "APPROVED", createdAt: inWeek(2) });
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: b.id, body: "Rejected", moderationStatus: "REJECTED", createdAt: inWeek(2) });
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: b.id, body: "Earlier", moderationStatus: "APPROVED", createdAt: new Date(r.prevFrom.getTime() + 86_400_000) });
    await ctx.db.insert(postComments).values({ tenantId: tenant.id, postId: p1!.id, authorMembershipId: b.id, body: "Nice", moderationStatus: "APPROVED", createdAt: inWeek(0) });

    const d = (await api().get(`${base}/analytics?weeks=4`).set(admin.headers)).body.data;
    const billing = await billingCountsForPeriod(ctx.db, tenant.id, { ...billingPeriod(r.firstWeek, r.today, ctx.config.BILLING_TIMEZONE), fromDay: r.firstWeek, toDay: r.today });
    expect(d.kpis.activeMembers).toBe(billing.active);
    expect(d.kpis.activeMembers).toBe(3); // a, b, and the admin who is using the app right now
    expect(d.kpis.activeMembersPrev).toBe(2);
    expect(d.series.active[0]).toBe(2);
    expect(d.series.active.slice(1, 3)).toEqual([0, 0]);
    expect(d.series.posts).toEqual([1, 0, 1, 0]);
    expect(d.series.comments).toEqual([1, 0, 0, 0]);
    expect(d.kpis).toMatchObject({ posts: 2, postsPrev: 1 });
  });

  it("summarises who the members are: batches, top cities, completeness, choice fields and invites", async () => {
    const { tenant, admin, base } = await setup();
    const cities = ["Mumbai", "mumbai ", "Pune", ...Array.from({ length: 11 }, (_, i) => `City ${String.fromCharCode(65 + i)}`)];
    const ms = [];
    for (const [i, city] of cities.entries()) ms.push(await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { city, batchYear: 2010 + (i % 2), professionType: i === 0 ? "STUDENT" : "EMPLOYED" }));
    const [field] = await ctx.db
      .insert(tenantProfileFields)
      .values({ tenantId: tenant.id, key: "house", label: "House", type: "SELECT", options: [{ value: "red", label: "Red House" }, { value: "blue", label: "Blue House" }] })
      .returning();
    const [multi] = await ctx.db
      .insert(tenantProfileFields)
      .values({ tenantId: tenant.id, key: "sports", label: "Sports", type: "MULTI_SELECT", options: [{ value: "cricket", label: "Cricket" }, { value: "chess", label: "Chess" }], position: 1 })
      .returning();
    await ctx.db.insert(memberFieldValues).values([
      { tenantId: tenant.id, membershipId: ms[0]!.id, fieldId: field!.id, value: "red" },
      { tenantId: tenant.id, membershipId: ms[1]!.id, fieldId: field!.id, value: "red" },
      { tenantId: tenant.id, membershipId: ms[2]!.id, fieldId: field!.id, value: "blue" },
      { tenantId: tenant.id, membershipId: ms[0]!.id, fieldId: multi!.id, value: ["cricket", "chess"] },
      { tenantId: tenant.id, membershipId: ms[1]!.id, fieldId: multi!.id, value: ["chess"] },
    ]);
    const expires = new Date(Date.now() + 86_400_000);
    await ctx.db.insert(invitations).values([
      { tenantId: tenant.id, phoneE164: "+919800000001", token: "t1", expiresAt: expires },
      { tenantId: tenant.id, phoneE164: "+919800000002", token: "t2", expiresAt: expires, status: "SENT", sendCount: 1 },
      { tenantId: tenant.id, phoneE164: "+919800000003", token: "t3", expiresAt: expires, status: "ACCEPTED", sendCount: 2 },
    ]);

    const d = (await api().get(`${base}/analytics`).set(admin.headers)).body.data;
    expect(d.coverage.cities[0]).toEqual({ label: "Mumbai", count: 3 }); // the admin lives in Mumbai too; spelling variants merge
    expect(d.coverage.cities).toHaveLength(11);
    expect(d.coverage.cities[10]).toEqual({ label: "Other", count: 3 });
    expect(d.coverage.batches).toEqual([
      { label: "2010", count: 8 },
      { label: "2011", count: 7 },
    ]);
    expect(d.coverage.professions[0]).toEqual({ label: "Working at a company", count: 14 });
    expect(d.coverage.completeness).toMatchObject({ total: 15, city: 15, photo: 0, email: 0 });
    expect(d.coverage.fields).toEqual([
      { key: "house", label: "House", options: [{ label: "Red House", count: 2 }, { label: "Blue House", count: 1 }] },
      { key: "sports", label: "Sports", options: [{ label: "Chess", count: 2 }, { label: "Cricket", count: 1 }] },
    ]);
    expect(d.invites).toEqual({ total: 3, sent: 2, accepted: 1 });
  });

  it("exports members as a UTF-8 CSV with every field, escaped against spreadsheet formulas, and audits it", async () => {
    const { tenant, admin, base } = await setup();
    const u = await createUser(ctx, { phone: "+919811122233" });
    await ctx.db.update(users).set({ email: "asha@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
    const m = await createMembership(ctx, tenant.id, u.id, { fullName: 'Rao, "Asha"', companyName: "=HYPERLINK(\"http://x\")", city: "Pune", country: "IN", approvedAt: new Date("2024-03-10T20:00:00Z") });
    const u2 = await createUser(ctx);
    await ctx.db.update(users).set({ email: "unconfirmed@example.com" }).where(eq(users.id, u2.id));
    await createMembership(ctx, tenant.id, u2.id, { fullName: "Bala Unconfirmed", status: "PENDING" });
    const [pub] = await ctx.db.insert(tenantProfileFields).values({ tenantId: tenant.id, key: "house", label: "House", type: "TEXT" }).returning();
    const [secret] = await ctx.db.insert(tenantProfileFields).values({ tenantId: tenant.id, key: "notes", label: "Admin notes", type: "TEXT", visibility: "ADMINS", memberEditable: false, position: 1 }).returning();
    await ctx.db.insert(memberFieldValues).values([
      { tenantId: tenant.id, membershipId: m.id, fieldId: pub!.id, value: "Ganga; North" },
      { tenantId: tenant.id, membershipId: m.id, fieldId: secret!.id, value: "Donor" },
    ]);

    const res = await csvRequest(api().get(`${base}/exports/members.csv`).set(admin.headers));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toMatch(new RegExp(`^attachment; filename="${tenant.slug}-members-\\d{4}-\\d{2}-\\d{2}\\.csv"$`));
    const body = res.body as string;
    expect(body.startsWith("\uFEFFName,Phone,Email,")).toBe(true);
    const rows = parseRows(body);
    expect(rows[0]!.slice(-2)).toEqual(["House", "Admin notes"]);
    const asha = rows.find((r) => r[0] === 'Rao, "Asha"')!;
    expect(asha.slice(0, 3)).toEqual(["Rao, \"Asha\"", "'+919811122233", "asha@example.com"]);
    expect(asha[7]).toBe("'=HYPERLINK(\"http://x\")");
    expect(asha[10]).toBe("India");
    expect(asha[13]).toBe("2024-03-11"); // approved late evening UTC: the next day in India
    expect(asha.slice(-2)).toEqual(["Ganga; North", "Donor"]);
    expect(body).toContain('"Rao, ""Asha"""');
    const bala = rows.find((r) => r[0] === "Bala Unconfirmed")!;
    expect(bala[2]).toBe(""); // unconfirmed addresses are left out
    expect(bala[4]).toBe("Pending approval");
    expect(rows).toHaveLength(4);

    const [entry] = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "export.members"));
    expect(entry).toMatchObject({ tenantId: tenant.id, actorMembershipId: admin.membership.id, metadata: { customFields: 2 } });

    const member = await memberSession(ctx, tenant.id);
    expect((await api().get(`${base}/exports/members.csv`).set(member.headers)).status).toBe(403);
  });

  it("streams every member exactly once across batches", async () => {
    const { tenant, admin, base } = await setup();
    const n = EXPORT_BATCH + 7;
    await ctx.db.execute(sql`insert into users (phone_e164) select '+9170' || lpad(g::text, 8, '0') from generate_series(1, ${n}) g`);
    // Many share a name, so the keyset has to break ties on the id.
    await ctx.db.execute(sql`
      insert into memberships (tenant_id, user_id, full_name, batch_year, profession_type, status)
      select ${tenant.id}, id, 'Member ' || (row_number() over () % 50), 2010, 'EMPLOYED', 'APPROVED' from users where phone_e164 like '+9170%'`);
    const res = await csvRequest(api().get(`${base}/exports/members.csv`).set(admin.headers));
    const rows = parseRows(res.body as string).slice(1);
    expect(rows).toHaveLength(n + 1);
    expect(new Set(rows.map((r) => r[1])).size).toBe(n + 1);
    const names = rows.map((r) => r[0]!);
    expect([...names].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))).toEqual(names);
  });

  it("exports activity per member for the chosen weeks", async () => {
    const { tenant, admin, base } = await setup();
    const r = analyticsRange(tenant.timezone, 4);
    const a = await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Asha", approvedAt: new Date("2021-01-01") });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Never approved", status: "PENDING" });
    await ctx.db.insert(memberActivityDays).values([
      { tenantId: tenant.id, membershipId: a.id, day: r.firstWeek },
      { tenantId: tenant.id, membershipId: a.id, day: r.today },
      { tenantId: tenant.id, membershipId: a.id, day: addDays(r.firstWeek, -1) },
    ]);
    await ctx.db.insert(posts).values([
      { tenantId: tenant.id, authorMembershipId: a.id, body: "x", moderationStatus: "APPROVED" },
      { tenantId: tenant.id, authorMembershipId: a.id, body: "y", moderationStatus: "PENDING" },
      { tenantId: tenant.id, authorMembershipId: a.id, body: "old", moderationStatus: "APPROVED", createdAt: new Date(r.from.getTime() - 1000) },
    ]);
    const res = await csvRequest(api().get(`${base}/exports/activity.csv?weeks=4`).set(admin.headers));
    expect(res.headers["content-disposition"]).toContain(`${tenant.slug}-activity-${r.firstWeek}-to-${r.today}.csv`);
    const rows = parseRows(res.body as string);
    expect(rows[0]).toEqual(["Name", "Phone", "Batch", "Status", "Active days", "Posts", "Comments", "Jobs", "Events", "Last active"]);
    expect(rows.map((x) => x[0])).toEqual(["Name", "Admin Person", "Asha"]);
    expect(rows[2]!.slice(4, 9)).toEqual(["2", "2", "0", "0", "0"]);
  });

  it("limits how often an admin can export", async () => {
    const { admin, base } = await setup();
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      for (let i = 0; i < 20; i++) expect((await csvRequest(api().get(`${base}/exports/members.csv`).set(admin.headers))).status).toBe(200);
      expect((await api().get(`${base}/exports/activity.csv`).set(admin.headers)).status).toBe(429);
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  });
});

describe("streamed CSV failures", () => {
  function appWith(pages: () => AsyncGenerator<unknown[][]>) {
    const app = express();
    app.get("/x", async (_req, res, next) => {
      try {
        await streamCsv(res, "x.csv", ["a"], pages());
      } catch (err) {
        next(err);
      }
    });
    app.use(errorHandler(createLogger("silent", false)));
    return app;
  }

  it("answers with a JSON error when the first page fails", async () => {
    const res = await request(
      // eslint-disable-next-line require-yield
      appWith(async function* () {
        throw new Error("boom");
      }),
    ).get("/x");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("INTERNAL");
  });

  it("cuts the connection when a later page fails, rather than ending a truncated file normally", async () => {
    const app = appWith(async function* () {
      yield [["1"], ["2"]];
      throw new Error("boom");
    });
    await expect(csvRequest(request(app).get("/x"))).rejects.toThrow();
  });
});

describe.skipIf(!dbAvailable)("platform comparison", () => {
  let ctx: TestContext;
  let H: Record<string, string>;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    H = auth((await loginAs(ctx, "+919999999999")).accessToken);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("compares every institution (more than a page of them) for a billing period", async () => {
    await ctx.db.execute(sql`insert into tenants (slug, name, type, city, country) select 'bulk-' || g, 'Bulk ' || lpad(g::text, 3, '0'), 'COLLEGE', 'Pune', 'IN' from generate_series(1, 105) g`);
    const { tenant } = await createTenant(ctx, { name: "Alpha College" });
    await ctx.db.insert(tenantBillingPlans).values({ tenantId: tenant.id, billingModel: "PER_ACTIVE_USER", pricePerActiveUserMinor: 1000, effectiveFrom: "2026-01-01", messageRatesMinor: { EMAIL: 50 } });
    const ms = await Promise.all([0, 1, 2].map(async () => createMembership(ctx, tenant.id, (await createUser(ctx)).id, { approvedAt: new Date("2026-06-15T10:00:00Z") })));
    await ctx.db.insert(memberActivityDays).values([
      { tenantId: tenant.id, membershipId: ms[0]!.id, day: "2026-07-03" },
      { tenantId: tenant.id, membershipId: ms[0]!.id, day: "2026-07-04" },
      { tenantId: tenant.id, membershipId: ms[1]!.id, day: "2026-07-20" },
      { tenantId: tenant.id, membershipId: ms[2]!.id, day: "2026-08-01" },
    ]);
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: ms[0]!.id, body: "July", moderationStatus: "APPROVED", createdAt: new Date("2026-07-10T10:00:00Z") });
    for (const status of ["SENT", "DELIVERED", "FAILED"] as const) {
      await ctx.db.insert(outboundMessages).values({ tenantId: tenant.id, type: "PLATFORM_TEST", status, channels: ["EMAIL"], channel: "EMAIL", sentAt: status === "FAILED" ? null : new Date("2026-07-10T10:00:00Z"), payload: {} });
    }

    const res = await request(ctx.app).get("/api/v1/platform/analytics/comparison?from=2026-07-01&to=2026-07-31").set(H);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    expect(d.rows).toHaveLength(106);
    const alpha = d.rows.find((r: { tenant: { id: string } }) => r.tenant.id === tenant.id);
    expect(alpha).toMatchObject({
      approvedMembers: 3,
      newMembers: 0,
      activeMembers: 2,
      activityRate: 0.667,
      content: { posts: 1, jobs: 0, events: 0 },
      messages: { EMAIL: 2, WHATSAPP: 0, SMS: 0 },
      plan: { billingModel: "PER_ACTIVE_USER", billingCycle: "MONTHLY", currency: "INR" },
      estimatedAmountMinor: 2 * 1000 + 2 * 50,
    });

    const stats = await request(ctx.app).get("/api/v1/platform/stats").set(H);
    expect(stats.body.data.perTenant).toHaveLength(106);

    const csv = await csvRequest(request(ctx.app).get("/api/v1/platform/exports/comparison.csv?from=2026-07-01&to=2026-07-31").set(H));
    expect(csv.headers["content-disposition"]).toBe('attachment; filename="institutions-2026-07-01-to-2026-07-31.csv"');
    const rows = parseRows(csv.body as string);
    expect(rows).toHaveLength(107);
    const line = rows.find((r) => r[0] === "Alpha College")!;
    expect(line.slice(3, 7)).toEqual(["3", "0", "2", "66.7"]);
    expect(line.slice(-2)).toEqual(["21.00", "INR"]);
    expect((await ctx.db.select().from(auditLog).where(eq(auditLog.action, "platform.export.comparison")))[0]?.metadata).toMatchObject({ institutions: 106, from: "2026-07-01", to: "2026-07-31" });

    const member = await memberSession(ctx, tenant.id);
    expect((await request(ctx.app).get("/api/v1/platform/analytics/comparison").set(member.headers)).status).toBe(403);
  });
});
