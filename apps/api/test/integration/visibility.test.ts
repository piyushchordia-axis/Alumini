import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, memberships } from "../../src/db/schema";
import { auth, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe.skipIf(!dbAvailable)("visibility and access rules", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ UPLOADS_PER_TENANT_DAILY_CAP: "3" });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    await ctx.redis.flushdb();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  it("hides a suspended member's posts, comments and RSVPs from other members, not from admins", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const author = await memberSession(ctx, tenant.id);
    const reader = await memberSession(ctx, tenant.id);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const post = await api().post(`${base}/posts`).set(author.headers).send({ body: "Hello all" });
    const other = await api().post(`${base}/posts`).set(reader.headers).send({ body: "Reader post" });
    await api().post(`${base}/posts/${other.body.data.id}/comments`).set(author.headers).send({ body: "Nice" });

    await ctx.db.update(memberships).set({ status: "SUSPENDED", statusChangedAt: new Date() }).where(eq(memberships.id, author.membership.id));

    const feed = await api().get(`${base}/posts`).set(reader.headers);
    expect(feed.body.data.map((p: { body: string }) => p.body)).toEqual(["Reader post"]);
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(reader.headers)).status).toBe(404);
    const comments = await api().get(`${base}/posts/${other.body.data.id}/comments`).set(reader.headers);
    expect(comments.body.data).toHaveLength(0);
    // Admins still see it (to review or reinstate).
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(admin.headers)).status).toBe(200);
  });

  it("shows the admin's moderation note only to the author and admins", async () => {
    const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const author = await memberSession(ctx, tenant.id);
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const reader = await memberSession(ctx, tenant.id);
    const job = await api().post(`${base}/jobs`).set(author.headers).send({ title: "Backend engineer", companyName: "Acme", jobType: "FULL_TIME", description: "Build APIs for alumni" });
    await api().post(`${base}/admin/moderation/JOB/${job.body.data.id}/approve`).set(admin.headers).send({ note: "Approved after checking the company" });
    const asAuthor = await api().get(`${base}/jobs/${job.body.data.id}`).set(author.headers);
    const asReader = await api().get(`${base}/jobs/${job.body.data.id}`).set(reader.headers);
    expect(asAuthor.body.data.moderationNote).toBe("Approved after checking the company");
    expect(asReader.body.data.moderationNote).toBeNull();
  });

  it("lets pending and rejected members read their own notifications", async () => {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const pending = await memberSession(ctx, tenant.id, { status: "PENDING" });
    const res = await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(pending.headers);
    expect(res.status).toBe(200);
    expect((await api().get(`/api/v1/t/${tenant.slug}/notifications/unread-count`).set(pending.headers)).status).toBe(200);
    // Strangers still cannot.
    const stranger = await loginAs(ctx, (await createUser(ctx)).phoneE164);
    expect((await api().get(`/api/v1/t/${tenant.slug}/notifications`).set(auth(stranger.accessToken))).status).toBe(403);
  });

  it("only lets members (or people registering where that is open) upload, within a daily quota", async () => {
    const open = (await createTenant(ctx)).tenant;
    const closed = (await createTenant(ctx, { allowSelfRegistration: false })).tenant;
    const stranger = auth((await loginAs(ctx, (await createUser(ctx)).phoneE164)).accessToken);
    const upload = (slug: string, headers: Record<string, string>) => api().post(`/api/v1/t/${slug}/uploads`).set(headers).attach("file", PNG, { filename: "a.png", contentType: "image/png" });

    expect((await upload(open.slug, stranger)).status).toBe(201); // registering: avatar before the membership exists
    expect((await upload(closed.slug, stranger)).status).toBe(403);
    const suspended = await memberSession(ctx, open.id, { status: "SUSPENDED" });
    expect((await upload(open.slug, suspended.headers)).status).toBe(403);
    const member = await memberSession(ctx, open.id);
    expect((await upload(open.slug, member.headers)).status).toBe(201);
    expect((await upload(open.slug, member.headers)).status).toBe(201);
    // Cap of 3 per institution per day in this test context.
    expect((await upload(open.slug, member.headers)).status).toBe(429);
  });

  it("records a null membership when Illuminize staff pin a post", async () => {
    const { tenant } = await createTenant(ctx);
    const author = await memberSession(ctx, tenant.id);
    const post = await api().post(`/api/v1/t/${tenant.slug}/posts`).set(author.headers).send({ body: "Pin me" });
    const staff = auth((await loginAs(ctx, "+919999999999")).accessToken);
    const pin = await api().post(`/api/v1/t/${tenant.slug}/admin/moderation/POST/${post.body.data.id}/pin`).set(staff);
    expect(pin.status).toBe(200);
    expect(pin.body.data.isPinned).toBe(true);
    const [entry] = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenant.id), eq(auditLog.action, "content.pin")));
    expect(entry?.actorMembershipId).toBeNull();
  });
});
