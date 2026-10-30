import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const JOB = {
  title: "Backend Engineer",
  companyName: "Acme",
  location: "Mumbai",
  isRemote: true,
  jobType: "FULL_TIME",
  description: "Build services with Node.js and Postgres.",
  applyUrl: "https://example.com/apply",
};

describe.skipIf(!dbAvailable)("jobs + seekers", () => {
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

  it("creates, lists, filters, edits, closes and deletes jobs with author checks", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}/jobs`;
    const author = await memberSession(ctx, tenant.id);
    const other = await memberSession(ctx, tenant.id);

    const created = await api().post(base).set(author.headers).send(JOB);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ title: "Backend Engineer", moderationStatus: "APPROVED", isMine: true, author: { id: author.membership.id } });
    const id = created.body.data.id;
    await api().post(base).set(other.headers).send({ ...JOB, title: "Designer", jobType: "CONTRACT", isRemote: false, location: "Pune" });

    const list = await api().get(base).set(other.headers);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data[0].isMine).toBe(true);
    expect((await api().get(`${base}?jobType=CONTRACT`).set(author.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?remote=true`).set(author.headers)).body.data.map((j: { id: string }) => j.id)).toEqual([id]);
    expect((await api().get(`${base}?q=designer`).set(author.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?location=pun`).set(author.headers)).body.data).toHaveLength(1);

    const detail = await api().get(`${base}/${id}`).set(other.headers);
    expect(detail.body.data.author.fullName).toBe(author.membership.fullName);

    expect((await api().patch(`${base}/${id}`).set(other.headers).send({ title: "Hacked" })).status).toBe(403);
    const edited = await api().patch(`${base}/${id}`).set(author.headers).send({ title: "Senior Backend Engineer", expiresAt: new Date(Date.now() + 86400000).toISOString() });
    expect(edited.body.data.title).toBe("Senior Backend Engineer");
    expect(edited.body.data.moderationStatus).toBe("APPROVED");

    const closed = await api().post(`${base}/${id}/close`).set(author.headers);
    expect(closed.body.data.isClosed).toBe(true);
    expect((await api().get(base).set(other.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?includeClosed=true`).set(other.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?mine=true`).set(author.headers)).body.data).toHaveLength(1);

    expect((await api().delete(`${base}/${id}`).set(other.headers)).status).toBe(403);
    expect((await api().delete(`${base}/${id}`).set(author.headers)).status).toBe(204);
    expect((await api().get(`${base}/${id}`).set(author.headers)).status).toBe(404);
  });

  it("validates input", async () => {
    const { tenant } = await createTenant(ctx);
    const author = await memberSession(ctx, tenant.id);
    const res = await api().post(`/api/v1/t/${tenant.slug}/jobs`).set(author.headers).send({ ...JOB, jobType: "GIG", description: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(["jobType", "description"]));
  });

  it("manages the 'looking for work' flag and reflects it in the directory", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const seeker = await memberSession(ctx, tenant.id, { fullName: "Seeker One" });
    const viewer = await memberSession(ctx, tenant.id);

    expect((await api().get(`${base}/jobs/seekers/me`).set(seeker.headers)).body.data).toBeNull();
    const put = await api().put(`${base}/jobs/seekers/me`).set(seeker.headers).send({ note: "Open to backend roles", preferredLocations: "Remote" });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ note: "Open to backend roles", isActive: true, member: { id: seeker.membership.id, isOpenToWork: true } });

    const list = await api().get(`${base}/jobs/seekers`).set(viewer.headers);
    expect(list.body.data).toHaveLength(1);
    const dir = await api().get(`${base}/directory?q=Seeker`).set(viewer.headers);
    expect(dir.body.data[0]).toMatchObject({ id: seeker.membership.id, isOpenToWork: true });

    await api().put(`${base}/jobs/seekers/me`).set(seeker.headers).send({ note: "Paused", isActive: false });
    expect((await api().get(`${base}/jobs/seekers`).set(viewer.headers)).body.data).toHaveLength(0);
    expect((await api().delete(`${base}/jobs/seekers/me`).set(seeker.headers)).status).toBe(204);
    expect((await api().get(`${base}/jobs/seekers/me`).set(seeker.headers)).body.data).toBeNull();
  });

  it("respects feature flags set by the tenant admin (and busts the tenant cache)", async () => {
    const { tenant } = await createTenant(ctx);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    expect((await api().get(`/api/v1/t/${tenant.slug}/jobs`).set(member.headers)).status).toBe(200);
    const upd = await api().patch(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers).send({ features: { jobs: false } });
    expect(upd.status).toBe(200);
    expect(upd.body.data.features).toMatchObject({ jobs: false, feed: true });
    const blocked = await api().get(`/api/v1/t/${tenant.slug}/jobs`).set(member.headers);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FEATURE_DISABLED");
    expect((await api().get(`/api/v1/tenants/${tenant.slug}`)).body.data.settings.features.jobs).toBe(false);
  });
});
