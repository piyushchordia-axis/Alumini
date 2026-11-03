import { defaultFeaturesFor } from "@illuminize/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, notifications, users } from "../../src/db/schema";
import { createUnsubscribeToken, unsubscribeLinks } from "../../src/lib/unsubscribe";
import type { RealtimePublisher } from "../../src/realtime/publisher";
import { upsertPushToken } from "../../src/repositories/users.repo";
import { ExpoPushChannel } from "../../src/services/notifications/ExpoPushChannel";
import { notify } from "../../src/services/notifications/notification.service";
import { createTenant, memberSession } from "../helpers/factories";
import { askForReferral, postReferralJob } from "../helpers/referrals";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

function fakeExpo() {
  const sent: Array<{ to: string; data: Record<string, unknown> }> = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as typeof sent;
    sent.push(...batch);
    return new Response(JSON.stringify({ data: batch.map((m) => ({ status: "ok", id: `t:${m.to}` })) }), { status: 200 });
  }) as typeof fetch;
  return { sent, impl };
}

class CapturingRealtime implements RealtimePublisher {
  readonly events: Array<{ to: string | string[]; event: string; payload: unknown }> = [];
  emit(to: string | string[], event: string, ...args: unknown[]) {
    this.events.push({ to, event, payload: args[0] });
  }
  disconnect() {}
}

describe.skipIf(!dbAvailable)("notification preferences", () => {
  let ctx: TestContext;
  let expo: ReturnType<typeof fakeExpo>;
  let realtime: CapturingRealtime;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    expo = fakeExpo();
    realtime = new CapturingRealtime();
    ctx.push = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);
    ctx.realtime = realtime as unknown as TestContext["realtime"];
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const prefsUrl = (slug: string) => `/api/v1/t/${slug}/notification-prefs`;

  it("serves defaults and saves partial changes; announcements can't be turned off in the app", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const initial = await request(ctx.app).get(prefsUrl(tenant.slug)).set(m.headers);
    expect(initial.body.data).toEqual({
      categories: { ACTIVITY: "IN_APP_PUSH", CHAT: "IN_APP_PUSH", CONNECTIONS: "IN_APP_PUSH", EVENTS: "IN_APP_PUSH", ANNOUNCEMENTS: "IN_APP_PUSH", CELEBRATIONS: "IN_APP_PUSH", ADMIN: "IN_APP_PUSH" },
      digestEmail: true,
      announcementMessages: true,
      celebrationsNoticeSeenAt: null,
      hasEmail: false,
    });
    const upd = await request(ctx.app)
      .patch(prefsUrl(tenant.slug))
      .set(m.headers)
      .send({ categories: { ACTIVITY: "OFF", ANNOUNCEMENTS: "OFF" }, digestEmail: false, celebrationsNoticeSeen: true });
    expect(upd.status).toBe(200);
    expect(upd.body.data.categories).toMatchObject({ ACTIVITY: "OFF", ANNOUNCEMENTS: "IN_APP", EVENTS: "IN_APP_PUSH" });
    expect(upd.body.data.digestEmail).toBe(false);
    expect(upd.body.data.celebrationsNoticeSeenAt).toEqual(expect.any(String));
    const again = await request(ctx.app).patch(prefsUrl(tenant.slug)).set(m.headers).send({ categories: { EVENTS: "IN_APP" } });
    expect(again.body.data.categories).toMatchObject({ ACTIVITY: "OFF", EVENTS: "IN_APP" });
    expect((await request(ctx.app).patch(prefsUrl(tenant.slug)).set(m.headers).send({ categories: { EVENTS: "LOUD" } })).status).toBe(400);
  });

  it("saves the CHAT level, which can leave push off but can't go below in-app", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const inApp = await request(ctx.app).patch(prefsUrl(tenant.slug)).set(m.headers).send({ categories: { CHAT: "IN_APP" } });
    expect(inApp.body.data.categories.CHAT).toBe("IN_APP");
    const off = await request(ctx.app).patch(prefsUrl(tenant.slug)).set(m.headers).send({ categories: { CHAT: "OFF" } });
    expect(off.status).toBe(200);
    expect(off.body.data.categories.CHAT).toBe("IN_APP");
    expect((await request(ctx.app).get(prefsUrl(tenant.slug)).set(m.headers)).body.data.categories.CHAT).toBe("IN_APP");
  });

  it("saves the CONNECTIONS level, which can go all the way off, and then stores no mentorship notification", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    const loud = await memberSession(ctx, tenant.id);
    const off = await request(ctx.app).patch(prefsUrl(tenant.slug)).set(m.headers).send({ categories: { CONNECTIONS: "OFF" } });
    expect(off.status).toBe(200);
    expect(off.body.data.categories.CONNECTIONS).toBe("OFF");
    for (const type of ["MENTORSHIP_REQUESTED", "MENTORSHIP_ACCEPTED", "MENTORSHIP_DECLINED", "MENTORSHIP_ENDED"] as const) {
      await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.membership.id, loud.membership.id], type, title: "Mentorship", data: { mentorshipId: "m1", box: "sent" } });
    }
    const rows = await ctx.db.select().from(notifications);
    expect(rows.map((r) => r.recipientMembershipId)).toEqual(Array(4).fill(loud.membership.id));
  });

  it("holds referral notifications under CONNECTIONS too, where referrals are all there is of it, with mentorship off", async () => {
    const { tenant } = await createTenant(ctx, { features: { ...defaultFeaturesFor("COLLEGE"), mentorship: false } });
    const quiet = await memberSession(ctx, tenant.id);
    const loud = await memberSession(ctx, tenant.id);
    const asker = await memberSession(ctx, tenant.id);
    const off = await request(ctx.app).patch(prefsUrl(tenant.slug)).set(quiet.headers).send({ categories: { CONNECTIONS: "OFF" } });
    expect(off.body.data.categories.CONNECTIONS).toBe("OFF");
    for (const poster of [quiet, loud]) await askForReferral(ctx, tenant.slug, asker, (await postReferralJob(ctx, tenant.slug, poster)).id);
    const rows = await ctx.db.select().from(notifications).where(sql`${notifications.type} = 'REFERRAL_REQUESTED'`);
    expect(rows.map((r) => r.recipientMembershipId)).toEqual([loud.membership.id]);
    for (const type of ["REFERRAL_ACCEPTED", "REFERRAL_DECLINED"] as const) {
      await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [quiet.membership.id], type, title: "Referral", data: { referralId: "r1", box: "sent" } });
    }
    expect(await ctx.db.select().from(notifications).where(eq(notifications.recipientMembershipId, quiet.membership.id))).toEqual([]);
  });

  it("drops notifications a member turned off, keeps account notices, and skips push for in-app only", async () => {
    const { tenant } = await createTenant(ctx);
    const quiet = await memberSession(ctx, tenant.id);
    const inAppOnly = await memberSession(ctx, tenant.id);
    const loud = await memberSession(ctx, tenant.id);
    for (const m of [quiet, inAppOnly, loud]) await upsertPushToken(ctx.db, { userId: m.user.id, token: `ExponentPushToken[${m.user.id}]`, platform: "ANDROID" });
    await request(ctx.app).patch(prefsUrl(tenant.slug)).set(quiet.headers).send({ categories: { ACTIVITY: "OFF" } });
    await request(ctx.app).patch(prefsUrl(tenant.slug)).set(inAppOnly.headers).send({ categories: { ACTIVITY: "IN_APP" } });

    const ids = [quiet, inAppOnly, loud].map((m) => m.membership.id);
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: ids, type: "POST_REACTION", title: "Someone reacted", data: { postId: "p1" } });
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: ids, type: "SYSTEM", title: "Account notice" });
    await ctx.jobs.drain();

    const rows = await ctx.db.select().from(notifications);
    const reactions = rows.filter((r) => r.type === "POST_REACTION").map((r) => r.recipientMembershipId);
    expect(reactions.sort()).toEqual([inAppOnly.membership.id, loud.membership.id].sort());
    expect(rows.filter((r) => r.type === "SYSTEM")).toHaveLength(3);
    const pushedReactions = expo.sent.filter((s) => s.data.type === "POST_REACTION").map((s) => s.to);
    expect(pushedReactions).toEqual([`ExponentPushToken[${loud.user.id}]`]);
    expect(expo.sent.filter((s) => s.data.type === "SYSTEM")).toHaveLength(3);
  });

  it("is idempotent with a dedupe key, and merges with merge: true without pushing twice", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: m.user.id, token: "ExponentPushToken[m]", platform: "IOS" });
    const base = { tenantId: tenant.id, recipientMembershipIds: [m.membership.id], type: "ANNOUNCEMENT" as const, data: { postId: "p1" } };
    await notify(ctx, { ...base, title: "Reunion", dedupeKey: "ann-p1" });
    await notify(ctx, { ...base, title: "Reunion (retry)", dedupeKey: "ann-p1" });
    expect(ctx.jobs.peek("notifications.dispatch")).toHaveLength(1);
    await ctx.jobs.drain();
    expect((await ctx.db.select().from(notifications)).map((r) => r.title)).toEqual(["Reunion"]);

    const wish = { tenantId: tenant.id, recipientMembershipIds: [m.membership.id], type: "CELEBRATION_WISH" as const, dedupeKey: "wish-2026-11-01", merge: true };
    await notify(ctx, { ...wish, title: "Asha sent you birthday wishes" });
    await ctx.jobs.drain();
    await request(ctx.app).post(`/api/v1/t/${tenant.slug}/notifications/read-all`).set(m.headers);
    await notify(ctx, { ...wish, title: "Asha and 1 other sent you birthday wishes" });
    await ctx.jobs.drain();
    const wishes = await ctx.db.select().from(notifications).where(eq(notifications.type, "CELEBRATION_WISH"));
    expect(wishes).toHaveLength(1);
    expect(wishes[0]).toMatchObject({ title: "Asha and 1 other sent you birthday wishes", readAt: null });
    expect(expo.sent.filter((s) => s.data.type === "CELEBRATION_WISH")).toHaveLength(1);
    // The merged update still reached open apps.
    expect(realtime.events.filter((e) => e.event === "notification:new" && (e.payload as { notification: { type: string } }).notification.type === "CELEBRATION_WISH")).toHaveLength(2);
  });

  it("handles more than a thousand recipients in chunks, with one realtime broadcast per batch when bulk", async () => {
    const { tenant } = await createTenant(ctx);
    const n = 1203;
    await ctx.db.execute(sql`insert into users (phone_e164) select '+9170' || lpad(g::text, 8, '0') from generate_series(1, ${n}) g`);
    await ctx.db.execute(sql`
      insert into memberships (tenant_id, user_id, full_name, batch_year, profession_type, status)
      select ${tenant.id}, id, 'Member', 2010, 'EMPLOYED', 'APPROVED' from users`);
    const ids = (await ctx.db.select({ id: memberships.id }).from(memberships).where(eq(memberships.tenantId, tenant.id))).map((r) => r.id);
    expect(ids).toHaveLength(n);
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: ids, type: "ANNOUNCEMENT", title: "Hello all", data: { postId: "p9" }, dedupeKey: "ann-p9", bulk: true });
    expect(ctx.jobs.peek("notifications.dispatch")).toHaveLength(3); // 500 + 500 + 203
    await ctx.jobs.drain();
    const [{ count }] = (await ctx.db.execute<{ count: number }>(sql`select count(*)::int as count from notifications`)).rows as [{ count: number }];
    expect(count).toBe(n);
    const bulk = realtime.events.filter((e) => e.event === "notification:bulk");
    expect(bulk).toHaveLength(3);
    expect(bulk[0]!.payload).toEqual({ tenantSlug: tenant.slug, type: "ANNOUNCEMENT", postId: "p9" });
    expect(realtime.events.filter((e) => e.event === "notification:new")).toHaveLength(0);
  });

  it("unsubscribes from a signed link without signing in, and rejects tampered links", async () => {
    const { tenant } = await createTenant(ctx, { name: "Unsub College" });
    const m = await memberSession(ctx, tenant.id);
    await ctx.db.update(users).set({ email: "m@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, m.user.id));
    const token = createUnsubscribeToken(ctx.config, m.membership.id, "digest");

    const info = await request(ctx.app).get("/api/v1/unsubscribe").query({ token });
    expect(info.body.data).toEqual({ tenantName: "Unsub College", scope: "digest", unsubscribed: false });
    // One-click: mail apps POST a form body.
    const done = await request(ctx.app).post(`/api/v1/unsubscribe?token=${encodeURIComponent(token)}`).type("form").send("List-Unsubscribe=One-Click");
    expect(done.status).toBe(200);
    expect(done.body.data.unsubscribed).toBe(true);
    const prefs = await request(ctx.app).get(prefsUrl(tenant.slug)).set(m.headers);
    expect(prefs.body.data).toMatchObject({ digestEmail: false, announcementMessages: true, hasEmail: true });

    const tampered = token.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
    expect((await request(ctx.app).get("/api/v1/unsubscribe").query({ token: tampered })).status).toBe(404);
    const otherScope = createUnsubscribeToken({ JWT_SECRET: "another-secret-another-secret-12345" }, m.membership.id, "announcements");
    expect((await request(ctx.app).post("/api/v1/unsubscribe").query({ token: otherScope })).status).toBe(404);

    const links = unsubscribeLinks(ctx.config, m.membership.id, "announcements");
    expect(links.page).toMatch(/^http:\/\/localhost:5173\/unsubscribe\?token=/);
    expect(links.headers["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:4100\/api\/v1\/unsubscribe\?token=.+>$/);
    expect(links.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const r = await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, tenant.id)));
    expect(r).toHaveLength(0);
  });
});
