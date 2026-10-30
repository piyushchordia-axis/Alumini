import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("content reports", () => {
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

  it("files reports and lets admins resolve them by removing content", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const spammer = await memberSession(ctx, tenant.id, { fullName: "Spammer" });
    const r1 = await memberSession(ctx, tenant.id, { fullName: "Reporter One" });
    const r2 = await memberSession(ctx, tenant.id);

    const post = await api().post(`${base}/posts`).set(spammer.headers).send({ body: "Buy now!!!" });
    const postId = post.body.data.id;

    expect((await api().post(`${base}/reports`).set(spammer.headers).send({ contentType: "POST", contentId: postId, reason: "SPAM" })).status).toBe(400);
    const report = await api().post(`${base}/reports`).set(r1.headers).send({ contentType: "POST", contentId: postId, reason: "SPAM", details: "Scam link" });
    expect(report.status).toBe(201);
    expect(report.body.data).toMatchObject({ status: "OPEN", reason: "SPAM" });
    expect((await api().post(`${base}/reports`).set(r1.headers).send({ contentType: "POST", contentId: postId, reason: "SPAM" })).status).toBe(409);
    const second = await api().post(`${base}/reports`).set(r2.headers).send({ contentType: "POST", contentId: postId, reason: "HARASSMENT" });
    expect(second.status).toBe(201);
    expect((await api().post(`${base}/reports`).set(r2.headers).send({ contentType: "JOB", contentId: postId, reason: "SPAM" })).status).toBe(404);

    expect((await api().get(`${base}/reports/mine`).set(r1.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}/notifications`).set(admin.headers)).body.data[0].type).toBe("REPORT_FILED");

    const queue = await api().get(`${base}/admin/reports`).set(admin.headers);
    expect(queue.body.total).toBe(2);
    expect(queue.body.data[0]).toMatchObject({ content: { excerpt: "Buy now!!!", moderationStatus: "APPROVED" }, reporter: { fullName: expect.any(String) } });
    expect((await api().get(`${base}/admin/moderation?status=APPROVED`).set(admin.headers)).body.data[0].reportCount).toBe(2);
    expect((await api().get(`${base}/admin/dashboard`).set(admin.headers)).body.data.openReports).toBe(2);

    const resolve = await api().post(`${base}/admin/reports/${report.body.data.id}/resolve`).set(admin.headers).send({ action: "REMOVE_CONTENT", note: "Spam confirmed" });
    expect(resolve.body.data).toMatchObject({ status: "RESOLVED", resolutionNote: "Spam confirmed" });
    expect((await api().get(`${base}/posts/${postId}`).set(r1.headers)).status).toBe(404);
    expect((await api().get(`${base}/admin/reports`).set(admin.headers)).body.total).toBe(0);
    expect((await api().get(`${base}/admin/reports?status=RESOLVED`).set(admin.headers)).body.total).toBe(2);
    expect((await api().post(`${base}/admin/reports/${report.body.data.id}/resolve`).set(admin.headers).send({ action: "NONE" })).status).toBe(409);
    expect((await api().get(`${base}/notifications`).set(spammer.headers)).body.data[0].type).toBe("CONTENT_REMOVED");
  });

  it("dismisses or resolves without action", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const author = await memberSession(ctx, tenant.id);
    const reporter = await memberSession(ctx, tenant.id);
    const post = await api().post(`${base}/posts`).set(author.headers).send({ body: "fine" });
    const rep = await api().post(`${base}/reports`).set(reporter.headers).send({ contentType: "POST", contentId: post.body.data.id, reason: "OTHER" });
    const dismissed = await api().post(`${base}/admin/reports/${rep.body.data.id}/dismiss`).set(admin.headers).send({ note: "Nothing wrong" });
    expect(dismissed.body.data).toMatchObject({ status: "DISMISSED", resolutionNote: "Nothing wrong" });
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(reporter.headers)).status).toBe(200);
    expect((await api().post(`${base}/admin/reports/${rep.body.data.id}/dismiss`).set(reporter.headers).send({})).status).toBe(403);
  });
});
