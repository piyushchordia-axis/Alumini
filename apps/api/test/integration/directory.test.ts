import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMembership, createTenant, createUser, memberSession } from "../helpers/factories";
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
});
