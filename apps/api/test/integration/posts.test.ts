import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("community feed", () => {
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

  it("posts, comments, reacts and notifies the author", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const author = await memberSession(ctx, tenant.id, { fullName: "Author A" });
    const fan = await memberSession(ctx, tenant.id, { fullName: "Fan B" });

    const tooMany = await api().post(`${base}/posts`).set(author.headers).send({ body: "x", imageUrls: Array(5).fill("https://example.com/a.jpg") });
    expect(tooMany.status).toBe(400);

    const created = await api().post(`${base}/posts`).set(author.headers).send({ body: "Hello batch!", imageUrls: ["https://example.com/a.jpg"] });
    expect(created.status).toBe(201);
    const postId = created.body.data.id;
    expect(created.body.data).toMatchObject({ commentCount: 0, reactionCount: 0, myReaction: null, moderationStatus: "APPROVED" });

    const comment = await api().post(`${base}/posts/${postId}/comments`).set(fan.headers).send({ body: "Welcome!" });
    expect(comment.status).toBe(201);
    expect(comment.body.data).toMatchObject({ postId, author: { fullName: "Fan B" }, isMine: true });

    const react = await api().put(`${base}/posts/${postId}/reactions`).set(fan.headers).send({ type: "LIKE" });
    expect(react.body.data).toEqual({ reactionCount: 1, myReaction: "LIKE" });
    const changed = await api().put(`${base}/posts/${postId}/reactions`).set(fan.headers).send({ type: "LOVE" });
    expect(changed.body.data).toEqual({ reactionCount: 1, myReaction: "LOVE" });

    const detail = await api().get(`${base}/posts/${postId}`).set(fan.headers);
    expect(detail.body.data).toMatchObject({ commentCount: 1, reactionCount: 1, myReaction: "LOVE", isMine: false });
    const asAuthor = await api().get(`${base}/posts/${postId}`).set(author.headers);
    expect(asAuthor.body.data).toMatchObject({ myReaction: null, isMine: true });

    const notifs = await api().get(`${base}/notifications`).set(author.headers);
    expect(notifs.body.data.map((n: { type: string }) => n.type).sort()).toEqual(["POST_COMMENT", "POST_REACTION"]);

    const reactions = await api().get(`${base}/posts/${postId}/reactions`).set(author.headers);
    expect(reactions.body.data).toEqual([expect.objectContaining({ type: "LOVE", member: expect.objectContaining({ fullName: "Fan B" }) })]);

    const removed = await api().delete(`${base}/posts/${postId}/reactions`).set(fan.headers);
    expect(removed.body.data).toEqual({ reactionCount: 0, myReaction: null });

    const comments = await api().get(`${base}/posts/${postId}/comments`).set(author.headers);
    expect(comments.body.data).toHaveLength(1);
    const commentId = comments.body.data[0].id;
    expect((await api().delete(`${base}/posts/${postId}/comments/${commentId}`).set(author.headers)).status).toBe(403);
    expect((await api().delete(`${base}/posts/${postId}/comments/${commentId}`).set(fan.headers)).status).toBe(204);
    expect((await api().get(`${base}/posts/${postId}`).set(fan.headers)).body.data.commentCount).toBe(0);

    const edited = await api().patch(`${base}/posts/${postId}`).set(author.headers).send({ body: "Hello batch! (edited)" });
    expect(edited.body.data.body).toBe("Hello batch! (edited)");
    expect((await api().delete(`${base}/posts/${postId}`).set(fan.headers)).status).toBe(403);
    expect((await api().delete(`${base}/posts/${postId}`).set(author.headers)).status).toBe(204);
  });

  it("paginates the feed newest-first and surfaces pinned posts separately", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await api().post(`${base}/posts`).set(member.headers).send({ body: `Post ${i}` });
      ids.push(res.body.data.id);
    }
    const pin = await api().post(`${base}/admin/moderation/POST/${ids[0]}/pin`).set(admin.headers);
    expect(pin.status).toBe(200);
    expect(pin.body.data.isPinned).toBe(true);
    expect((await api().post(`${base}/admin/moderation/POST/${ids[0]}/pin`).set(member.headers)).status).toBe(403);

    const page1 = await api().get(`${base}/posts?limit=1`).set(member.headers);
    expect(page1.body.pinned.map((p: { id: string }) => p.id)).toEqual([ids[0]]);
    expect(page1.body.data.map((p: { id: string }) => p.id)).toEqual([ids[2]]);
    const page2 = await api().get(`${base}/posts?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`).set(member.headers);
    expect(page2.body.data.map((p: { id: string }) => p.id)).toEqual([ids[1]]);
    expect(page2.body.pinned).toBeUndefined();
    expect(page2.body.nextCursor).toBeNull();

    await api().post(`${base}/admin/moderation/POST/${ids[0]}/unpin`).set(admin.headers);
    expect((await api().get(`${base}/posts`).set(member.headers)).body.data).toHaveLength(3);
  });

  it("admin can delete any comment", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}`;
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const member = await memberSession(ctx, tenant.id);
    const post = await api().post(`${base}/posts`).set(member.headers).send({ body: "Hi" });
    const comment = await api().post(`${base}/posts/${post.body.data.id}/comments`).set(member.headers).send({ body: "me" });
    expect((await api().delete(`${base}/posts/${post.body.data.id}/comments/${comment.body.data.id}`).set(admin.headers)).status).toBe(204);
  });
});
