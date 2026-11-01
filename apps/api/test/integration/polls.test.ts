import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pollVotes, postPolls, posts } from "../../src/db/schema";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("polls", () => {
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

  async function setup() {
    const { tenant } = await createTenant(ctx);
    const author = await memberSession(ctx, tenant.id);
    const voter = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}`;
    return { tenant, author, voter, base };
  }

  it("creates a poll with a post and validates its options", async () => {
    const { base, author } = await setup();
    const bad = async (poll: unknown) => (await api().post(`${base}/posts`).set(author.headers).send({ body: "Q?", poll })).status;
    expect(await bad({ options: ["Only one"] })).toBe(400);
    expect(await bad({ options: ["A", "a"] })).toBe(400);
    expect(await bad({ options: ["1", "2", "3", "4", "5", "6", "7"] })).toBe(400);
    expect(await bad({ options: ["A", "B"], closesAt: "2000-01-01T00:00:00Z" })).toBe(400);
    const res = await api()
      .post(`${base}/posts`)
      .set(author.headers)
      .send({ body: "Where should the reunion be?", poll: { options: ["Campus", "Goa", "Online"] } });
    expect(res.status).toBe(201);
    expect(res.body.data.poll).toMatchObject({ allowsMultiple: false, closesAt: null, isClosed: false, totalVoters: 0, myVotes: [] });
    expect(res.body.data.poll.options.map((o: { label: string }) => o.label)).toEqual(["Campus", "Goa", "Online"]);
    // Editing the post can't change the poll (the field is ignored).
    const edit = await api().patch(`${base}/posts/${res.body.data.id}`).set(author.headers).send({ body: "Where should the 2026 reunion be?", poll: { options: ["X", "Y"] } });
    expect(edit.body.data.poll.options.map((o: { label: string }) => o.label)).toEqual(["Campus", "Goa", "Online"]);
  });

  it("takes one vote per member on single-choice polls, lets members change or clear it, and shows counts", async () => {
    const { base, author, voter, tenant } = await setup();
    const post = (await api().post(`${base}/posts`).set(author.headers).send({ body: "Pick one", poll: { options: ["A", "B"] } })).body.data;
    const [a, b] = post.poll.options.map((o: { id: string }) => o.id);
    expect((await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [a, b] })).status).toBe(400);
    const v1 = await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [a] });
    expect(v1.body.data).toMatchObject({ totalVoters: 1, myVotes: [a] });
    const v2 = await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [b] });
    expect(v2.body.data.options.map((o: { votes: number }) => o.votes)).toEqual([0, 1]);
    await api().put(`${base}/posts/${post.id}/poll/vote`).set(author.headers).send({ optionIds: [b] });

    // Feed shows the poll with the viewer's own vote.
    const feed = await api().get(`${base}/posts`).set(voter.headers);
    expect(feed.body.data[0].poll).toMatchObject({ totalVoters: 2, myVotes: [b] });
    const asAuthor = await api().get(`${base}/posts/${post.id}`).set(author.headers);
    expect(asAuthor.body.data.poll.myVotes).toEqual([b]);

    const cleared = await api().delete(`${base}/posts/${post.id}/poll/vote`).set(voter.headers);
    expect(cleared.body.data).toMatchObject({ totalVoters: 1, myVotes: [] });

    // Two votes racing on a single-choice poll still leave one.
    await Promise.all([a, b, a, b].map((id) => api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [id] })));
    const mine = await ctx.db.select().from(pollVotes).where(eq(pollVotes.membershipId, voter.membership.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]!.tenantId).toBe(tenant.id);
  });

  it("allows several choices when the poll does, and refuses votes once closed or on unpublished posts", async () => {
    const { base, author, voter } = await setup();
    const post = (await api().post(`${base}/posts`).set(author.headers).send({ body: "Pick any", poll: { options: ["A", "B", "C"], allowsMultiple: true } })).body.data;
    const [a, , c] = post.poll.options.map((o: { id: string }) => o.id);
    const res = await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [a, c, a] });
    expect(res.body.data).toMatchObject({ totalVoters: 1, myVotes: expect.arrayContaining([a, c]) });
    expect(res.body.data.options.map((o: { votes: number }) => o.votes)).toEqual([1, 0, 1]);
    expect((await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);

    await ctx.db.update(postPolls).set({ closesAt: new Date(Date.now() - 1000) }).where(eq(postPolls.postId, post.id));
    const closed = await api().put(`${base}/posts/${post.id}/poll/vote`).set(voter.headers).send({ optionIds: [a] });
    expect(closed.status).toBe(403);
    expect((await api().get(`${base}/posts/${post.id}`).set(voter.headers)).body.data.poll.isClosed).toBe(true);

    const plain = (await api().post(`${base}/posts`).set(author.headers).send({ body: "No poll" })).body.data;
    expect(plain.poll).toBeNull();
    expect((await api().put(`${base}/posts/${plain.id}/poll/vote`).set(voter.headers).send({ optionIds: [a] })).status).toBe(404);

    const pending = (await api().post(`${base}/posts`).set(author.headers).send({ body: "Pending poll", poll: { options: ["A", "B"] } })).body.data;
    await ctx.db.update(posts).set({ moderationStatus: "PENDING" }).where(eq(posts.id, pending.id));
    expect((await api().put(`${base}/posts/${pending.id}/poll/vote`).set(author.headers).send({ optionIds: [pending.poll.options[0].id] })).status).toBe(403);
  });
});
