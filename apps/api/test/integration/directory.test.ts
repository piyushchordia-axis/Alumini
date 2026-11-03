import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, tenantSettings } from "../../src/db/schema";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { chatApi } from "../helpers/chat";
import { createMembership, createTenant, createUser, memberSession } from "../helpers/factories";
import { mentorshipApi, offerToMentor } from "../helpers/mentorship";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("member directory", () => {
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

  it("searches, filters, paginates and exposes facets", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}/directory`;
    const viewer = await memberSession(ctx, tenant.id, { fullName: "Zed Viewer", batchYear: 2001, city: "Delhi" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Anita Rao", batchYear: 2010, city: "Mumbai", country: "IN", companyName: "Infosys", professionType: "EMPLOYED" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Bala Iyer", batchYear: 2010, city: "London", country: "GB", companyName: "Google", professionType: "EMPLOYED" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Chitra Das", batchYear: 2015, city: "Mumbai", country: "IN", companyName: "Self", professionType: "FOUNDER" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Pending Person", batchYear: 2015, status: "PENDING" });
    await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { fullName: "Suspended Person", batchYear: 2015, status: "SUSPENDED" });

    const all = await api().get(base).set(viewer.headers);
    expect(all.body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Anita Rao", "Bala Iyer", "Chitra Das", "Zed Viewer"]);
    expect((await api().get(`${base}?batchYear=2010`).set(viewer.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?city=mumbai`).set(viewer.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?country=gb`).set(viewer.headers)).body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Bala Iyer"]);
    expect((await api().get(`${base}?professionType=FOUNDER`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?company=goog`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?q=rao`).set(viewer.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?q=infosys`).set(viewer.headers)).body.data).toHaveLength(1);

    const p1 = await api().get(`${base}?limit=2`).set(viewer.headers);
    expect(p1.body.data).toHaveLength(2);
    const p2 = await api().get(`${base}?limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).set(viewer.headers);
    expect(p2.body.data.map((m: { fullName: string }) => m.fullName)).toEqual(["Chitra Das", "Zed Viewer"]);
    expect(p2.body.nextCursor).toBeNull();

    const facets = await api().get(`${base}/filters`).set(viewer.headers);
    expect(facets.body.data).toMatchObject({ batchYears: [2015, 2010, 2001], countries: ["GB", "IN"] });
    expect(facets.body.data.cities).toEqual(expect.arrayContaining(["Mumbai", "London", "Delhi"]));
  });

  it("shows profiles with phone only when the member opted in", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const viewer = await memberSession(ctx, tenant.id);
    const target = await memberSession(ctx, tenant.id, { fullName: "Target T" });
    const hidden = await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers);
    expect(hidden.body.data).toMatchObject({ fullName: "Target T", phone: null, isOpenToWork: false });
    await api().patch(`${base}/memberships/me`).set(target.headers).send({ isPhoneVisible: true, bio: "Hi", linkedinUrl: "https://linkedin.com/in/t" });
    const shown = await api().get(`${base}/directory/${target.membership.id}`).set(viewer.headers);
    expect(shown.body.data).toMatchObject({ phone: target.user.phoneE164, bio: "Hi", linkedinUrl: "https://linkedin.com/in/t" });
    expect(shown.body.data).not.toHaveProperty("dateOfBirth");
    const pending = await createMembership(ctx, tenant.id, (await createUser(ctx)).id, { status: "PENDING" });
    expect((await api().get(`${base}/directory/${pending.id}`).set(viewer.headers)).status).toBe(404);
  });

  describe("isMentor", () => {
    const mentorsIn = async (slug: string, viewer: { headers: Record<string, string> }) =>
      ((await api().get(`/api/v1/t/${slug}/directory`).set(viewer.headers)).body.data as Array<{ fullName: string; isMentor: boolean }>).filter((m) => m.isMentor).map((m) => m.fullName);

    it("marks the mentors the Mentors list would show this viewer, on the directory's cards only", async () => {
      const { tenant } = await createTenant(ctx);
      const viewer = await memberSession(ctx, tenant.id, { fullName: "Viewer V" });
      const mentor = await memberSession(ctx, tenant.id, { fullName: "Active Mentor" });
      const stopped = await memberSession(ctx, tenant.id, { fullName: "Stopped Mentor" });
      const blocked = await memberSession(ctx, tenant.id, { fullName: "Blocked Mentor" });
      const blocker = await memberSession(ctx, tenant.id, { fullName: "Blocking Mentor" });
      await memberSession(ctx, tenant.id, { fullName: "Not A Mentor" });
      for (const s of [mentor, stopped, blocked, blocker]) await offerToMentor(ctx, tenant.slug, s);
      await mentorshipApi(ctx, tenant.slug, stopped).stop();
      await chatApi(ctx, tenant.slug, viewer).block(blocked.membership.id);
      await chatApi(ctx, tenant.slug, blocker).block(viewer.membership.id);

      expect(await mentorsIn(tenant.slug, viewer)).toEqual(["Active Mentor", "Blocking Mentor"]);
      // A profile says nothing about it: that card is the directory's own.
      const profile = await api().get(`/api/v1/t/${tenant.slug}/directory/${mentor.membership.id}`).set(viewer.headers);
      expect(profile.body.data).not.toHaveProperty("isMentor");
    });

    it("is false for everyone while mentorship is off here, or for a viewer who can't use it", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true, mentorship: true } });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
      const pupil = await memberSession(ctx, tenant.id, { batchYear: new Date().getFullYear() + 2 });
      const mentor = await memberSession(ctx, tenant.id, { batchYear: 1999, fullName: "School Mentor" });
      await offerToMentor(ctx, tenant.slug, mentor);
      expect(await mentorsIn(tenant.slug, alum)).toEqual(["School Mentor"]);
      expect(await mentorsIn(tenant.slug, pupil)).toEqual([]);

      await ctx.db.update(tenantSettings).set({ features: { messaging: true, mentorship: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
      await ctx.db.update(tenantSettings).set({ features: { messaging: false, mentorship: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
      // Back on, and the profile was kept all along.
      await ctx.db.update(tenantSettings).set({ features: { messaging: true, mentorship: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await mentorsIn(tenant.slug, alum)).toEqual(["School Mentor"]);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, mentor.membership.id));
      expect(await mentorsIn(tenant.slug, alum)).toEqual([]);
    });
  });
});
