import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, notifications, tenantJobRuns, tenants } from "../../src/db/schema";
import { celebrantsOn } from "../../src/repositories/engagement.repo";
import { engagementTick, localClock } from "../../src/services/celebrations.service";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("celebrations", () => {
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

  async function tenantIn(timezone: string, name = "Celebration College") {
    const { tenant } = await createTenant(ctx, { name });
    await ctx.db.update(tenants).set({ timezone }).where(eq(tenants.id, tenant.id));
    return { ...tenant, timezone };
  }

  it("queues an institution's greetings once its local time passes 9:00, once per day", async () => {
    const india = await tenantIn("Asia/Kolkata", "India U");
    const ny = await tenantIn("America/New_York", "NY U");
    await memberSession(ctx, india.id, { dateOfBirth: "1990-03-15" });

    // 08:30 in India (UTC+5:30): not yet. 23:00 the day before in New York: due for that day.
    const tick = async (at: string) => {
      ctx.jobs.clear();
      await engagementTick(ctx, { at }, { attempt: 1, maxAttempts: 1 });
      return ctx.jobs.peek("celebrations.tenant").map((j) => j.data);
    };
    expect(await tick("2026-03-15T03:00:00Z")).toEqual([{ tenantId: ny.id, day: "2026-03-14" }]);
    const at0900 = await tick("2026-03-15T03:30:00Z");
    expect(at0900).toContainEqual({ tenantId: india.id, day: "2026-03-15" });

    await ctx.jobs.drain();
    const greetings = await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION"));
    expect(greetings).toHaveLength(1);
    expect(greetings[0]).toMatchObject({ title: "🎂 Happy birthday!", data: { kind: "BIRTHDAY", day: "2026-03-15" } });
    const [run] = await ctx.db.select().from(tenantJobRuns).where(and(eq(tenantJobRuns.tenantId, india.id), eq(tenantJobRuns.periodKey, "2026-03-15")));
    expect(run).toMatchObject({ job: "celebrations", status: "DONE" });

    // Later ticks the same day queue nothing for India; running it again anyway adds nothing.
    expect(await tick("2026-03-15T05:00:00Z")).not.toContainEqual({ tenantId: india.id, day: "2026-03-15" });
    await ctx.db.delete(tenantJobRuns);
    await tick("2026-03-15T05:00:00Z");
    await ctx.jobs.drain();
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION"))).toHaveLength(1);
  });

  it("finds birthdays (29 Feb on 28 Feb in other years) and anniversaries in the institution's time zone", async () => {
    const t = await tenantIn("Asia/Kolkata");
    const leap = await memberSession(ctx, t.id, { fullName: "Leap Day", dateOfBirth: "1992-02-29" });
    await memberSession(ctx, t.id, { fullName: "Opted Out", dateOfBirth: "1992-02-28" }).then((m) => ctx.db.update(memberships).set({ celebrateBirthday: false }).where(eq(memberships.id, m.membership.id)));
    // Approved at 00:30 on 15 March in India, which is still 14 March in UTC.
    const anniv = await memberSession(ctx, t.id, { fullName: "Two Years", approvedAt: new Date("2024-03-14T19:00:00Z") });
    await memberSession(ctx, t.id, { fullName: "Joined This Year", approvedAt: new Date("2026-03-14T19:00:00Z") });
    await memberSession(ctx, t.id, { fullName: "Pending", dateOfBirth: "1992-02-28", status: "PENDING" });

    expect((await celebrantsOn(ctx.db, t.id, "2027-02-28", t.timezone)).map((c) => c.fullName)).toEqual(["Leap Day"]);
    expect(await celebrantsOn(ctx.db, t.id, "2027-03-01", t.timezone)).toEqual([]);
    expect((await celebrantsOn(ctx.db, t.id, "2028-02-29", t.timezone)).map((c) => c.membershipId)).toEqual([leap.membership.id]);
    expect(await celebrantsOn(ctx.db, t.id, "2028-02-28", t.timezone)).toEqual([]); // 28 Feb in a leap year: only real 28 Feb birthdays (opted out)
    const march15 = await celebrantsOn(ctx.db, t.id, "2026-03-15", t.timezone);
    expect(march15).toEqual([expect.objectContaining({ membershipId: anniv.membership.id, kind: "ANNIVERSARY", years: 2 })]);
    expect(await celebrantsOn(ctx.db, t.id, "2026-03-15", "UTC")).toEqual([]);
  });

  it("shows today's celebrations without years, and merges wishes into one notification per person", async () => {
    const t = await tenantIn("Asia/Kolkata");
    const today = localClock(new Date(), "Asia/Kolkata").day;
    const asha = await memberSession(ctx, t.id, { fullName: "Asha Rao", dateOfBirth: `1990-${today.slice(5)}` });
    const bala = await memberSession(ctx, t.id, { fullName: "Bala Iyer" });
    const chitra = await memberSession(ctx, t.id, { fullName: "Chitra Das" });
    const base = `/api/v1/t/${t.slug}`;

    const card = await api().get(`${base}/celebrations/today`).set(bala.headers);
    expect(card.body.data).toMatchObject({ date: today, more: 0, showNotice: false, items: [{ membershipId: asha.membership.id, kind: "BIRTHDAY", years: null, isMe: false, wishedByMe: false, wishCount: 0 }] });
    expect(JSON.stringify(card.body.data)).not.toContain("1990");
    // Asha sees herself first and the one-time notice about birthdays on the feed.
    expect((await api().get(`${base}/celebrations/today`).set(asha.headers)).body.data).toMatchObject({ showNotice: true, items: [{ isMe: true }] });
    await api().patch(`${base}/notification-prefs`).set(asha.headers).send({ celebrationsNoticeSeen: true });
    expect((await api().get(`${base}/celebrations/today`).set(asha.headers)).body.data.showNotice).toBe(false);

    const wish = (who: typeof bala, to = asha.membership.id, kind = "BIRTHDAY") => api().post(`${base}/celebrations/${to}/wishes`).set(who.headers).send({ kind });
    expect((await wish(bala)).body.data).toEqual({ wishCount: 1 });
    expect((await wish(bala)).body.data).toEqual({ wishCount: 1 }); // once per day
    expect((await wish(chitra)).body.data).toEqual({ wishCount: 2 });
    expect((await wish(asha)).status).toBe(400); // not to yourself
    expect((await wish(asha, bala.membership.id)).status).toBe(404); // Bala isn't celebrating
    expect((await wish(bala, asha.membership.id, "ANNIVERSARY")).status).toBe(404);

    const rows = await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION_WISH"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipientMembershipId: asha.membership.id, title: "Chitra and 1 other sent you birthday wishes 🎉" });
    const dispatches = ctx.jobs.peek("notifications.dispatch").map((j) => j.data as { push?: boolean });
    expect(dispatches.map((d) => d.push)).toEqual([undefined, false]); // pushed once, then updated silently
    const after = await api().get(`${base}/celebrations/today`).set(bala.headers);
    expect(after.body.data.items[0]).toMatchObject({ wishedByMe: true, wishCount: 2 });

    // Opting out removes Asha from the card.
    await api().patch(`${base}/memberships/me`).set(asha.headers).send({ celebrateBirthday: false });
    expect((await api().get(`${base}/celebrations/today`).set(bala.headers)).body.data.items).toEqual([]);
  });

  it("lets platform staff run an institution's celebrations now", async () => {
    const t = await tenantIn("Asia/Kolkata");
    await memberSession(ctx, t.id, { dateOfBirth: `1985-${localClock(new Date(), "Asia/Kolkata").day.slice(5)}` });
    const staff = await loginAs(ctx, "+919999999999");
    const res = await api().post("/api/v1/platform/jobs/run").set(auth(staff.accessToken)).send({ job: "celebrations", tenantId: t.id });
    expect(res.body.data).toEqual({ queued: true, period: localClock(new Date(), "Asia/Kolkata").day });
    await ctx.jobs.drain();
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION"))).toHaveLength(1);
    await api().post("/api/v1/platform/jobs/run").set(auth(staff.accessToken)).send({ job: "celebrations", tenantId: t.id, force: true });
    await ctx.jobs.drain();
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION"))).toHaveLength(1);
  });
});
