import { notificationTarget } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, memberships } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { createTenant, loginAs, memberSession, auth } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("content moderation (ADMIN_APPROVAL)", () => {
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

  it("holds member content for approval while admins publish immediately", async () => {
    const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const author = await memberSession(ctx, tenant.id, { fullName: "Pending Pat" });
    const other = await memberSession(ctx, tenant.id);

    const post = await api().post(`${base}/posts`).set(author.headers).send({ body: "Please approve me" });
    expect(post.body.data.moderationStatus).toBe("PENDING");
    const postId = post.body.data.id;
    const adminPost = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Admin notice" });
    expect(adminPost.body.data.moderationStatus).toBe("APPROVED");

    // visibility
    expect((await api().get(`${base}/posts`).set(other.headers)).body.data.map((p: { id: string }) => p.id)).toEqual([adminPost.body.data.id]);
    expect((await api().get(`${base}/posts/${postId}`).set(other.headers)).status).toBe(404);
    expect((await api().get(`${base}/posts/${postId}`).set(author.headers)).status).toBe(200);
    expect((await api().get(`${base}/posts?mine=true`).set(author.headers)).body.data[0].moderationStatus).toBe("PENDING");
    expect((await api().post(`${base}/posts/${postId}/comments`).set(author.headers).send({ body: "hi" })).status).toBe(403);

    // admin notified + queue
    const adminNotifs = await api().get(`${base}/notifications`).set(admin.headers);
    expect(adminNotifs.body.data[0]).toMatchObject({ type: "CONTENT_PENDING", data: { contentType: "POST", contentId: postId } });
    const queue = await api().get(`${base}/admin/moderation`).set(admin.headers);
    expect(queue.body.total).toBe(1);
    expect(queue.body.data[0]).toMatchObject({ contentType: "POST", id: postId, author: { fullName: "Pending Pat" }, reportCount: 0 });
    expect((await api().get(`${base}/admin/moderation`).set(other.headers)).status).toBe(403);
    const dashboard = await api().get(`${base}/admin/dashboard`).set(admin.headers);
    expect(dashboard.body.data.pendingContent).toBe(1);

    const adminView = await api().get(`${base}/admin/moderation/POST/${postId}`).set(admin.headers);
    expect(adminView.body.data.body).toBe("Please approve me");

    // reject with note → author sees it, can edit → pending again
    const reject = await api().post(`${base}/admin/moderation/POST/${postId}/reject`).set(admin.headers).send({ note: "Needs more context" });
    expect(reject.body.data).toMatchObject({ from: "PENDING", to: "REJECTED", content: { moderationStatus: "REJECTED", moderationNote: "Needs more context" } });
    const mine = await api().get(`${base}/posts/${postId}`).set(author.headers);
    expect(mine.body.data).toMatchObject({ moderationStatus: "REJECTED", moderationNote: "Needs more context" });
    const authorNotifs = await api().get(`${base}/notifications`).set(author.headers);
    expect(authorNotifs.body.data[0].type).toBe("CONTENT_REJECTED");

    const edited = await api().patch(`${base}/posts/${postId}`).set(author.headers).send({ body: "Please approve me — with context" });
    expect(edited.body.data).toMatchObject({ moderationStatus: "PENDING", moderationNote: null });

    // approve → visible to everyone; author notified
    const approve = await api().post(`${base}/admin/moderation/POST/${postId}/approve`).set(admin.headers).send({});
    expect(approve.body.data.to).toBe("APPROVED");
    expect((await api().get(`${base}/posts/${postId}`).set(other.headers)).status).toBe(200);
    expect((await api().get(`${base}/notifications`).set(author.headers)).body.data[0].type).toBe("CONTENT_APPROVED");
    expect((await api().post(`${base}/admin/moderation/POST/${postId}/approve`).set(admin.headers).send({})).status).toBe(409);

    // edit after approval → pending again (ADMIN_APPROVAL)
    const reEdit = await api().patch(`${base}/posts/${postId}`).set(author.headers).send({ body: "edited again" });
    expect(reEdit.body.data.moderationStatus).toBe("PENDING");
    await api().post(`${base}/admin/moderation/POST/${postId}/approve`).set(admin.headers).send({});

    // remove → hidden from everyone except admins; author cannot edit; restore brings it back
    const remove = await api().post(`${base}/admin/moderation/POST/${postId}/remove`).set(admin.headers).send({ note: "Off topic" });
    expect(remove.body.data.to).toBe("REMOVED");
    expect((await api().get(`${base}/posts/${postId}`).set(other.headers)).status).toBe(404);
    expect((await api().get(`${base}/posts/${postId}`).set(author.headers)).status).toBe(404);
    expect((await api().get(`${base}/posts?mine=true`).set(author.headers)).body.data[0].moderationStatus).toBe("REMOVED");
    expect((await api().patch(`${base}/posts/${postId}`).set(author.headers).send({ body: "x" })).status).toBe(403);
    expect((await api().get(`${base}/notifications`).set(author.headers)).body.data[0].type).toBe("CONTENT_REMOVED");
    expect((await api().get(`${base}/admin/moderation?status=REMOVED`).set(admin.headers)).body.total).toBe(1);
    await api().post(`${base}/admin/moderation/POST/${postId}/restore`).set(admin.headers).send({});
    expect((await api().get(`${base}/posts/${postId}`).set(other.headers)).status).toBe(200);
  });

  it("moderates every content type through the same path and keeps comment counts right", async () => {
    const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    const future = new Date(Date.now() + 86400000).toISOString();

    const job = await api().post(`${base}/jobs`).set(member.headers).send({ title: "Role", companyName: "Co", jobType: "FULL_TIME", description: "Ten chars plus" });
    const funding = await api().post(`${base}/funding`).set(member.headers).send({ kind: "OFFERING", title: "Cheques", pitch: "Investing in alumni." });
    const event = await api().post(`${base}/events`).set(member.headers).send({ title: "Meet", description: "d", kind: "CASUAL_MEETUP", city: "Pune", startAt: future, timezone: "Asia/Kolkata" });
    const business = await api().post(`${base}/businesses`).set(member.headers).send({ name: "Shop", category: "RETAIL", description: "Ten chars plus" });
    for (const r of [job, funding, event, business]) expect(r.body.data.moderationStatus).toBe("PENDING");
    expect((await api().get(`${base}/jobs`).set(admin.headers)).body.data).toHaveLength(0);

    const queue = await api().get(`${base}/admin/moderation?pageSize=10`).set(admin.headers);
    expect(queue.body.data.map((i: { contentType: string }) => i.contentType).sort()).toEqual(["BUSINESS", "EVENT", "FUNDING", "JOB"]);
    expect((await api().get(`${base}/admin/moderation?contentType=JOB`).set(admin.headers)).body.total).toBe(1);

    for (const [type, id] of [["JOB", job.body.data.id], ["FUNDING", funding.body.data.id], ["EVENT", event.body.data.id], ["BUSINESS", business.body.data.id]] as const) {
      const res = await api().post(`${base}/admin/moderation/${type}/${id}/approve`).set(admin.headers).send({});
      expect(res.status).toBe(200);
    }
    expect((await api().get(`${base}/jobs`).set(admin.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}/funding`).set(admin.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}/events`).set(admin.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}/businesses`).set(admin.headers)).body.data).toHaveLength(1);

    // comments are never pre-moderated but can be removed; counts follow
    const post = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Admin post" });
    const comment = await api().post(`${base}/posts/${post.body.data.id}/comments`).set(member.headers).send({ body: "spam" });
    expect(comment.body.data.moderationStatus).toBe("APPROVED");
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(member.headers)).body.data.commentCount).toBe(1);
    await api().post(`${base}/admin/moderation/COMMENT/${comment.body.data.id}/remove`).set(admin.headers).send({});
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(member.headers)).body.data.commentCount).toBe(0);
    expect((await api().get(`${base}/posts/${post.body.data.id}/comments`).set(member.headers)).body.data).toHaveLength(0);
    expect((await api().get(`${base}/posts/${post.body.data.id}/comments`).set(admin.headers)).body.data).toHaveLength(1);
    await api().post(`${base}/admin/moderation/COMMENT/${comment.body.data.id}/restore`).set(admin.headers).send({});
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(member.headers)).body.data.commentCount).toBe(1);

    expect((await api().post(`${base}/admin/moderation/JOB/${job.body.data.id}/pin`).set(admin.headers)).status).toBe(400);
    expect((await api().post(`${base}/admin/moderation/JOB/00000000-0000-4000-8000-000000000000/approve`).set(admin.headers).send({})).status).toBe(404);
  });

  it("sends the author somewhere that opens when their content is rejected or removed", async () => {
    const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const author = await memberSession(ctx, tenant.id);
    const future = new Date(Date.now() + 86400000).toISOString();
    const items = [
      ["POST", "post", "posts", { body: "Please approve me" }],
      ["JOB", "job", "jobs", { title: "Role", companyName: "Co", jobType: "FULL_TIME", description: "Ten chars plus" }],
      ["FUNDING", "funding", "funding", { kind: "OFFERING", title: "Cheques", pitch: "Investing in alumni." }],
      ["EVENT", "event", "events", { title: "Meet", description: "d", kind: "CASUAL_MEETUP", city: "Pune", startAt: future, timezone: "Asia/Kolkata" }],
      ["BUSINESS", "business", "businesses", { name: "Shop", category: "RETAIL", description: "Ten chars plus" }],
    ] as const;
    const latestTarget = async () => {
      const [n] = (await api().get(`${base}/notifications`).set(author.headers)).body.data;
      return { type: n.type as string, target: notificationTarget(n.type, n.data) };
    };

    for (const [contentType, kind, path, body] of items) {
      const created = await api().post(`${base}/${path}`).set(author.headers).send(body);
      const id = created.body.data.id as string;
      const detail = `${base}/${path}/${id}`;

      await api().post(`${base}/admin/moderation/${contentType}/${id}/reject`).set(admin.headers).send({ note: "Needs more" }).expect(200);
      expect(await latestTarget()).toEqual({ type: "CONTENT_REJECTED", target: { kind, id } });
      const rejected = await api().get(detail).set(author.headers);
      expect(rejected.status).toBe(200);
      expect(rejected.body.data).toMatchObject({ moderationStatus: "REJECTED", moderationNote: "Needs more" });

      await api().patch(detail).set(author.headers).send(body).expect(200);
      await api().post(`${base}/admin/moderation/${contentType}/${id}/approve`).set(admin.headers).send({}).expect(200);
      await api().post(`${base}/admin/moderation/${contentType}/${id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
      expect(await latestTarget()).toEqual({ type: "CONTENT_REMOVED", target: { kind: "myContent" } });
      expect((await api().get(detail).set(author.headers)).status).toBe(404);
      const mine = await api().get(`${base}/${path}?mine=true`).set(author.headers);
      expect(mine.body.data.find((i: { id: string }) => i.id === id)).toMatchObject({ moderationStatus: "REMOVED", moderationNote: "Off topic" });
    }

    // A removed comment's post is still there, so its notification still opens the post.
    const post = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Admin post" });
    const comment = await api().post(`${base}/posts/${post.body.data.id}/comments`).set(author.headers).send({ body: "spam" });
    await api().post(`${base}/admin/moderation/COMMENT/${comment.body.data.id}/remove`).set(admin.headers).send({}).expect(200);
    expect(await latestTarget()).toEqual({ type: "CONTENT_REMOVED", target: { kind: "post", id: post.body.data.id } });
    expect((await api().get(`${base}/posts/${post.body.data.id}`).set(author.headers)).status).toBe(200);
  });

  describe("an item whose author no longer exists", () => {
    /** No content type can lose its author yet, because each one cascades, so get past the foreign keys to break the link. */
    const orphan = (membershipId: string) =>
      runInTransaction(ctx, async (tx) => {
        await tx.execute(sql`set local session_replication_role = replica`);
        await tx.delete(memberships).where(eq(memberships.id, membershipId));
      });

    it("stays in the queue, so its rows and total agree", async () => {
      const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
      const base = `/api/v1/t/${tenant.slug}`;
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const gone = await memberSession(ctx, tenant.id);
      const here = await memberSession(ctx, tenant.id, { fullName: "Still Here" });
      const listing = { name: "Orphaned Shop", category: "RETAIL", description: "Ten chars plus" };
      const orphaned = await api().post(`${base}/businesses`).set(gone.headers).send(listing).expect(201);
      const kept = await api().post(`${base}/businesses`).set(here.headers).send({ ...listing, name: "Kept Shop" }).expect(201);
      await orphan(gone.membership.id);

      const queue = await api().get(`${base}/admin/moderation?contentType=BUSINESS`).set(admin.headers);
      expect(queue.status).toBe(200);
      expect(queue.body.total).toBe(2);
      expect(queue.body.data).toHaveLength(2);
      const byId = new Map(queue.body.data.map((i: { id: string }) => [i.id, i]));
      expect(byId.get(orphaned.body.data.id)).toMatchObject({ title: "Orphaned Shop", author: null });
      expect(byId.get(kept.body.data.id)).toMatchObject({ title: "Kept Shop", author: { fullName: "Still Here" } });
    });

    it("can still be reported", async () => {
      const { tenant } = await createTenant(ctx);
      const base = `/api/v1/t/${tenant.slug}`;
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const gone = await memberSession(ctx, tenant.id);
      const reporter = await memberSession(ctx, tenant.id);
      const orphaned = await api().post(`${base}/businesses`).set(gone.headers).send({ name: "Orphaned Shop", category: "RETAIL", description: "Ten chars plus" }).expect(201);
      await orphan(gone.membership.id);
      await api().post(`${base}/reports`).set(reporter.headers).send({ contentType: "BUSINESS", contentId: orphaned.body.data.id, reason: "SPAM" }).expect(201);
      const reports = await api().get(`${base}/admin/reports`).set(admin.headers);
      expect(reports.body.data[0].content).toMatchObject({ title: "Orphaned Shop" });
    });
  });

  it("keeps a removed event findable in My posts once its date has passed", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const author = await memberSession(ctx, tenant.id);
    const created = await api().post(`${base}/events`).set(author.headers).send({ title: "Meet", description: "d", kind: "CASUAL_MEETUP", city: "Pune", startAt: new Date(Date.now() + 86400000).toISOString(), timezone: "Asia/Kolkata" });
    const id = created.body.data.id as string;
    await ctx.db.update(events).set({ startAt: new Date(Date.now() - 86400000) }).where(eq(events.id, id));

    await api().post(`${base}/admin/moderation/EVENT/${id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);

    const list = async (scope: string) => (await api().get(`${base}/events?mine=true&scope=${scope}`).set(author.headers)).body.data as Array<{ id: string }>;
    expect(await list("upcoming")).toEqual([]);
    expect((await list("past")).find((e) => e.id === id)).toMatchObject({ moderationStatus: "REMOVED", moderationNote: "Off topic" });
  });

  it("platform admins can moderate without a membership", async () => {
    const { tenant } = await createTenant(ctx, { contentModerationMode: "ADMIN_APPROVAL" });
    const base = `/api/v1/t/${tenant.slug}`;
    const member = await memberSession(ctx, tenant.id);
    const platform = await loginAs(ctx, "+919999999999");
    const post = await api().post(`${base}/posts`).set(member.headers).send({ body: "Hello" });
    const res = await api().post(`${base}/admin/moderation/POST/${post.body.data.id}/approve`).set(auth(platform.accessToken)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.content.moderationStatus).toBe("APPROVED");
  });
});
