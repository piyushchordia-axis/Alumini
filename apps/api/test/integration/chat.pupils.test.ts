import { wallPartsInZone } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chatConversations, memberships, tenants } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { lockConversation } from "../../src/repositories/chat.repo";
import { appendMessage, chatRecipients } from "../../src/services/chat/fanout";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, chatApi, createGroup, groupsApi, type Session } from "../helpers/chat";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const ZONE = "Asia/Kolkata";
const thisYear = () => wallPartsInZone(new Date(), ZONE).year;
const yearsAgo = (years: number) => `${thisYear() - years}-01-01`;

/** Every way to be a current pupil, as a member's details. */
const RULES = [
  { name: "a future batch year", member: () => ({ batchYear: thisYear() + 1 }) },
  { name: "a future batch year, whatever the date of birth says", member: () => ({ batchYear: thisYear() + 1, dateOfBirth: yearsAgo(30) }) },
  { name: "a date of birth under 18", member: () => ({ batchYear: thisYear() - 1, dateOfBirth: yearsAgo(15) }) },
  { name: "this year's batch with no date of birth", member: () => ({ batchYear: thisYear() }) },
];

describe.skipIf(!dbAvailable)("current pupils", () => {
  let ctx: TestContext;
  let realtime: CapturingRealtime;
  beforeAll(async () => {
    realtime = new CapturingRealtime();
    ctx = await createTestContext({}, { realtime });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    realtime.clear();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  /** A school that has switched messaging on, which is the case the rule has to hold in. */
  async function school() {
    const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } });
    const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
    const other = await memberSession(ctx, tenant.id, { batchYear: 2001 });
    return { tenant, alum, other };
  }
  const profile = (slug: string, viewer: Session, membershipId: string) => request(ctx.app).get(`/api/v1/t/${slug}/directory/${membershipId}`).set(viewer.headers);
  const me = (slug: string, viewer: Session) => request(ctx.app).get(`/api/v1/t/${slug}/memberships/me`).set(viewer.headers);

  describe("as the one acting", () => {
    for (const rule of RULES) {
      it(`refuses every chat route for ${rule.name}, with features on`, async () => {
        const { tenant, alum } = await school();
        const pupil = await memberSession(ctx, tenant.id, rule.member());
        const id = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
        const api = chatApi(ctx, tenant.slug, pupil);
        for (const res of [await api.direct(alum.membership.id), await api.list(), await api.list("REQUESTS"), await api.get(id), await api.messages(id), await api.send(id), await api.read(id, 1), await api.mute(id, null), await api.accept(id), await api.decline(id), await api.badge(), await api.blocks(), await api.block(alum.membership.id), await api.unblock(alum.membership.id), await api.report(id)]) {
          expect(res.status, res.request.url).toBe(403);
          expect(res.body.error.code, res.request.url).toBe("FEATURE_DISABLED");
          expect(res.headers["cache-control"]).toBe("no-store");
        }
        expect((await me(tenant.slug, pupil)).body.data.chatEligible).toBe(false);
      });
    }
  });

  describe("and groups", () => {
    /** A school with groups and messaging both on, so only the pupil rule can be what keeps them out. */
    async function groupSchool() {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true, groups: true } });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
      const open = await createGroup(ctx, tenant.slug, alum, { name: "Old boys and girls" });
      const closed = await createGroup(ctx, tenant.slug, alum, { name: "Committee", visibility: "INVITE_ONLY" });
      return { tenant, alum, open, closed };
    }

    for (const rule of RULES) {
      it(`refuse every group route to ${rule.name}, with groups on`, async () => {
        const { tenant, alum, open, closed } = await groupSchool();
        const pupil = await memberSession(ctx, tenant.id, rule.member());
        const g = groupsApi(ctx, tenant.slug, pupil);
        for (const id of [open.id, closed.id]) {
          for (const res of [await g.list(), await g.create({ name: "Our class", visibility: "OPEN" }), await g.invites(), await g.get(id), await g.members(id), await g.candidates(id), await g.join(id), await g.leave(id), await g.invite(id, [alum.membership.id]), await g.accept(id), await g.decline(id), await g.edit(id, { name: "Renamed" }), await g.remove(id, alum.membership.id)]) {
            expect(res.status, res.request.url).toBe(403);
            expect(res.body.error.code, res.request.url).toBe("FEATURE_DISABLED");
            expect(res.headers["cache-control"]).toBe("no-store");
          }
          // Reporting goes through content reports, which pupils can use for other things, so a group answers as if it didn't exist.
          expect((await g.report(id)).status).toBe(404);
        }
      });
    }

    it("never shows a pupil as someone to invite, and refuses inviting one", async () => {
      const { tenant, alum, open } = await groupSchool();
      const pupil = await memberSession(ctx, tenant.id, { batchYear: thisYear() + 1 });
      const candidates = (await groupsApi(ctx, tenant.slug, alum).candidates(open.id)).body.data as Array<{ id: string }>;
      expect(candidates.map((m) => m.id)).not.toContain(pupil.membership.id);
      const res = await groupsApi(ctx, tenant.slug, alum).invite(open.id, [pupil.membership.id]);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
    });

    for (const rule of RULES) {
      it(`stop delivering to a member who becomes a pupil by ${rule.name}, who can't send there either`, async () => {
        const { tenant, alum, open } = await groupSchool();
        const member = await memberSession(ctx, tenant.id, { batchYear: 2001 });
        await groupsApi(ctx, tenant.slug, member).join(open.id);
        await chatApi(ctx, tenant.slug, alum).send(open.id, "Delivered");
        expect(realtime.to(member.user.id, "chat:message").map((e) => (e.payload as { message: { body: string } }).message.body)).toContain("Delivered");

        await ctx.db.update(memberships).set(rule.member()).where(eq(memberships.id, member.membership.id));
        expect((await chatRecipients(ctx.db, open.id)).map((r) => r.membershipId)).toEqual([alum.membership.id]);
        realtime.clear();
        await chatApi(ctx, tenant.slug, alum).send(open.id, "Not delivered");
        expect(realtime.to(member.user.id)).toEqual([]);
        const refused = await chatApi(ctx, tenant.slug, member).send(open.id, "From a pupil");
        expect(refused.status).toBe(403);
        expect(refused.body.error.code).toBe("FEATURE_DISABLED");
      });
    }
  });

  describe("as the one contacted", () => {
    for (const rule of RULES) {
      it(`returns CONTACT_UNAVAILABLE for ${rule.name}, with features on`, async () => {
        const { tenant, alum } = await school();
        const pupil = await memberSession(ctx, tenant.id, rule.member());
        const res = await chatApi(ctx, tenant.slug, alum).direct(pupil.membership.id);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
        expect(await ctx.db.select().from(chatConversations)).toEqual([]);
        expect((await profile(tenant.slug, alum, pupil.membership.id)).body.data.canMessage).toBe(false);
      });
    }
  });

  describe("as a recipient", () => {
    for (const rule of RULES) {
      it(`leaves out ${rule.name}, however they got there`, async () => {
        const { tenant, alum, other } = await school();
        const id = await acceptedThread(ctx, tenant.slug, alum, other);
        expect((await chatRecipients(ctx.db, id)).map((r) => r.membershipId).sort()).toEqual([alum.membership.id, other.membership.id].sort());
        await ctx.db.update(memberships).set(rule.member()).where(eq(memberships.id, other.membership.id));
        expect((await chatRecipients(ctx.db, id)).map((r) => r.membershipId)).toEqual([alum.membership.id]);
      });
    }

    it("editing a profile into pupil status stops delivery at the next message", async () => {
      const { tenant, alum, other } = await school();
      const id = await acceptedThread(ctx, tenant.slug, alum, other);
      await chatApi(ctx, tenant.slug, alum).send(id, "Delivered");
      expect(realtime.to(other.user.id, "chat:message")).toHaveLength(1);

      const edited = await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(other.headers).send({ batchYear: thisYear() + 1 });
      expect(edited.status).toBe(200);
      expect(edited.body.data.chatEligible).toBe(false);
      realtime.clear();

      // Sending is refused, and anything else that gets through to fan-out doesn't reach them either.
      const refused = await chatApi(ctx, tenant.slug, alum).send(id, "Not delivered");
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      await runInTransaction(ctx, async (tx) => {
        const conversation = await lockConversation(tx, tenant.id, id);
        await appendMessage(ctx, tx, { tenantSlug: tenant.slug, conversation: conversation!, sender: alum.membership, body: "Past the check" });
      });
      expect(realtime.to(other.user.id)).toEqual([]);
      expect(realtime.to(alum.user.id, "chat:message")).toHaveLength(1);
    });

    it("shows a thread as unable to send once the other member is a pupil, and hides their request", async () => {
      const { tenant, alum, other } = await school();
      const id = await acceptedThread(ctx, tenant.slug, alum, other);
      const third = await memberSession(ctx, tenant.id, { batchYear: 1999 });
      const pending = await chatApi(ctx, tenant.slug, third).direct(alum.membership.id);
      await ctx.db.update(memberships).set({ batchYear: thisYear() + 1 }).where(eq(memberships.id, other.membership.id));
      await ctx.db.update(memberships).set({ batchYear: thisYear() + 1 }).where(eq(memberships.id, third.membership.id));
      expect((await chatApi(ctx, tenant.slug, alum).get(id)).body.data.canSend).toBe(false);
      expect((await chatApi(ctx, tenant.slug, alum).list("REQUESTS")).body.data).toEqual([]);
      expect((await chatApi(ctx, tenant.slug, alum).badge()).body.data.requests).toBe(0);
      expect(pending.status).toBe(201);
    });
  });

  describe("who isn't one", () => {
    it("a date of birth showing 18 or over lifts the current-year rule", async () => {
      const { tenant, alum } = await school();
      const member = await memberSession(ctx, tenant.id, { batchYear: thisYear() });
      expect((await chatApi(ctx, tenant.slug, member).list()).status).toBe(403);
      const edited = await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/memberships/me`).set(member.headers).send({ dateOfBirth: yearsAgo(19) });
      expect(edited.body.data.chatEligible).toBe(true);
      expect((await chatApi(ctx, tenant.slug, member).list()).status).toBe(200);
      expect((await chatApi(ctx, tenant.slug, alum).direct(member.membership.id)).status).toBe(201);
    });

    it("a past batch with no date of birth is eligible", async () => {
      const { tenant, alum } = await school();
      const member = await memberSession(ctx, tenant.id, { batchYear: thisYear() - 1 });
      expect((await me(tenant.slug, member)).body.data.chatEligible).toBe(true);
      expect((await chatApi(ctx, tenant.slug, alum).direct(member.membership.id)).status).toBe(201);
    });

    it("nobody outside a school", async () => {
      for (const type of ["COLLEGE", "UNIVERSITY", "OTHER"] as const) {
        const { tenant } = await createTenant(ctx, { type });
        const young = await memberSession(ctx, tenant.id, { batchYear: thisYear() + 3, dateOfBirth: yearsAgo(15) });
        const other = await memberSession(ctx, tenant.id);
        expect((await me(tenant.slug, young)).body.data.chatEligible, type).toBe(true);
        expect((await chatApi(ctx, tenant.slug, young).direct(other.membership.id)).status, type).toBe(201);
      }
    });
  });

  describe("an admin set up with no batch year", () => {
    it("isn't taken for a pupil, whichever way they became an admin", async () => {
      const staff = { headers: auth((await loginAs(ctx, "+919999999999")).accessToken) };
      const created = await request(ctx.app)
        .post("/api/v1/platform/tenants")
        .set(staff.headers)
        .send({ slug: "new-school", name: "New School", type: "SCHOOL", settings: { features: { messaging: true } }, initialAdmin: { phone: "98111 11111", fullName: "First Admin" } });
      expect(created.status).toBe(201);
      expect(created.body.data.admins[0].batchYear).toBeLessThan(wallPartsInZone(new Date(), created.body.data.tenant.timezone).year);

      const signIn = async (phone: string) => ({ headers: auth((await loginAs(ctx, phone)).accessToken) });
      const first = await signIn("+919811111111");
      expect((await me("new-school", first as Session)).body.data.chatEligible).toBe(true);
      expect((await chatApi(ctx, "new-school", first).list()).status).toBe(200);

      const assigned = await request(ctx.app).post(`/api/v1/platform/tenants/${created.body.data.tenant.id}/admins`).set(staff.headers).send({ phone: "98222 22222", fullName: "Second Admin" });
      expect(assigned.status).toBeLessThan(300);
      const second = await signIn("+919822222222");
      expect((await me("new-school", second as Session)).body.data.chatEligible).toBe(true);
    });
  });

  describe("chatEligible on the membership", () => {
    it("is false for anyone not approved", async () => {
      const { tenant } = await school();
      const pending = await memberSession(ctx, tenant.id, { status: "PENDING" });
      expect((await me(tenant.slug, pending)).body.data.chatEligible).toBe(false);
    });

    it("doesn't appear on the admin's copy", async () => {
      const { tenant, alum } = await school();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 1990 });
      const res = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/admin/members/${alum.membership.id}`).set(admin.headers);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty("chatEligible");
    });
  });

  describe("a school with messaging left off", () => {
    it("reads off for a row stripped to {feed: true}, on every route and DTO that asks", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { feed: true } });
      const a = await memberSession(ctx, tenant.id, { batchYear: 2000 });
      const b = await memberSession(ctx, tenant.id, { batchYear: 2001 });
      const refused = await chatApi(ctx, tenant.slug, a).direct(b.membership.id);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("FEATURE_DISABLED");
      expect((await chatApi(ctx, tenant.slug, a).list()).status).toBe(403);
      expect((await profile(tenant.slug, a, b.membership.id)).body.data.canMessage).toBe(false);
      expect((await request(ctx.app).get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features.messaging).toBe(false);
      // Eligible is about the person, and says nothing about whether the school has switched it on.
      expect((await me(tenant.slug, a)).body.data.chatEligible).toBe(true);
    });

    it("refuses existing threads once turned off, and restores them once on again", async () => {
      const { tenant, alum, other } = await school();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 1990 });
      const id = await acceptedThread(ctx, tenant.slug, alum, other);
      const toggle = (messaging: boolean) => request(ctx.app).patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { messaging } }).expect(200);
      await toggle(false);
      for (const res of [await chatApi(ctx, tenant.slug, alum).get(id), await chatApi(ctx, tenant.slug, alum).messages(id), await chatApi(ctx, tenant.slug, alum).send(id)]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
      expect((await chatApi(ctx, tenant.slug, alum).block(other.membership.id)).status).toBe(201);
      await chatApi(ctx, tenant.slug, alum).unblock(other.membership.id);
      await toggle(true);
      expect((await chatApi(ctx, tenant.slug, alum).get(id)).status).toBe(200);
      expect((await chatApi(ctx, tenant.slug, alum).send(id)).status).toBe(201);
    });

    it("a pupil stays out when the school turns messaging on", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 1990 });
      const pupil = await memberSession(ctx, tenant.id, { batchYear: thisYear() + 1 });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
      expect((await chatApi(ctx, tenant.slug, alum).list()).status).toBe(403);
      await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { messaging: true } }).expect(200);
      expect((await chatApi(ctx, tenant.slug, alum).list()).status).toBe(200);
      expect((await chatApi(ctx, tenant.slug, pupil).list()).status).toBe(403);
      expect((await chatApi(ctx, tenant.slug, alum).direct(pupil.membership.id)).status).toBe(409);
    });

    it("forces messaging off when an institution is retyped to a school", async () => {
      const { tenant } = await createTenant(ctx, { type: "COLLEGE" });
      const a = await memberSession(ctx, tenant.id);
      const b = await memberSession(ctx, tenant.id);
      const staff = await import("../helpers/factories").then((f) => f.loginAs(ctx, "+919999999999"));
      expect((await chatApi(ctx, tenant.slug, a).list()).status).toBe(200);
      await request(ctx.app).patch(`/api/v1/platform/tenants/${tenant.id}`).set({ Authorization: `Bearer ${staff.accessToken}` }).send({ type: "SCHOOL" }).expect(200);
      const refused = await chatApi(ctx, tenant.slug, a).direct(b.membership.id);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("FEATURE_DISABLED");
    });
  });

  describe("time zones", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** 20:00 UTC on New Year's Eve: 2028 already in Kolkata, still 2027 in New York. */
    const EDGE = new Date("2027-12-31T20:00:00.000Z");

    it("reads the year in the institution's zone, so the same instant and member come out differently", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: EDGE });
      const kolkata = (await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } })).tenant;
      const newYork = (await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } })).tenant;
      await ctx.db.update(tenants).set({ timezone: "America/New_York" }).where(eq(tenants.id, newYork.id));
      await ctx.db.execute(sql`update tenants set timezone = 'Asia/Kolkata' where id = ${kolkata.id}`);
      await invalidateTenantCache(ctx, kolkata.slug);
      await invalidateTenantCache(ctx, newYork.slug);

      // Batch of 2027 with no date of birth: last year's in Kolkata, this year's in New York.
      const there = await memberSession(ctx, kolkata.id, { batchYear: 2027 });
      const here = await memberSession(ctx, newYork.id, { batchYear: 2027 });
      expect((await chatApi(ctx, kolkata.slug, there).list()).status).toBe(200);
      expect((await chatApi(ctx, newYork.slug, here).list()).status).toBe(403);

      // Batch of 2028: this year's in Kolkata and next year's in New York. A pupil in both, by different rules.
      const futureThere = await memberSession(ctx, kolkata.id, { batchYear: 2028 });
      const futureHere = await memberSession(ctx, newYork.id, { batchYear: 2028 });
      expect((await chatApi(ctx, kolkata.slug, futureThere).list()).status).toBe(403);
      expect((await chatApi(ctx, newYork.slug, futureHere).list()).status).toBe(403);
    });

    it("turns 18 on the institution's date", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: EDGE });
      const kolkata = (await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } })).tenant;
      const newYork = (await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } })).tenant;
      await ctx.db.update(tenants).set({ timezone: "America/New_York" }).where(eq(tenants.id, newYork.id));
      await invalidateTenantCache(ctx, newYork.slug);
      // 18 on 1 January 2028: reached in Kolkata, not yet in New York.
      const dob = "2010-01-01";
      const there = await memberSession(ctx, kolkata.id, { batchYear: 2026, dateOfBirth: dob });
      const here = await memberSession(ctx, newYork.id, { batchYear: 2026, dateOfBirth: dob });
      expect((await chatApi(ctx, kolkata.slug, there).list()).status).toBe(200);
      expect((await chatApi(ctx, newYork.slug, here).list()).status).toBe(403);
    });
  });
});
