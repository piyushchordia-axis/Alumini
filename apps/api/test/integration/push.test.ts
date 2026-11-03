import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertNotifications } from "../../src/repositories/notifications.repo";
import { listPushTokensForUsers, upsertPushToken } from "../../src/repositories/users.repo";
import { ExpoPushChannel, RECEIPT_DELAY_MS } from "../../src/services/notifications/ExpoPushChannel";
import { createMembership, createTenant, createUser, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

interface SentMessage {
  to: string;
  title?: string;
  body?: string;
  data: Record<string, unknown>;
}

/**
 * Fake Expo push API. `send` answers one ticket per message (ticket id "t:<token>"); `receipts` answers from the
 * given map. Every request body is recorded.
 */
function fakeExpo(opts: { ticket: (token: string) => object; receipts?: (ids: string[]) => Record<string, object> }) {
  const sends: SentMessage[][] = [];
  const receiptRequests: string[][] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    let data: unknown;
    if (String(url).endsWith("/push/send")) {
      sends.push(body);
      data = (body as SentMessage[]).map((m) => opts.ticket(m.to));
    } else {
      receiptRequests.push(body.ids);
      data = opts.receipts?.(body.ids) ?? {};
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { sends, receiptRequests, impl };
}

const ALIVE = "ExponentPushToken[alive]";
const GONE = "ExponentPushToken[gone]";

describe.skipIf(!dbAvailable)("Expo push channel", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    await ctx.redis.flushdb();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function setup() {
    const { tenant } = await createTenant(ctx, { slug: "push-college" });
    const user = await createUser(ctx);
    const membership = await createMembership(ctx, tenant.id, user.id);
    await upsertPushToken(ctx.db, { userId: user.id, token: ALIVE, platform: "ANDROID" });
    await upsertPushToken(ctx.db, { userId: user.id, token: GONE, platform: "IOS" });
    const [row] = await insertNotifications(ctx.db, [{ tenantId: tenant.id, recipientMembershipId: membership.id, type: "POST_COMMENT", title: "New comment", body: "Hi", data: { postId: "p1" } }]);
    const recipients = [{ membershipId: membership.id, userId: user.id }];
    return { user, row: row!, recipients, membership, tenantId: tenant.id };
  }

  it("keeps an admin's note on a removed message in the app: the push carries the fixed title and no body", async () => {
    const { row, recipients, membership, tenantId } = await setup();
    const [removed] = await insertNotifications(ctx.db, [{ tenantId, recipientMembershipId: membership.id, type: "CHAT_MESSAGE_REMOVED", title: "A message you sent was removed", body: "An admin's note", data: { conversationId: "c1", messageId: "m1" } }]);
    const expo = fakeExpo({ ticket: (t) => ({ status: "ok", id: `t:${t}` }) });
    const channel = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);

    await channel.deliver([removed!, row], recipients, { tenantSlug: "push-college" });
    const sent = expo.sends.flat();
    const push = sent.find((m) => m.data.type === "CHAT_MESSAGE_REMOVED")!;
    expect(push.title).toBe("A message you sent was removed");
    expect(push.body).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain("An admin's note");
    // Everything else keeps its body.
    expect(sent.find((m) => m.data.type === "POST_COMMENT")!.body).toBe("Hi");
  });

  it("prepareFor builds a message per device of each user, with no stored notification behind it", async () => {
    const { user } = await setup();
    const other = await createUser(ctx);
    await upsertPushToken(ctx.db, { userId: other.id, token: "not-an-expo-token", platform: "ANDROID" });
    const channel = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, fakeExpo({ ticket: () => ({ status: "ok" }) }).impl);

    const items = [
      { userId: user.id, title: "New message from Asha", data: { type: "CHAT_MESSAGE", conversationId: "c1" } },
      { userId: other.id, title: "New message request", data: { type: "CHAT_REQUEST", conversationId: "c2" } },
    ];
    const messages = await channel.prepareFor(items, { tenantSlug: "push-college" });

    expect(messages.map((m) => m.to).sort()).toEqual([ALIVE, GONE].sort());
    for (const m of messages) {
      expect(m).toMatchObject({ title: "New message from Asha", data: { type: "CHAT_MESSAGE", conversationId: "c1", tenantSlug: "push-college" }, sound: "default", channelId: "default" });
      expect(m.body).toBeUndefined();
      expect(m.data).not.toHaveProperty("notificationId");
    }
    expect(await channel.prepareFor([], { tenantSlug: "push-college" })).toEqual([]);
  });

  it("sends the institution slug for tap routing and drops tokens Expo rejects at send time", async () => {
    const { user, row, recipients } = await setup();
    const expo = fakeExpo({ ticket: (t) => (t === GONE ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } } : { status: "ok", id: `t:${t}` }) });
    const channel = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);

    await channel.deliver([row], recipients, { tenantSlug: "push-college" });

    expect(expo.sends[0]).toHaveLength(2);
    expect(expo.sends[0]![0]!.data).toMatchObject({ postId: "p1", type: "POST_COMMENT", tenantSlug: "push-college", notificationId: row.id });
    expect((await listPushTokensForUsers(ctx.db, [user.id])).map((t) => t.token)).toEqual([ALIVE]);
  });

  it("checks receipts once they are due and removes devices that stopped receiving", async () => {
    const { user, row, recipients } = await setup();
    const expo = fakeExpo({
      ticket: (t) => ({ status: "ok", id: `t:${t}` }),
      receipts: (ids) => Object.fromEntries(ids.map((id) => [id, id === `t:${GONE}` ? { status: "error", details: { error: "DeviceNotRegistered" } } : { status: "ok" }])),
    });
    const channel = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);
    await channel.deliver([row], recipients, { tenantSlug: "push-college" });
    expect((await listPushTokensForUsers(ctx.db, [user.id])).map((t) => t.token).sort()).toEqual([ALIVE, GONE]);

    // Receipts are not published yet, so nothing is requested.
    expect(await channel.checkReceipts()).toEqual({ checked: 0, removedTokens: 0 });
    expect(expo.receiptRequests).toHaveLength(0);

    const later = Date.now() + RECEIPT_DELAY_MS + 1000;
    expect(await channel.checkReceipts(later)).toEqual({ checked: 2, removedTokens: 1 });
    expect(expo.receiptRequests[0]!.sort()).toEqual([`t:${ALIVE}`, `t:${GONE}`]);
    expect((await listPushTokensForUsers(ctx.db, [user.id])).map((t) => t.token)).toEqual([ALIVE]);

    // Processed receipts are not requested again.
    expect(await channel.checkReceipts(later)).toEqual({ checked: 0, removedTokens: 0 });
    expect(expo.receiptRequests).toHaveLength(1);
  });

  it("forgets every device of someone who signs out everywhere, so a lost phone stops showing their pushes", async () => {
    const { tenant } = await createTenant(ctx, { slug: "push-logout" });
    const member = await memberSession(ctx, tenant.id);
    const other = await memberSession(ctx, tenant.id);
    await upsertPushToken(ctx.db, { userId: member.user.id, token: ALIVE, platform: "ANDROID" });
    await upsertPushToken(ctx.db, { userId: member.user.id, token: GONE, platform: "IOS" });
    await upsertPushToken(ctx.db, { userId: other.user.id, token: "ExponentPushToken[other]", platform: "IOS" });

    await request(ctx.app).post("/api/v1/auth/logout-all").set(member.headers).expect(204);
    expect(await listPushTokensForUsers(ctx.db, [member.user.id])).toEqual([]);
    expect((await listPushTokensForUsers(ctx.db, [other.user.id])).map((t) => t.token)).toEqual(["ExponentPushToken[other]"]);
  });

  it("runs the receipt check as a scheduled job", async () => {
    const expo = fakeExpo({ ticket: () => ({ status: "ok", id: "t" }) });
    ctx.push = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);
    await expect(ctx.jobs.runScheduled("push-receipts")).resolves.toBeUndefined();
    ctx.push = undefined;
  });
});
