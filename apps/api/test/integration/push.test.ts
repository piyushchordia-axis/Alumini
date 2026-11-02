import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { insertNotifications } from "../../src/repositories/notifications.repo";
import { listPushTokensForUsers, upsertPushToken } from "../../src/repositories/users.repo";
import { ExpoPushChannel, RECEIPT_DELAY_MS } from "../../src/services/notifications/ExpoPushChannel";
import { createMembership, createTenant, createUser } from "../helpers/factories";
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

  it("runs the receipt check as a scheduled job", async () => {
    const expo = fakeExpo({ ticket: () => ({ status: "ok", id: "t" }) });
    ctx.push = new ExpoPushChannel(ctx.db, ctx.redis, ctx.logger, undefined, expo.impl);
    await expect(ctx.jobs.runScheduled("push-receipts")).resolves.toBeUndefined();
    ctx.push = undefined;
  });
});
