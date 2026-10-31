import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notifications } from "../../src/db/schema";
import { upsertPushToken } from "../../src/repositories/users.repo";
import { ExpoPushChannel } from "../../src/services/notifications/ExpoPushChannel";
import { PushSendError } from "../../src/services/notifications/NotificationChannel";
import { notify } from "../../src/services/notifications/notification.service";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** Fake Expo send endpoint: answers with `status`, recording every message. */
function fakeExpo() {
  const state = { status: 200, sent: [] as Array<{ to: string; data: Record<string, unknown> }> };
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    const batch = JSON.parse(String(init?.body)) as typeof state.sent;
    if (state.status !== 200) return new Response("busy", { status: state.status });
    state.sent.push(...batch);
    return new Response(JSON.stringify({ data: batch.map((m) => ({ status: "ok", id: `t:${m.to}` })) }), { status: 200 });
  }) as typeof fetch;
  return { state, impl };
}

describe.skipIf(!dbAvailable)("notification delivery jobs", () => {
  let ctx: TestContext;
  let expo: ReturnType<typeof fakeExpo>;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    expo = fakeExpo();
    ctx.push = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("delivers a comment notification to the author's phone in the background", async () => {
    const { tenant } = await createTenant(ctx, { slug: "jobs-u" });
    const author = await memberSession(ctx, tenant.id);
    const commenter = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: author.user.id, token: "ExponentPushToken[author]", platform: "ANDROID" });
    const post = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/posts`).set(author.headers).send({ body: "Hello batch" });
    await request(ctx.app).post(`/api/v1/t/${tenant.slug}/posts/${post.body.data.id}/comments`).set(commenter.headers).send({ body: "Hi!" });

    // Nothing has been sent during the request itself.
    expect(expo.state.sent).toHaveLength(0);
    const result = await ctx.jobs.drain();
    expect(result.failed).toEqual([]);
    expect(expo.state.sent).toHaveLength(1);
    expect(expo.state.sent[0]).toMatchObject({ to: "ExponentPushToken[author]", data: { type: "POST_COMMENT", tenantSlug: "jobs-u", postId: post.body.data.id } });
  });

  it("skips notifications deleted before delivery", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: m.user.id, token: "ExponentPushToken[x]", platform: "IOS" });
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.membership.id], type: "SYSTEM", title: "Gone soon" });
    await ctx.db.delete(notifications);
    await ctx.jobs.drain();
    expect(expo.state.sent).toHaveLength(0);
  });

  it("retries push when Expo is busy and gives up on requests it rejects", async () => {
    const { tenant } = await createTenant(ctx);
    const m = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: m.user.id, token: "ExponentPushToken[y]", platform: "IOS" });
    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.membership.id], type: "SYSTEM", title: "Retry me" });
    expo.state.status = 503;
    const busy = await ctx.jobs.drain();
    // push.send allows 5 attempts; all hit the 503.
    expect(busy.failed).toHaveLength(1);
    expect(busy.failed[0]!.error).toBeInstanceOf(PushSendError);
    expect((busy.failed[0]!.error as PushSendError).retryable).toBe(true);

    await notify(ctx, { tenantId: tenant.id, recipientMembershipIds: [m.membership.id], type: "SYSTEM", title: "Rejected" });
    expo.state.status = 400;
    const rejected = await ctx.jobs.drain();
    expect(rejected.failed).toEqual([]); // 4xx is logged, not retried
    expect(rejected.ran).toBe(2);
  });
});
