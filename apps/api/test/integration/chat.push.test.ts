import { CHAT_PUSH_KINDS, notificationTarget, type ChatMessageDto } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { chatBlocks, chatGroups, chatMessages, chatParticipants, memberships, notifications, outboundMessages, pushTokens, tenantSettings, tenants, users as usersTable } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { keys } from "../../src/redis/keys";
import { upsertPushToken } from "../../src/repositories/users.repo";
import { DIRECT_PUSH_WINDOW, GROUP_PUSH_WINDOW, queueConversationPush } from "../../src/services/chat/fanout";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { CHAT_PUSH_TTL_SEC } from "../../src/services/chat/push";
import { ExpoPushChannel, PUSH_BATCH_SIZE } from "../../src/services/notifications/ExpoPushChannel";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, chatApi, conversationRow, createGroup, groupsApi, openRequest, type Session } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

interface Pushed {
  to: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
}

function fakeExpo() {
  const sent: Pushed[] = [];
  let failures = 0;
  let calls = 0;
  const failing = new Set<number>();
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    calls += 1;
    if (failures > 0 || failing.delete(calls)) {
      if (failures > 0) failures -= 1;
      return new Response("Service unavailable", { status: 503 });
    }
    const batch = JSON.parse(String(init?.body)) as Pushed[];
    sent.push(...batch);
    return new Response(JSON.stringify({ data: batch.map((m) => ({ status: "ok", id: `t:${m.to}` })) }), { status: 200 });
  }) as typeof fetch;
  /** The next `n` requests get a 503, which reaches nobody. */
  const failNext = (n: number) => {
    failures = n;
  };
  /** Only the `n`th request from now gets a 503, so the ones before it go through. */
  const failRequest = (n: number) => {
    failing.add(calls + n);
  };
  return { sent, impl, failNext, failRequest };
}

const ORIGIN_ID = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
const tokenOf = (m: Session) => `ExponentPushToken[${m.user.id}]`;

describe.skipIf(!dbAvailable)("chat push", () => {
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

  async function setup(options: Parameters<typeof createTenant>[1] = {}) {
    const { tenant } = await createTenant(ctx, options);
    const a = await memberSession(ctx, tenant.id, { fullName: "Asha Rao" });
    const b = await memberSession(ctx, tenant.id, { fullName: "Bilal Khan" });
    for (const m of [a, b]) await upsertPushToken(ctx.db, { userId: m.user.id, token: tokenOf(m), platform: "ANDROID" });
    const chat = (m: Session) => chatApi(ctx, tenant.slug, m);
    return { tenant, a, b, chat };
  }

  /** Lets every queued job run, delayed ones included. A thread's first messages leave their own pushes behind, so a test starts from clean. */
  const runJobs = () => ctx.jobs.drain({ includeDelayed: true });
  const start = async () => {
    await runJobs();
    expo.sent.length = 0;
  };
  /** What each member was pushed, by push token. */
  const pushedTo = (m: Session) => expo.sent.filter((p) => p.to === tokenOf(m));

  describe("a message", () => {
    it("turns a burst into one push that has a name and none of the words, and leaves nothing in the bell or the outbox", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      for (const body of ["Secret one", "Secret two", "Secret three"]) await chat(a).send(id, body);
      const { failed } = await runJobs();
      expect(failed).toEqual([]);

      expect(expo.sent).toHaveLength(1);
      expect(pushedTo(b)).toEqual([{ to: tokenOf(b), title: "New message from Asha Rao", data: { type: "CHAT_MESSAGE", conversationId: id, tenantSlug: tenant.slug }, sound: "default", channelId: "default", ttl: CHAT_PUSH_TTL_SEC }]);
      expect(JSON.stringify([expo.sent, ctx.jobs.history])).not.toContain("Secret");

      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await request(ctx.app).get(`/api/v1/t/${tenant.slug}/notifications/unread-count`).set(b.headers)).body.data.count).toBe(0);
      expect(await ctx.db.select().from(outboundMessages)).toEqual([]);
    });

    it("goes out from the job that checked who may be told, with a short lifetime, not through the push.send queue", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      ctx.jobs.history.length = 0;
      await chat(a).send(id, "Hello");
      await runJobs();
      expect(pushedTo(b)).toEqual([expect.objectContaining({ ttl: CHAT_PUSH_TTL_SEC })]);
      expect(CHAT_PUSH_TTL_SEC).toBeLessThanOrEqual(3600);
      expect(ctx.jobs.history.filter((h) => h.name === "push.send")).toEqual([]);
    });

    it("retries a send Expo didn't take by checking everything again, so a member who signed out meanwhile gets nothing", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      expo.failNext(1);
      await chat(a).send(id, "Hello");
      // The first attempt fails, and gives up its claim on the quiet period so the retry can still tell them.
      await ctx.jobs.drain({ includeDelayed: true, maxJobs: 1 });
      expect(expo.sent).toEqual([]);
      expect(await ctx.redis.get(keys.chatPushQuiet(id, b.membership.id))).toBeNull();

      // Signing out on the phone removes its token before the retry runs.
      await request(ctx.app).delete(`/api/v1/me/push-tokens/${encodeURIComponent(tokenOf(b))}`).set(b.headers).expect((res) => expect(res.status).toBeLessThan(300));
      const { failed } = await runJobs();
      expect(failed).toEqual([]);
      expect(expo.sent).toEqual([]);
    });

    it("pushes once when a retry gets through", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      expo.failNext(1);
      await chat(a).send(id, "Hello");
      const { failed } = await runJobs();
      expect(failed).toEqual([]);
      expect(pushedTo(b)).toHaveLength(1);
    });

    it("lets everyone go again when looking up their devices fails before anything was sent, so the retry still tells them", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      // As a pool or lock timeout would, before the first batch.
      const lookup = vi.spyOn(ctx.push!, "prepareEach").mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"));
      try {
        await chat(a).send(id, "Hello");
        await ctx.jobs.drain({ includeDelayed: true, maxJobs: 1 });
        expect(expo.sent).toEqual([]);
        expect(await ctx.redis.get(keys.chatPushQuiet(id, b.membership.id))).toBeNull();
        const { failed } = await runJobs();
        expect(failed).toEqual([]);
        expect(pushedTo(b)).toHaveLength(1);
      } finally {
        lookup.mockRestore();
      }
    });

    it("gives up after its attempts, leaving the next message free to push", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      expo.failNext(3);
      await chat(a).send(id, "Hello");
      const { failed } = await runJobs();
      expect(failed.map((f) => f.name)).toEqual(["chat.pushConversation"]);
      expect(expo.sent).toEqual([]);
      await chat(a).send(id, "Again");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
    });

    it("still pushes once when a burst spans buckets, because the quiet key holds for later jobs", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "First");
      const ids = { tenantId: tenant.id, conversationId: id };
      const now = Date.now();
      for (const later of [1, 2, 3]) await queueConversationPush(ctx, ids, DIRECT_PUSH_WINDOW, now + later * DIRECT_PUSH_WINDOW.windowMs);
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
    });

    it("queues with the bucket in the id, delayed to the end of the next bucket, whatever the delay's length does on the memory queue", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      ctx.jobs.history.length = 0;
      const before = Date.now();
      await chat(a).send(id, "Timed");
      const after = Date.now();
      const job = ctx.jobs.history.find((h) => h.name === "chat.pushConversation")!;
      expect(job.data).toEqual({ tenantId: tenant.id, conversationId: id, quietSec: 120 });
      const { windowMs } = DIRECT_PUSH_WINDOW;
      const [, bucket] = /^chatpush-[0-9a-f-]+-(\d+)$/.exec(job.opts!.jobId!)!;
      const runsAt = (Number(bucket) + 2) * windowMs;
      expect(job.opts!.delayMs!).toBeGreaterThanOrEqual(runsAt - after);
      expect(job.opts!.delayMs!).toBeLessThanOrEqual(runsAt - before);
      // More than a whole window, so a message sent as a bucket ends can still be read first.
      expect(job.opts!.delayMs!).toBeGreaterThan(windowMs);
      expect(job.opts!.delayMs!).toBeLessThanOrEqual(2 * windowMs);
    });

    it("takes its window as a parameter, which sets the bucket, the delay and the quiet period", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      ctx.jobs.history.length = 0;
      const window = { windowMs: 30_000, quietSec: 600 };
      const now = 1_800_000_012_345;
      await queueConversationPush(ctx, { tenantId: tenant.id, conversationId: id }, window, now);
      const [job] = ctx.jobs.history;
      expect(job!.data).toMatchObject({ quietSec: 600 });
      expect(job!.opts).toEqual({ jobId: `chatpush-${id}-${Math.floor(now / 30_000)}`, delayMs: 47_655 });
    });

    it("runs only one job per conversation in a bucket, and one each for the next bucket", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      ctx.jobs.history.length = 0;
      const ids = { tenantId: tenant.id, conversationId: id };
      const t = 1_800_000_000_000;
      await queueConversationPush(ctx, ids, DIRECT_PUSH_WINDOW, t);
      await queueConversationPush(ctx, ids, DIRECT_PUSH_WINDOW, t + 4_999);
      expect(ctx.jobs.peek("chat.pushConversation")).toHaveLength(1);
      await queueConversationPush(ctx, ids, DIRECT_PUSH_WINDOW, t + 5_000);
      expect(ctx.jobs.peek("chat.pushConversation")).toHaveLength(2);
    });

    it("pushes nobody when it's read before the job runs", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      const sent = await chat(a).send(id, "Read straight away");
      await chat(b).read(id, (sent.body.data as ChatMessageDto).seq);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("stays quiet for 120 seconds, and reading or replying ends that early", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      const quietKey = keys.chatPushQuiet(id, b.membership.id);

      await chat(a).send(id, "One");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
      expect(await ctx.redis.ttl(quietKey)).toBeGreaterThan(100);
      expect(await ctx.redis.ttl(quietKey)).toBeLessThanOrEqual(120);

      // Still unread, so another message says nothing new.
      await chat(a).send(id, "Two");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);

      // Reading deletes the key, so the next message is news.
      const three = await chat(a).send(id, "Three");
      await runJobs();
      await chat(b).read(id, (three.body.data as ChatMessageDto).seq);
      expect(await ctx.redis.get(quietKey)).toBeNull();
      await chat(a).send(id, "Four");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(2);

      // A reply reads the thread too.
      await chat(b).send(id, "Five, from the other side");
      expect(await ctx.redis.get(quietKey)).toBeNull();
      await runJobs();
      await chat(a).send(id, "Six");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(3);
    });

    it("pushes again once the quiet period has passed", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "One");
      await runJobs();
      await ctx.redis.del(keys.chatPushQuiet(id, b.membership.id));
      await chat(a).send(id, "Two");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(2);
    });

    it("never goes to the sender, on any of their devices", async () => {
      const { tenant, a, b, chat } = await setup();
      await upsertPushToken(ctx.db, { userId: a.user.id, token: "ExponentPushToken[a-second]", platform: "IOS" });
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Mine");
      await runJobs();
      expect(expo.sent.map((p) => p.to)).toEqual([tokenOf(b)]);
    });

    it("reaches every device of the recipient", async () => {
      const { tenant, a, b, chat } = await setup();
      await upsertPushToken(ctx.db, { userId: b.user.id, token: "ExponentPushToken[b-second]", platform: "IOS" });
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Hello");
      await runJobs();
      expect(expo.sent.map((p) => p.to).sort()).toEqual([tokenOf(b), "ExponentPushToken[b-second]"].sort());
    });

    it("is dropped when a thread has gone back to being a request", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Sent while accepted");
      await runInTransaction(ctx, async (tx) => {
        const { updateConversation } = await import("../../src/repositories/chat.repo");
        await updateConversation(tx, id, { directState: "PENDING", requesterMembershipId: a.membership.id });
      });
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("says so without a name when the sender has gone", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Goodbye");
      await request(ctx.app).post("/api/v1/me/delete").set(a.headers).send({ confirm: true }).expect((res) => expect(res.status).toBeLessThan(300));
      await runJobs();
      expect(pushedTo(b).map((p) => p.title)).toEqual(["New message"]);
    });
  });

  describe("what a recipient chose", () => {
    it("respects a mute until it runs out", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(b).mute(id, new Date(Date.now() + 3_600_000).toISOString());
      await chat(a).send(id, "Muted");
      await runJobs();
      expect(expo.sent).toEqual([]);

      await chat(b).mute(id, new Date(Date.now() - 1_000).toISOString());
      await chat(a).send(id, "The mute ran out");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
    });

    it("respects the CHAT preference as it is when the job runs, not as it was when the message was sent", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      const prefs = (level: string) => request(ctx.app).patch(`/api/v1/t/${tenant.slug}/notification-prefs`).set(b.headers).send({ categories: { CHAT: level } }).expect(200);

      await chat(a).send(id, "One");
      await prefs("IN_APP");
      await runJobs();
      expect(expo.sent).toEqual([]);

      await chat(a).send(id, "Two");
      await prefs("IN_APP_PUSH");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
    });

    it("applies the preference and the mute to requests and answers too", async () => {
      const { tenant, a, b, chat } = await setup();
      await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/notification-prefs`).set(b.headers).send({ categories: { CHAT: "IN_APP" } }).expect(200);
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await runJobs();
      expect(expo.sent).toEqual([]);

      await chat(a).mute(conversation.id, new Date(Date.now() + 3_600_000).toISOString());
      await chat(b).accept(conversation.id);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });
  });

  describe("who may be told", () => {
    it("gives a suspended recipient nothing, for what was queued before they were suspended too", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Queued before");
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("gives a recipient who has become a current pupil nothing", async () => {
      const { tenant, a, b, chat } = await setup({ type: "SCHOOL", features: { messaging: true } });
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Queued before");
      await ctx.db.update(memberships).set({ batchYear: new Date().getFullYear() + 2 }).where(eq(memberships.id, b.membership.id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("gives a suspended or pupil recipient no request either", async () => {
      const { tenant, a, b } = await setup({ type: "SCHOOL", features: { messaging: true } });
      await openRequest(ctx, tenant.slug, a, b.membership.id);
      await ctx.db.update(memberships).set({ batchYear: new Date().getFullYear() + 2 }).where(eq(memberships.id, b.membership.id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("drops delayed jobs once the institution is suspended", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Queued before");
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("reads the switch fresh: messaging off stops what was queued, even with the tenant cached as on", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Queued before");
      // Not through the settings service, so the cached copy still says it's on.
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await runJobs();
      expect(expo.sent).toEqual([]);

      await ctx.db.update(tenantSettings).set({ features: { messaging: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
    });

    it("says nothing about a blocked member's messages, which look normal to them", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(b).block(a.membership.id);
      ctx.jobs.history.length = 0;
      const sent = await chat(a).send(id, "Withheld");
      expect(sent.status).toBe(201);
      await runJobs();
      expect(expo.sent).toEqual([]);
      // Nor does it queue anything to give the block away by its timing.
      expect(ctx.jobs.history.filter((h) => h.name.startsWith("chat."))).toEqual([]);
    });

    it("drops a job queued before a block, and one about messages that were withheld", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await chat(a).send(id, "Sent before the block");
      await chat(b).block(a.membership.id);
      await chat(a).send(id, "Withheld");
      await runJobs();
      expect(expo.sent).toEqual([]);

      // Unblocking marks all of it read, so nothing that was withheld can reach them later.
      await chat(b).unblock(a.membership.id);
      await queueConversationPush(ctx, { tenantId: tenant.id, conversationId: id });
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("doesn't count a withheld message as news, even with nothing else holding it back", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(b).read(id, 1);
      await chat(b).block(a.membership.id);
      await chat(a).send(id, "Withheld");
      await start();
      await ctx.db.delete(chatBlocks);
      await ctx.db.update(chatParticipants).set({ frozenSortAt: null }).where(eq(chatParticipants.conversationId, id));
      await queueConversationPush(ctx, { tenantId: tenant.id, conversationId: id });
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("says nothing when the only unread message has been removed", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(b).read(id, 1);
      await start();
      const sent = await chat(a).send(id, "Removed in time");
      await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, (sent.body.data as ChatMessageDto).id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("runs without a push channel configured", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      ctx.push = undefined;
      await chat(a).send(id, "Nowhere to go");
      const { failed } = await runJobs();
      expect(failed).toEqual([]);
    });
  });

  describe("a request", () => {
    it("says only that a request came, with no name and no words, and goes straight out rather than after a window", async () => {
      const { tenant, a, b } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "A stranger's secret");
      expect(ctx.jobs.peek("chat.pushConversation")).toEqual([]);
      expect(ctx.jobs.history.find((h) => h.name === "chat.pushEvent")!.opts).toBeUndefined();
      await ctx.jobs.drain();

      expect(expo.sent).toEqual([{ to: tokenOf(b), title: "New message request", data: { type: "CHAT_REQUEST", conversationId: conversation.id, tenantSlug: tenant.slug }, sound: "default", channelId: "default", ttl: CHAT_PUSH_TTL_SEC }]);
      expect(JSON.stringify([expo.sent, ctx.jobs.history])).not.toContain("Asha");
      expect(JSON.stringify([expo.sent, ctx.jobs.history])).not.toContain("secret");
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });

    it("sends nothing to someone who has already blocked the requester, whose first message is withheld", async () => {
      const { tenant, a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      await openRequest(ctx, tenant.slug, a, b.membership.id);
      expect(ctx.jobs.history.filter((h) => h.name.startsWith("chat."))).toEqual([]);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("drops the push when the recipient declined or blocked before it went", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await chat(b).decline(conversation.id);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("sends the requester nothing when it's declined, which must stay silent", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await start();
      await chat(b).decline(conversation.id);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });
  });

  describe("an answer", () => {
    it("tells the requester who accepted, and not the one who did", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await start();
      await chat(b).accept(conversation.id);
      await runJobs();
      expect(expo.sent).toEqual([{ to: tokenOf(a), title: "Bilal Khan accepted your message request", data: { type: "CHAT_ACCEPTED", conversationId: conversation.id, tenantSlug: tenant.slug }, sound: "default", channelId: "default", ttl: CHAT_PUSH_TTL_SEC }]);
    });

    it("sends one push when replying accepts, and that's the message", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await start();
      await chat(b).send(conversation.id, "Replying accepts it");
      await runJobs();
      expect(pushedTo(a).map((p) => p.data.type)).toEqual(["CHAT_MESSAGE"]);
      expect(pushedTo(b)).toEqual([]);
    });

    it("tells someone who asked and then blocked nothing", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await start();
      await chat(a).block(b.membership.id);
      await chat(b).accept(conversation.id);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });
  });

  it("drops an answer's push when the requester blocks the one who answered before it goes", async () => {
    const { tenant, a, b, chat } = await setup();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    await start();
    await chat(b).accept(conversation.id);
    await chat(a).block(b.membership.id);
    await runJobs();
    expect(expo.sent).toEqual([]);
  });

  describe("a chat opened from a mentorship or referral", () => {
    const open = (tenantId: string, a: Session, b: Session, extra: Partial<Parameters<typeof openDirectFromOrigin>[2]> = {}) =>
      runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: ORIGIN_ID, ...extra }));

    it("tells both members, with each other's names, when it creates the thread", async () => {
      const { tenant, a, b } = await setup();
      const { conversationId } = await open(tenant.id, a, b);
      await runJobs();
      expect(pushedTo(a).map((p) => [p.title, p.data])).toEqual([["You can now message Bilal Khan", { type: "CHAT_OPENED", conversationId, tenantSlug: tenant.slug }]]);
      expect(pushedTo(b).map((p) => p.title)).toEqual(["You can now message Asha Rao"]);
    });

    it("doesn't tell the member who just agreed, and its first message isn't a second push", async () => {
      const { tenant, a, b } = await setup();
      await open(tenant.id, a, b, { actorMembershipId: b.membership.id, seedMessage: { senderMembershipId: a.membership.id, body: "My note" } });
      await runJobs();
      expect(expo.sent.map((p) => [p.to, p.data.type])).toEqual([[tokenOf(a), "CHAT_OPENED"]]);
      expect(JSON.stringify(expo.sent)).not.toContain("My note");
    });

    it("tells them when it opens a request that was waiting", async () => {
      const { tenant, a, b } = await setup();
      await openRequest(ctx, tenant.slug, a, b.membership.id);
      await start();
      await open(tenant.id, a, b, { actorMembershipId: b.membership.id });
      await runJobs();
      expect(expo.sent.map((p) => [p.to, p.data.type])).toEqual([[tokenOf(a), "CHAT_OPENED"]]);
    });

    it("says nothing about opening a thread that was already open, where its note is an ordinary message", async () => {
      const { tenant, a, b } = await setup();
      await acceptedThread(ctx, tenant.slug, a, b);
      await start();
      await open(tenant.id, a, b, { actorMembershipId: b.membership.id, seedMessage: { senderMembershipId: a.membership.id, body: "A note" } });
      await runJobs();
      expect(expo.sent.map((p) => [p.to, p.data.type])).toEqual([[tokenOf(b), "CHAT_MESSAGE"]]);
    });

    it("closing one tells nobody", async () => {
      const { tenant, a, b } = await setup();
      const { conversationId } = await open(tenant.id, a, b);
      await start();
      await runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId: tenant.id, conversationId, hasOtherLiveConnection: false }));
      await runJobs();
      expect(expo.sent).toEqual([]);
      expect((await conversationRow(ctx, conversationId)).directState).toBe("CLOSED");
    });
  });

  describe("a group's messages", () => {
    /** An open group Asha owns, with Bilal and Chitra in it, all with phones. */
    async function groupRoom(options: Parameters<typeof createTenant>[1] = {}) {
      const s = await setup(options);
      const c = await memberSession(ctx, s.tenant.id, { fullName: "Chitra Iyer" });
      await upsertPushToken(ctx.db, { userId: c.user.id, token: tokenOf(c), platform: "ANDROID" });
      const group = await createGroup(ctx, s.tenant.slug, s.a, { name: "Weekend runners" });
      for (const m of [s.b, c]) await groupsApi(ctx, s.tenant.slug, m).join(group.id);
      return { ...s, c, group };
    }
    /** As the admin page does it: an approval says which name and description it approves. */
    const moderate = async (slug: string, admin: Session, id: string, action: string) => {
      const [g] = await ctx.db.select().from(chatGroups).where(eq(chatGroups.conversationId, id));
      const reviewed = action === "approve" ? { reviewed: { name: g!.name, description: g!.description } } : {};
      const res = await request(ctx.app).post(`/api/v1/t/${slug}/admin/moderation/GROUP/${id}/${action}`).set(admin.headers).send(reviewed);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    };

    it("bunch up over 30 seconds into one push each, titled with the group's approved name, with nobody's name or words", async () => {
      const { tenant, a, b, c, chat, group } = await groupRoom();
      await start();
      ctx.jobs.history.length = 0;
      const before = Date.now();
      for (const body of ["Secret one", "Secret two", "Secret three"]) await chat(a).send(group.id, body);
      const after = Date.now();

      const job = ctx.jobs.history.find((h) => h.name === "chat.pushConversation")!;
      expect(job.data).toEqual({ tenantId: tenant.id, conversationId: group.id, quietSec: GROUP_PUSH_WINDOW.quietSec });
      expect(GROUP_PUSH_WINDOW).toEqual({ windowMs: 30_000, quietSec: 600 });
      const [, bucket] = /^chatpush-[0-9a-f-]+-(\d+)$/.exec(job.opts!.jobId!)!;
      const runsAt = (Number(bucket) + 2) * 30_000;
      expect(job.opts!.delayMs!).toBeGreaterThanOrEqual(runsAt - after);
      expect(job.opts!.delayMs!).toBeLessThanOrEqual(runsAt - before);
      expect(job.opts!.delayMs!).toBeGreaterThan(30_000);
      expect(ctx.jobs.peek("chat.pushConversation")).toHaveLength(1);

      await runJobs();
      expect(pushedTo(a)).toEqual([]);
      for (const m of [b, c]) {
        expect(pushedTo(m)).toEqual([{ to: tokenOf(m), title: "New message in Weekend runners", data: { type: "CHAT_MESSAGE", conversationId: group.id, tenantSlug: tenant.slug }, sound: "default", channelId: "default", ttl: CHAT_PUSH_TTL_SEC }]);
      }
      expect(JSON.stringify([expo.sent, ctx.jobs.history])).not.toContain("Secret");
      expect(JSON.stringify(expo.sent)).not.toContain("Asha");
    });

    it("stay quiet for 600 seconds towards a member who hasn't read them, and reading ends that early", async () => {
      const { a, b, chat, group } = await groupRoom();
      await start();
      const quietKey = keys.chatPushQuiet(group.id, b.membership.id);
      await chat(a).send(group.id, "One");
      await runJobs();
      expect(await ctx.redis.ttl(quietKey)).toBeGreaterThan(500);
      expect(await ctx.redis.ttl(quietKey)).toBeLessThanOrEqual(600);
      const two = await chat(a).send(group.id, "Two");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(1);
      await chat(b).read(group.id, (two.body.data as ChatMessageDto).seq);
      expect(await ctx.redis.get(quietKey)).toBeNull();
      await chat(a).send(group.id, "Three");
      await runJobs();
      expect(pushedTo(b)).toHaveLength(2);
    });

    it("never use a name still waiting for review", async () => {
      const { tenant, a, b, chat } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const group = await createGroup(ctx, tenant.slug, a, { name: "Weekend runners" });
      await moderate(tenant.slug, admin, group.id, "approve");
      await groupsApi(ctx, tenant.slug, b).join(group.id);
      await groupsApi(ctx, tenant.slug, a).edit(group.id, { name: "Unreviewed name" });
      await start();
      await chat(a).send(group.id, "Hello");
      await runJobs();
      expect(pushedTo(b).map((p) => p.title)).toEqual(["New message in Weekend runners"]);
      expect(JSON.stringify(expo.sent)).not.toContain("Unreviewed");
    });

    it("say nothing to a member who blocked the sender, about a system line, or once moderation has hidden the group", async () => {
      const { tenant, a, b, c, chat, group } = await groupRoom();
      await chat(c).block(a.membership.id);
      await start();
      await chat(a).send(group.id, "Blocked by Chitra");
      await runJobs();
      expect(expo.sent.map((p) => p.to)).toEqual([tokenOf(b)]);

      // A member joining is a line in the thread, not news.
      ctx.jobs.history.length = 0;
      await groupsApi(ctx, tenant.slug, await memberSession(ctx, tenant.id)).join(group.id);
      expect(ctx.jobs.history.filter((h) => h.name.startsWith("chat."))).toEqual([]);

      await chat(b).read(group.id, 99);
      await start();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      await chat(a).send(group.id, "Queued before the removal");
      await moderate(tenant.slug, admin, group.id, "remove");
      await runJobs();
      // Its owner hears of the removal as a notice, which is no chat push.
      expect(expo.sent.map((p) => p.data.type)).toEqual(["CONTENT_REMOVED"]);
    });

    it("reach nobody twice when a later batch fails and the job is retried, and reach everyone it missed", async () => {
      const { tenant, a, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, a, { name: "Big room" });
      const count = PUSH_BATCH_SIZE + 5;
      const users = await ctx.db
        .insert(usersTable)
        .values(Array.from({ length: count }, (_, i) => ({ phoneE164: `+9177${String(i).padStart(8, "0")}`, phoneRegion: "IN" })))
        .returning({ id: usersTable.id });
      const members = await ctx.db
        .insert(memberships)
        .values(users.map((u, i) => ({ tenantId: tenant.id, userId: u.id, status: "APPROVED" as const, role: "MEMBER" as const, fullName: `Runner ${i}`, startYear: 2006, batchYear: 2010, professionType: "EMPLOYED" as const, statusChangedAt: new Date() })))
        .returning({ id: memberships.id });
      await ctx.db.insert(pushTokens).values(users.map((u) => ({ userId: u.id, token: `ExponentPushToken[${u.id}]`, platform: "ANDROID" as const })));
      await ctx.db.insert(chatParticipants).values(members.map((m) => ({ conversationId: group.id, membershipId: m.id, tenantId: tenant.id, state: "ACTIVE" as const, role: "MEMBER" as const, joinedAt: new Date() })));
      await ctx.db.update(chatGroups).set({ memberCount: count + 1 }).where(eq(chatGroups.conversationId, group.id));
      await start();

      // The first batch goes, the second fails, and the job runs again.
      expo.failRequest(2);
      await chat(a).send(group.id, "Everyone, once");
      const { failed } = await runJobs();
      expect(failed).toEqual([]);
      const perToken = new Map<string, number>();
      for (const p of expo.sent) perToken.set(p.to, (perToken.get(p.to) ?? 0) + 1);
      expect(perToken.size).toBe(count);
      expect([...perToken.values()].every((n) => n === 1)).toBe(true);
    });
  });

  describe("a group invitation", () => {
    async function invited(visibility: "OPEN" | "INVITE_ONLY" = "INVITE_ONLY") {
      const s = await setup();
      const group = await createGroup(ctx, s.tenant.slug, s.a, { name: "Reunion committee", visibility });
      const groups = (m: Session) => groupsApi(ctx, s.tenant.slug, m);
      return { ...s, group, groups };
    }

    it("says only that they were invited, naming neither the group nor who asked, goes straight out, and opens Invitations", async () => {
      const { tenant, b, group, groups, a } = await invited();
      await start();
      ctx.jobs.history.length = 0;
      expect((await groups(a).invite(group.id, [b.membership.id])).status).toBe(201);
      const job = ctx.jobs.history.find((h) => h.name === "chat.pushGroupInvite")!;
      expect(job.data).toEqual({ tenantId: tenant.id, conversationId: group.id, inviteeMembershipIds: [b.membership.id] });
      expect(job.opts).toBeUndefined();
      await ctx.jobs.drain();

      expect(expo.sent).toEqual([{ to: tokenOf(b), title: "You've been invited to a group", data: { type: "CHAT_GROUP_INVITE", conversationId: group.id, tenantSlug: tenant.slug }, sound: "default", channelId: "default", ttl: CHAT_PUSH_TTL_SEC }]);
      expect(JSON.stringify([expo.sent, ctx.jobs.history])).not.toMatch(/Asha|Reunion/);
      expect(notificationTarget("CHAT_GROUP_INVITE", expo.sent[0]!.data)).toEqual({ kind: "chatGroup", view: "invitations" });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });

    it("is queued for an invitation held back by a block or a decline just as for any other, and pushes nothing for it", async () => {
      const { tenant, a, b, group, groups, chat } = await invited();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      for (const m of [c, d]) await upsertPushToken(ctx.db, { userId: m.user.id, token: tokenOf(m), platform: "IOS" });
      await chat(b).block(a.membership.id);
      const earlier = await createGroup(ctx, tenant.slug, a, { name: "Earlier room", visibility: "INVITE_ONLY" });
      await groups(a).invite(earlier.id, [c.membership.id]);
      await groups(c).decline(earlier.id);
      await start();
      ctx.jobs.history.length = 0;

      // The same answer, and the same job, whether the invitation reaches its invitee or not: nothing the inviter could
      // time or see sets the two apart.
      const answers = [];
      for (const m of [b, c, d]) answers.push((await groups(a).invite(group.id, [m.membership.id])).body);
      expect(answers[0]).toEqual(answers[2]);
      expect(answers[1]).toEqual(answers[2]);
      expect(ctx.jobs.history.filter((h) => h.name.startsWith("chat.")).map((h) => [h.name, (h.data as { inviteeMembershipIds: string[] }).inviteeMembershipIds])).toEqual([
        ["chat.pushGroupInvite", [b.membership.id]],
        ["chat.pushGroupInvite", [c.membership.id]],
        ["chat.pushGroupInvite", [d.membership.id]],
      ]);
      await runJobs();
      expect(expo.sent.map((p) => p.to)).toEqual([tokenOf(d)]);
    });

    it("says nothing once it's been declined, answered, hidden by a block, or its group archived before the job runs", async () => {
      const { tenant, a, b, group, groups, chat } = await invited("OPEN");
      const more = await Promise.all([1, 2, 3].map(() => memberSession(ctx, tenant.id)));
      for (const m of more) await upsertPushToken(ctx.db, { userId: m.user.id, token: tokenOf(m), platform: "IOS" });
      const [declines, accepts, blocks] = more as [Session, Session, Session];
      await start();
      await groups(a).invite(group.id, [b.membership.id, declines.membership.id, accepts.membership.id, blocks.membership.id]);
      await groups(declines).decline(group.id);
      await groups(accepts).accept(group.id);
      await chat(blocks).block(a.membership.id);
      await runJobs();
      expect(expo.sent.map((p) => p.to)).toEqual([tokenOf(b)]);

      const other = await createGroup(ctx, tenant.slug, a, { name: "Archived soon" });
      await start();
      await groups(a).invite(other.id, [b.membership.id]);
      await groups(a).archive(other.id);
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("respects the CHAT preference, and drops once the institution is suspended", async () => {
      const { tenant, a, b, group, groups } = await invited();
      await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/notification-prefs`).set(b.headers).send({ categories: { CHAT: "IN_APP" } }).expect(200);
      await start();
      await groups(a).invite(group.id, [b.membership.id]);
      await runJobs();
      expect(expo.sent).toEqual([]);

      const c = await memberSession(ctx, tenant.id);
      await upsertPushToken(ctx.db, { userId: c.user.id, token: tokenOf(c), platform: "IOS" });
      await groups(a).invite(group.id, [c.membership.id]);
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      await runJobs();
      expect(expo.sent).toEqual([]);
    });

    it("lets its invitees go again when looking up their devices fails, so the retry still tells them", async () => {
      const { a, b, group, groups } = await invited();
      await start();
      const lookup = vi.spyOn(ctx.push!, "prepareEach").mockRejectedValueOnce(new Error("Query read timeout"));
      try {
        await groups(a).invite(group.id, [b.membership.id]);
        const { failed } = await runJobs();
        expect(failed).toEqual([]);
        expect(pushedTo(b)).toHaveLength(1);
      } finally {
        lookup.mockRestore();
      }
    });

    it("pushes each invitation once, even when its job is retried or runs again", async () => {
      const { tenant, a, b, group, groups } = await invited();
      const c = await memberSession(ctx, tenant.id);
      await upsertPushToken(ctx.db, { userId: c.user.id, token: tokenOf(c), platform: "IOS" });
      await start();
      expo.failNext(1);
      ctx.jobs.history.length = 0;
      await groups(a).invite(group.id, [b.membership.id, c.membership.id]);
      const { failed } = await runJobs();
      expect(failed).toEqual([]);
      expect(expo.sent.map((p) => p.to).sort()).toEqual([tokenOf(b), tokenOf(c)].sort());

      // The same job again, as a worker that stalled after sending might run it: the invitations were told already.
      const job = ctx.jobs.history.find((h) => h.name === "chat.pushGroupInvite")!;
      await ctx.jobs.enqueue("chat.pushGroupInvite", job.data as { tenantId: string; conversationId: string; inviteeMembershipIds: string[] });
      await runJobs();
      expect(expo.sent).toHaveLength(2);
    });
  });

  it("gives every push a destination when it's tapped, through the routing both apps share", async () => {
    const { tenant, a, b, chat } = await setup();
    const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
    await runJobs();
    await chat(b).decline(conversation.id);
    await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: ORIGIN_ID }));
    await runJobs();
    await chat(a).send(conversation.id, "Hello");
    await runJobs();
    const other = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: other.user.id, token: tokenOf(other), platform: "IOS" });
    const second = await openRequest(ctx, tenant.slug, other, b.membership.id);
    await runJobs();
    await chat(b).accept(second.conversation.id);
    await runJobs();
    // From someone B hasn't declined: B's decline of A's request keeps A's invitations away from B.
    const room = await createGroup(ctx, tenant.slug, other, { name: "Room", visibility: "INVITE_ONLY" });
    await groupsApi(ctx, tenant.slug, other).invite(room.id, [b.membership.id]);
    await runJobs();

    expect(new Set(expo.sent.map((p) => p.data.type))).toEqual(new Set(CHAT_PUSH_KINDS));
    for (const push of expo.sent) {
      const target = push.data.type === "CHAT_GROUP_INVITE" ? { kind: "chatGroup", view: "invitations" } : { kind: "chat", conversationId: push.data.conversationId };
      expect(notificationTarget(String(push.data.type), push.data)).toEqual(target);
    }
  });
});
