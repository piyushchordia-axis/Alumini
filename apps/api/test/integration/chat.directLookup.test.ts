import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { memberships, tenantSettings } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { keys } from "../../src/redis/keys";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, bareMember, chatApi, openRequest, type Session } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("finding the thread with a member", () => {
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

  async function setup() {
    const { tenant } = await createTenant(ctx);
    const a = await memberSession(ctx, tenant.id);
    const b = await memberSession(ctx, tenant.id);
    const chat = (m: Session) => chatApi(ctx, tenant.slug, m);
    const lookup = (from: Session, membershipId: string) => request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/direct/${membershipId}`).set(from.headers);
    const answer = async (from: Session, to: Session) => (await lookup(from, to.membership.id).expect(200)).body.data as { conversationId: string | null };
    return { tenant, a, b, chat, lookup, answer };
  }

  it("answers null when there's no thread, in the same way whether the member exists or not", async () => {
    const { tenant, a, b, answer, lookup } = await setup();
    expect(await answer(a, b)).toEqual({ conversationId: null });
    const nobody = await lookup(a, "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81").expect(200);
    expect(nobody.body.data).toEqual({ conversationId: null });
    const elsewhere = (await createTenant(ctx)).tenant;
    const stranger = await bareMember(ctx, elsewhere.id);
    expect((await lookup(a, stranger.id).expect(200)).body.data).toEqual({ conversationId: null });
    expect((await lookup(a, a.membership.id).expect(200)).body.data).toEqual({ conversationId: null });
    expect(tenant.id).not.toBe(elsewhere.id);
  });

  it("gives a requester the same answer across pending, declined and blocked", async () => {
    const { tenant, a, b, chat, answer } = await setup();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    const pending = await answer(a, b);
    expect(pending).toEqual({ conversationId: conversation.id });

    await chat(b).decline(conversation.id);
    expect(await answer(a, b)).toEqual(pending);

    await chat(b).block(a.membership.id);
    expect(await answer(a, b)).toEqual(pending);

    await chat(b).unblock(a.membership.id);
    expect(await answer(a, b)).toEqual(pending);
  });

  it("gives someone whose first message was withheld the thread they believe they have, and the member who blocked them nothing", async () => {
    const { tenant, a, b, chat, answer } = await setup();
    await chat(b).block(a.membership.id);
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    expect(await answer(a, b)).toEqual({ conversationId: conversation.id });
    expect(await answer(b, a)).toEqual({ conversationId: null });
    // Lifting the block doesn't turn up what was withheld: the request is still declined, and on their side it's in no list.
    await chat(b).unblock(a.membership.id);
    expect(await answer(b, a)).toEqual({ conversationId: null });
  });

  it("shows a request's recipient the thread only while their Requests tab does", async () => {
    const { tenant, a, b, chat, answer } = await setup();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    expect(await answer(b, a)).toEqual({ conversationId: conversation.id });

    await chat(b).decline(conversation.id);
    expect(await answer(b, a)).toEqual({ conversationId: null });
    expect((await chat(b).list("MAIN")).body.data).toEqual([]);
    expect((await chat(b).list("REQUESTS")).body.data).toEqual([]);
  });

  it("agrees with the lists for every state a thread can be in", async () => {
    const { tenant, a, b, chat, answer } = await setup();
    const listedBy = async (from: Session) => {
      const lists = await Promise.all((["MAIN", "REQUESTS"] as const).map((inbox) => chat(from).list(inbox)));
      return lists.flatMap((l) => l.body.data as Array<{ id: string }>).map((t) => t.id);
    };
    const expectAgreement = async () => {
      for (const [from, to] of [[a, b], [b, a]] as const) {
        const listed = await listedBy(from);
        const { conversationId } = await answer(from, to);
        expect(conversationId ? [conversationId] : []).toEqual(listed);
      }
    };
    await expectAgreement();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    await expectAgreement();
    await chat(b).decline(conversation.id);
    await expectAgreement();
    await chat(b).accept(conversation.id);
    await expectAgreement();
    await chat(a).block(b.membership.id);
    await expectAgreement();
    await chat(a).unblock(b.membership.id);
    await expectAgreement();
  });

  it("finds the right thread among a member's others, whichever side of each pair the ids put them on", async () => {
    const { tenant, a, b, answer } = await setup();
    const c = await memberSession(ctx, tenant.id);
    const threads = [
      { from: a, to: b, id: await acceptedThread(ctx, tenant.slug, a, b) },
      { from: a, to: c, id: await acceptedThread(ctx, tenant.slug, a, c) },
      { from: b, to: c, id: await acceptedThread(ctx, tenant.slug, b, c) },
    ];
    for (const { from, to, id } of threads) {
      expect(await answer(from, to)).toEqual({ conversationId: id });
      expect(await answer(to, from)).toEqual({ conversationId: id });
    }
  });

  it("finds an accepted thread from either side", async () => {
    const { tenant, a, b, answer } = await setup();
    const id = await acceptedThread(ctx, tenant.slug, a, b);
    expect(await answer(a, b)).toEqual({ conversationId: id });
    expect(await answer(b, a)).toEqual({ conversationId: id });
  });

  it("finds a closed thread from either side, which stays in both lists", async () => {
    const { tenant, a, b, answer } = await setup();
    const { conversationId } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: a.membership.id }));
    await runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId: tenant.id, conversationId, hasOtherLiveConnection: false }));
    expect(await answer(a, b)).toEqual({ conversationId });
    expect(await answer(b, a)).toEqual({ conversationId });
  });

  it("hides a request from someone suspended, as the Requests tab does, until they're back", async () => {
    const { tenant, a, b, answer } = await setup();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, a.membership.id));
    expect(await answer(b, a)).toEqual({ conversationId: null });
    await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, a.membership.id));
    expect(await answer(b, a)).toEqual({ conversationId: conversation.id });
  });

  it("hides a request from someone who has become a current pupil, as the Requests tab does", async () => {
    const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } });
    const a = await memberSession(ctx, tenant.id, { batchYear: 2000 });
    const b = await memberSession(ctx, tenant.id, { batchYear: 2001 });
    await openRequest(ctx, tenant.slug, a, b.membership.id);
    await ctx.db.update(memberships).set({ batchYear: new Date().getFullYear() + 2 }).where(eq(memberships.id, a.membership.id));
    const res = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/direct/${a.membership.id}`).set(b.headers).expect(200);
    expect(res.body.data).toEqual({ conversationId: null });
    expect((await chatApi(ctx, tenant.slug, b).list("REQUESTS")).body.data).toEqual([]);
  });

  it("is closed to a current pupil and when messaging is off", async () => {
    const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } });
    const alum = await memberSession(ctx, tenant.id, { batchYear: 2000 });
    const pupil = await memberSession(ctx, tenant.id, { batchYear: new Date().getFullYear() + 2 });
    const asked = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/direct/${alum.membership.id}`).set(pupil.headers);
    expect(asked.status).toBe(403);
    expect(asked.body.error.code).toBe("FEATURE_DISABLED");

    await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
    await invalidateTenantCache(ctx, tenant.slug);
    const off = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/direct/${pupil.membership.id}`).set(alum.headers);
    expect(off.status).toBe(403);
    expect(off.body.error.code).toBe("FEATURE_DISABLED");
  });

  it("needs a signed-in member and a real id, and is never cached", async () => {
    const { tenant, a, b, lookup } = await setup();
    await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/direct/${b.membership.id}`).expect(401);
    await lookup(a, "not-a-uuid").expect(400);
    expect((await lookup(a, b.membership.id)).headers["cache-control"]).toBe("no-store");
  });

  it("shares the chat-read limit", async () => {
    const limited = await createTestContext({});
    const previous = process.env.RATE_LIMIT_IN_TESTS;
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      const { tenant } = await createTenant(limited);
      const a = await memberSession(limited, tenant.id);
      const b = await memberSession(limited, tenant.id);
      await limited.redis.set(keys.rateLimit("chat-read", a.membership.id), "119");
      const url = `/api/v1/t/${tenant.slug}/chat/direct/${b.membership.id}`;
      expect((await request(limited.app).get(url).set(a.headers)).status).toBe(200);
      const over = await request(limited.app).get(url).set(a.headers);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe("RATE_LIMITED");
    } finally {
      process.env.RATE_LIMIT_IN_TESTS = previous;
      await limited.truncateAll();
      await limited.dispose();
    }
  });
});
