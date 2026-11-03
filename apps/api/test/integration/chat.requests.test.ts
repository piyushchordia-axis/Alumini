import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatConversations, chatMessages, notifications, tenantSettings } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { runInTransaction } from "../../src/lib/transaction";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { acceptedThread, ageRequest, bareMember, chatApi, comparable, comparableMessage, conversationRow, newKey, openRequest, participantRow, type Session } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("message requests", () => {
  let ctx: TestContext;
  let realtime: CapturingRealtime;
  beforeAll(async () => {
    realtime = new CapturingRealtime();
    ctx = await createTestContext({}, { realtime });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    realtime.clear();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function setup() {
    const { tenant } = await createTenant(ctx);
    const a = await memberSession(ctx, tenant.id);
    const b = await memberSession(ctx, tenant.id);
    const chat = (m: Session) => chatApi(ctx, tenant.slug, m);
    return { tenant, a, b, chat };
  }
  const ids = (res: { body: { data: ChatConversationDto[] } }) => res.body.data.map((t) => t.id);

  describe("the requester can't tell what became of their request", () => {
    /** Everything a requester can read about a thread, plus what a second send gets them. */
    async function requesterView(api: ReturnType<typeof chatApi>, id: string) {
      const [thread, list, messages, requests, badge, resend] = [await api.get(id), await api.list(), await api.messages(id), await api.list("REQUESTS"), await api.badge(), await api.send(id, "One more")];
      return {
        thread: thread.body.data as ChatConversationDto,
        listRow: (list.body.data as ChatConversationDto[]).find((t) => t.id === id),
        messages: messages.body.data as ChatMessageDto[],
        requests: requests.body.data,
        badge: badge.body.data,
        resend: { status: resend.status, error: resend.body.error },
      };
    }

    it("deep-equals across a request waiting and the same request declined", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hello");
      const pending = await requesterView(chat(a), conversation.id);
      expect(pending.thread).toMatchObject({ state: "REQUEST_SENT", canSend: false });
      expect(pending.resend).toMatchObject({ status: 409, error: { code: "CHAT_REQUEST_PENDING" } });

      expect((await chat(b).decline(conversation.id)).status).toBe(200);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect(await requesterView(chat(a), conversation.id)).toEqual(pending);
    });

    it("deep-equals across a request waiting and the same request after the recipient blocks them", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hello");
      const pending = await requesterView(chat(a), conversation.id);
      expect((await chat(b).block(a.membership.id)).status).toBe(201);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect(await requesterView(chat(a), conversation.id)).toEqual(pending);
    });

    it("deep-equals between a normal request and a first message to someone who already blocked them, apart from ids and times", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      await chat(d).block(c.membership.id);

      const normal = await chat(a).direct(b.membership.id, "The same words", "key-for-comparing-1");
      const blocked = await chat(c).direct(d.membership.id, "The same words", "key-for-comparing-2");
      expect(blocked.status).toBe(normal.status);
      expect(comparable(blocked.body.data.conversation)).toEqual(comparable(normal.body.data.conversation));
      expect(comparableMessage(blocked.body.data.message)).toEqual(comparableMessage(normal.body.data.message));
      expect(Object.keys(blocked.body.data.message).sort()).toEqual(Object.keys(normal.body.data.message).sort());
      expect(JSON.stringify(blocked.body)).not.toContain("withheld");

      const [normalView, blockedView] = [await requesterView(chat(a), normal.body.data.conversation.id), await requesterView(chat(c), blocked.body.data.conversation.id)];
      expect(comparable(blockedView.thread)).toEqual(comparable(normalView.thread));
      expect(comparable(blockedView.listRow!)).toEqual(comparable(normalView.listRow!));
      expect(blockedView.messages.map(comparableMessage)).toEqual(normalView.messages.map(comparableMessage));
      expect(blockedView.resend).toEqual(normalView.resend);
      expect(blockedView.badge).toEqual(normalView.badge);

      const row = await conversationRow(ctx, blocked.body.data.conversation.id);
      expect(row.directState).toBe("DECLINED");
      const [stored] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, row.id));
      expect(stored!.withheld).toBe(true);
    });

    it("deep-equals between asking again after a decline and the same after a block", async () => {
      const { tenant, chat } = await setup();
      const pair = async () => {
        const [from, to] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
        return { from, to, id: (await openRequest(ctx, tenant.slug, from, to.membership.id, "Asking")).conversation.id };
      };
      const declined = await pair();
      await chat(declined.to).decline(declined.id);
      const blocked = await pair();
      await chat(blocked.to).block(blocked.from.membership.id);
      for (const { id } of [declined, blocked]) await ageRequest(ctx, id, 31);

      const sent = [await chat(declined.from).send(declined.id, "Asking again", "key-for-comparing-1"), await chat(blocked.from).send(blocked.id, "Asking again", "key-for-comparing-2")];
      expect(sent[1]!.status).toBe(sent[0]!.status);
      expect(comparableMessage(sent[1]!.body.data)).toEqual(comparableMessage(sent[0]!.body.data));

      const [declinedView, blockedView] = [await requesterView(chat(declined.from), declined.id), await requesterView(chat(blocked.from), blocked.id)];
      expect(declinedView.thread).toMatchObject({ state: "REQUEST_SENT", canSend: false });
      expect(comparable(blockedView.thread)).toEqual(comparable(declinedView.thread));
      expect(comparable(blockedView.listRow!)).toEqual(comparable(declinedView.listRow!));
      expect(blockedView.messages.map(comparableMessage)).toEqual(declinedView.messages.map(comparableMessage));
      expect(blockedView.resend).toEqual(declinedView.resend);
      expect(blockedView.badge).toEqual(declinedView.badge);
    });

    it("deep-equals between asking again in a closed thread and the same with the other member blocking them", async () => {
      const { tenant, chat } = await setup();
      /** A thread a mentorship opened and ended long enough ago to ask again, with `from` and `to` as its members. */
      const closed = async () => {
        const [from, to] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
        const { conversationId: id } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: from.membership.id, bId: to.membership.id, origin: "MENTORSHIP", originId: from.membership.id, seedMessage: { senderMembershipId: to.membership.id, body: "A note" } }));
        await runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId: tenant.id, conversationId: id, hasOtherLiveConnection: false }));
        await ageRequest(ctx, id, 31);
        return { from, to, id };
      };
      const normal = await closed();
      const blocked = await closed();
      await chat(blocked.to).block(blocked.from.membership.id);

      const sent = [await chat(normal.from).send(normal.id, "The same words", "key-for-comparing-1"), await chat(blocked.from).send(blocked.id, "The same words", "key-for-comparing-2")];
      expect(sent[1]!.status).toBe(sent[0]!.status);
      expect(comparableMessage(sent[1]!.body.data)).toEqual(comparableMessage(sent[0]!.body.data));

      const [normalView, blockedView] = [await requesterView(chat(normal.from), normal.id), await requesterView(chat(blocked.from), blocked.id)];
      expect(normalView.thread).toMatchObject({ state: "REQUEST_SENT", canSend: false, origin: "MESSAGE_REQUEST" });
      expect(comparable(blockedView.thread)).toEqual(comparable(normalView.thread));
      expect(comparable(blockedView.listRow!)).toEqual(comparable(normalView.listRow!));
      expect(blockedView.messages.map(comparableMessage)).toEqual(normalView.messages.map(comparableMessage));
      expect(blockedView.requests).toEqual(normalView.requests);
      expect(blockedView.resend).toEqual(normalView.resend);
      expect(blockedView.badge).toEqual(normalView.badge);
    });

    it("deep-equals between replying to a request and the same with the requester blocking them", async () => {
      const { tenant, chat } = await setup();
      const pair = async () => {
        const [from, to] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
        return { from, to, id: (await openRequest(ctx, tenant.slug, from, to.membership.id, "Asking")).conversation.id };
      };
      const normal = await pair();
      const blocked = await pair();
      await chat(blocked.from).block(blocked.to.membership.id);

      const replied = [await chat(normal.to).send(normal.id, "The same reply", "key-for-comparing-1"), await chat(blocked.to).send(blocked.id, "The same reply", "key-for-comparing-2")];
      expect(comparableMessage(replied[1]!.body.data)).toEqual(comparableMessage(replied[0]!.body.data));
      const read = async (m: Session, id: string) => {
        const [thread, list, requests, messages, badge, accept, decline] = [await chat(m).get(id), await chat(m).list(), await chat(m).list("REQUESTS"), await chat(m).messages(id), await chat(m).badge(), await chat(m).accept(id), await chat(m).decline(id)];
        return {
          thread: comparable(thread.body.data),
          list: list.body.data.map(comparable),
          requests: requests.body.data,
          messages: messages.body.data.map(comparableMessage),
          badge: badge.body.data,
          accept: { status: accept.status, state: accept.body.data.state },
          decline: { status: decline.status, error: decline.body.error },
        };
      };
      const expected = await read(normal.to, normal.id);
      expect(expected.thread).toMatchObject({ state: "ACCEPTED", canSend: true });
      expect(expected.decline.status).toBe(409);
      expect(await read(blocked.to, blocked.id)).toEqual(expected);
      expect((await chat(blocked.to).send(blocked.id, "Another")).status).toBe((await chat(normal.to).send(normal.id, "Another")).status);
    });

    it("sends the requester's own devices the same echo either way, and tells the recipient only when not blocked", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      await chat(d).block(c.membership.id);
      realtime.clear();

      const normal = await chat(a).direct(b.membership.id, "Same", "key-for-comparing-1");
      const blocked = await chat(c).direct(d.membership.id, "Same", "key-for-comparing-2");
      const echo = (userId: string) => realtime.to(userId, "chat:message").map((e) => comparableMessage((e.payload as { message: ChatMessageDto }).message));
      expect(echo(c.user.id)).toEqual(echo(a.user.id));
      expect(echo(a.user.id)).toHaveLength(1);
      expect(realtime.to(b.user.id)).toEqual([expect.objectContaining({ event: "chat:changed", payload: { tenantSlug: tenant.slug, conversationId: normal.body.data.conversation.id } })]);
      expect(realtime.to(d.user.id)).toEqual([]);
      expect(blocked.status).toBe(201);
    });

    it("gets the same refusal from accept and decline however the request stands", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      const answers = async () => [await chat(a).accept(conversation.id), await chat(a).decline(conversation.id)].map((r) => ({ status: r.status, error: r.body.error }));
      const before = await answers();
      expect(before[0]).toMatchObject({ status: 409, error: { code: "CHAT_REQUEST_PENDING" } });
      await chat(b).decline(conversation.id);
      expect(await answers()).toEqual(before);
    });

    it("isn't told about a decline by any event or notification", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await ctx.jobs.drain();
      realtime.clear();
      await chat(b).decline(conversation.id);
      await ctx.jobs.drain();
      expect(realtime.to(a.user.id)).toEqual([]);
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });

    it("isn't told about a block by any event", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      realtime.clear();
      await chat(b).block(a.membership.id);
      await chat(b).unblock(a.membership.id);
      expect(realtime.to(a.user.id)).toEqual([]);
      expect(realtime.to(b.user.id).map((e) => e.event)).toContain("chat:changed");
      expect(id).toBeTruthy();
    });
  });

  describe("where a request shows", () => {
    it("is in the requester's main inbox and the recipient's requests, and the recipient's list has no body", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "A distinctive first line");
      expect(ids(await chat(a).list())).toEqual([conversation.id]);
      expect(ids(await chat(a).list("REQUESTS"))).toEqual([]);
      expect(ids(await chat(b).list())).toEqual([]);
      const requests = await chat(b).list("REQUESTS");
      expect(ids(requests)).toEqual([conversation.id]);
      expect(requests.body.data[0]).toMatchObject({ state: "REQUEST_RECEIVED", canSend: true, lastMessage: null, peer: { id: a.membership.id } });
      expect(JSON.stringify(requests.body)).not.toContain("distinctive");
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 1 });
      expect((await chat(a).badge()).body.data).toEqual({ unread: 0, requests: 0 });
    });

    it("lets the recipient read it when they open it", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "A distinctive first line");
      const thread = await chat(b).messages(conversation.id);
      expect(thread.body.data[0]).toMatchObject({ body: "A distinctive first line", clientKey: null, sender: { id: a.membership.id } });
    });

    it("tells the recipient something arrived, and never what it says", async () => {
      const { tenant, a, b } = await setup();
      realtime.clear();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "A distinctive first line");
      expect(realtime.to(b.user.id)).toEqual([expect.objectContaining({ event: "chat:changed", payload: { tenantSlug: tenant.slug, conversationId: conversation.id } })]);
      expect(JSON.stringify(realtime.to(b.user.id))).not.toContain("distinctive");
    });

    it("leaves every list and the badge once declined, and stays readable by id", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hello");
      const answered = await chat(b).decline(conversation.id);
      expect(answered.body.data).toMatchObject({ state: "REQUEST_DECLINED", canSend: true });
      expect(ids(await chat(b).list())).toEqual([]);
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([]);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0 });
      expect((await chat(b).get(conversation.id)).status).toBe(200);
      expect((await chat(b).decline(conversation.id)).status).toBe(200);
    });

    it("hides a request while its sender is suspended, and brings it back on reinstatement", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await ctx.db.execute(sql`update memberships set status = 'SUSPENDED' where id = ${a.membership.id}`);
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([]);
      expect((await chat(b).badge()).body.data.requests).toBe(0);
      await ctx.db.execute(sql`update memberships set status = 'APPROVED' where id = ${a.membership.id}`);
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([conversation.id]);
      expect((await chat(b).badge()).body.data.requests).toBe(1);
    });
  });

  describe("answering a request", () => {
    it("accepting opens the thread to both, and the requester hears about it", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      realtime.clear();
      const answered = await chat(b).accept(conversation.id);
      expect(answered.body.data).toMatchObject({ state: "ACCEPTED", canSend: true });
      expect(realtime.to(a.user.id).map((e) => e.event)).toEqual(["chat:changed"]);
      expect((await chat(a).get(conversation.id)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true, canRerequestAt: null });
      expect((await chat(a).send(conversation.id, "Thanks")).status).toBe(201);
      expect(ids(await chat(b).list())).toEqual([conversation.id]);
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([]);
      expect((await chat(b).accept(conversation.id)).status).toBe(200);
      expect((await chat(b).decline(conversation.id)).status).toBe(409);
    });

    it("can change a decline back to accepted", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await chat(b).decline(conversation.id);
      expect((await chat(b).accept(conversation.id)).body.data.state).toBe("ACCEPTED");
    });

    it("sending as the recipient of a pending request accepts it", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      realtime.clear();
      const reply = await chat(b).send(conversation.id, "Hi back");
      expect(reply.status).toBe(201);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("ACCEPTED");
      expect(realtime.to(a.user.id).map((e) => e.event).sort()).toEqual(["chat:changed", "chat:message"]);
      expect((realtime.to(a.user.id, "chat:message")[0]!.payload as { message: ChatMessageDto }).message).toMatchObject({ body: "Hi back", clientKey: null });
    });

    it("sending as the recipient of a declined request accepts it, including through POST /direct", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await chat(b).decline(conversation.id);
      const reply = await chat(b).direct(a.membership.id, "Changed my mind");
      expect(reply.status).toBe(201);
      expect(reply.body.data.conversation).toMatchObject({ id: conversation.id, state: "ACCEPTED" });
      expect(reply.body.data.message.seq).toBe(2);
    });

    it("a blocked recipient's reply accepts as far as they can tell, and reaches only their own devices", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hello");
      await chat(a).block(b.membership.id);
      realtime.clear();
      const reply = await chat(b).send(conversation.id, "Hi back");
      expect(reply.status).toBe(201);
      expect((await chat(b).get(conversation.id)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true });
      expect(realtime.to(a.user.id)).toEqual([]);
      expect((await chat(a).messages(conversation.id)).body.data.map((m: ChatMessageDto) => m.body)).toEqual(["Hello"]);
    });
  });

  describe("asking again", () => {
    it("is refused for thirty days, then appends and goes back to pending, three requests in all", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "First");
      const id = conversation.id;
      await chat(b).decline(id);

      await ageRequest(ctx, id, 29);
      expect((await chat(a).send(id, "Too soon")).body.error.code).toBe("CHAT_REQUEST_PENDING");
      expect((await chat(a).get(id)).body.data.canSend).toBe(false);

      await ageRequest(ctx, id, 30);
      expect((await chat(a).get(id)).body.data).toMatchObject({ state: "REQUEST_SENT", canSend: true });
      realtime.clear();
      const second = await chat(a).send(id, "Second");
      expect(second.status).toBe(201);
      expect(second.body.data.seq).toBe(2);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "PENDING", requestCount: 2 });
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([id]);
      expect(realtime.to(b.user.id).map((e) => e.event)).toEqual(["chat:changed"]);
      // The asker's own devices hear that the thread changed, so a second screen stops offering the box too.
      expect(realtime.to(a.user.id).map((e) => e.event).sort()).toEqual(["chat:changed", "chat:message"]);
      expect((await chat(a).send(id, "Too soon again")).body.error.code).toBe("CHAT_REQUEST_PENDING");

      // Pending and unanswered counts the same: thirty days on, they may ask once more.
      await ageRequest(ctx, id, 31);
      expect((await chat(a).send(id, "Third")).status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "PENDING", requestCount: 3 });

      await ageRequest(ctx, id, 90);
      const view = await chat(a).get(id);
      expect(view.body.data).toMatchObject({ canSend: false, canRerequestAt: null });
      const refused = await chat(a).send(id, "Fourth");
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CHAT_REQUEST_PENDING");
      expect((await conversationRow(ctx, id)).requestCount).toBe(3);
    });

    it("says when, from the last request alone", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      const row = await conversationRow(ctx, conversation.id);
      const expected = new Date(row.requestedAt!.getTime() + 30 * 86_400_000).toISOString();
      expect(conversation.canRerequestAt).toBe(expected);
      await chat(b).decline(conversation.id);
      expect((await chat(a).get(conversation.id)).body.data.canRerequestAt).toBe(expected);
    });

    it("while blocked looks the same but is withheld and stays declined, consuming seq and counting", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "First");
      const id = conversation.id;
      await chat(b).block(a.membership.id);
      await ageRequest(ctx, id, 31);
      realtime.clear();
      const again = await chat(a).send(id, "Second");
      expect(again.status).toBe(201);
      // What the blocker reads hasn't moved. The count and the wait are on the sender's own copy.
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "DECLINED", requestCount: 1, lastSeq: 2 });
      expect(await participantRow(ctx, id, a.membership.id)).toMatchObject({ withheldState: "PENDING", withheldRequestCount: 2 });
      expect(realtime.to(b.user.id)).toEqual([]);
      // The asker's own devices hear exactly what they would without the block.
      expect(realtime.to(a.user.id).map((e) => e.event).sort()).toEqual(["chat:changed", "chat:message"]);
      expect((await chat(a).messages(id)).body.data.map((m: ChatMessageDto) => m.body)).toEqual(["Second", "First"]);
      expect((await chat(a).get(id)).body.data).toMatchObject({ state: "REQUEST_SENT", canSend: false });

      // A third, and the limit of three holds with the block in place, exactly as it would without it.
      await ageRequest(ctx, id, 31);
      expect((await chat(a).send(id, "Third")).status).toBe(201);
      await ageRequest(ctx, id, 31);
      expect((await chat(a).get(id)).body.data).toMatchObject({ canSend: false, canRerequestAt: null });
      expect((await chat(a).send(id, "Fourth")).body.error.code).toBe("CHAT_REQUEST_PENDING");
    });

    it("doesn't resurrect a declined request when the block lifts, and hides what was withheld for good", async () => {
      const { tenant, a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Withheld");
      await chat(b).unblock(a.membership.id);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([]);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0 });
      expect((await chat(b).messages(conversation.id)).body.data).toEqual([]);

      // Asking again once unblocked is a real request, and the recipient sees only what wasn't withheld.
      await ageRequest(ctx, conversation.id, 31);
      expect((await chat(a).send(conversation.id, "Visible now")).status).toBe(201);
      expect(ids(await chat(b).list("REQUESTS"))).toEqual([conversation.id]);
      expect((await chat(b).get(conversation.id)).body.data.unread).toBe(1);
      expect((await chat(b).messages(conversation.id)).body.data.map((m: ChatMessageDto) => m.body)).toEqual(["Visible now"]);
      expect((await chat(a).messages(conversation.id)).body.data.map((m: ChatMessageDto) => m.body)).toEqual(["Visible now", "Withheld"]);
    });
  });

  describe("the daily limit on new requests", () => {
    const withLimits = async (run: () => Promise<void>) => {
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        await run();
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    };

    it("is 20 a day and counts a request to someone who blocked them the same, so it can't reveal the block", async () => {
      const { tenant, a, chat } = await setup();
      const targets = await Promise.all(Array.from({ length: 22 }, () => bareMember(ctx, tenant.id)));
      // Every other target has the sender blocked.
      for (const t of targets.filter((_, i) => i % 2 === 0)) await ctx.db.execute(sql`insert into chat_blocks (blocker_membership_id, blocked_membership_id, tenant_id) values (${t.id}, ${a.membership.id}, ${tenant.id})`);
      await withLimits(async () => {
        for (let i = 0; i < 20; i++) expect((await chat(a).direct(targets[i]!.id)).status, `request ${i + 1}`).toBe(201);
        for (const t of [targets[20]!, targets[21]!]) {
          const refused = await chat(a).direct(t.id);
          expect(refused.status).toBe(429);
          expect(refused.body.error.code).toBe("RATE_LIMITED");
        }
      });
      expect(await ctx.redis.get(keys.rateLimit("chat-request", a.membership.id))).toBe("22");
      const ttl = await ctx.redis.ttl(keys.rateLimit("chat-request", a.membership.id));
      expect(ttl).toBeGreaterThan(86_400 - 60);
      expect(ttl).toBeLessThanOrEqual(86_400);
      // A refused request leaves nothing behind.
      expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, tenant.id))).toHaveLength(20);
    });

    it("doesn't count a retry, an early attempt or a normal message", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const accepted = await acceptedThread(ctx, tenant.slug, c, b);
      const key = newKey();
      await withLimits(async () => {
        const first = await chat(a).direct(b.membership.id, "Hello", key);
        await chat(a).direct(b.membership.id, "Hello", key);
        await chat(a).send(first.body.data.conversation.id, "Too soon");
        await chat(c).send(accepted, "Normal");
      });
      expect(await ctx.redis.get(keys.rateLimit("chat-request", a.membership.id))).toBe("1");
      expect(await ctx.redis.get(keys.rateLimit("chat-request", c.membership.id))).toBeNull();
    });
  });

  describe("the rate limit on", () => {
    type Fixture = Awaited<ReturnType<typeof setup>> & { id: string };
    const BUCKETS: Array<{ bucket: string; limit: number; windowSec: number; title: string; hit: (f: Fixture) => Promise<{ status: number }> }> = [
      { bucket: "chat-send", limit: 60, windowSec: 60, title: "sends is 60 a minute", hit: (f) => f.chat(f.a).send(f.id) },
      { bucket: "chat-send-hour", limit: 600, windowSec: 3600, title: "sends is 600 an hour", hit: (f) => f.chat(f.a).send(f.id) },
      { bucket: "chat-read", limit: 120, windowSec: 60, title: "read positions is 120 a minute", hit: (f) => f.chat(f.a).read(f.id, 1) },
      { bucket: "chat-read", limit: 120, windowSec: 60, title: "mutes shares the read bucket", hit: (f) => f.chat(f.a).mute(f.id, null) },
      { bucket: "chat-block", limit: 60, windowSec: 3600, title: "blocks is 60 an hour", hit: async (f) => f.chat(f.a).block((await bareMember(ctx, f.tenant.id)).id) },
      { bucket: "chat-block", limit: 60, windowSec: 3600, title: "unblocking shares the block bucket", hit: (f) => f.chat(f.a).unblock(f.b.membership.id) },
      {
        bucket: "chat-report",
        limit: 30,
        windowSec: 3600,
        title: "reports is 30 an hour",
        hit: async (f) => {
          const { body } = await f.chat(f.b).send(f.id, "Something to report");
          return f.chat(f.a).report(body.data.id);
        },
      },
    ];

    for (const { bucket, limit, windowSec, title, hit } of BUCKETS) {
      it(title, async () => {
        const s = await setup();
        const fixture = { ...s, id: await acceptedThread(ctx, s.tenant.slug, s.a, s.b) };
        const key = keys.rateLimit(bucket, s.a.membership.id);
        process.env.RATE_LIMIT_IN_TESTS = "1";
        try {
          // The window starts with the first one counted.
          expect((await hit(fixture)).status).toBeLessThan(300);
          const ttl = await ctx.redis.ttl(key);
          expect(ttl).toBeGreaterThan(windowSec - 5);
          expect(ttl).toBeLessThanOrEqual(windowSec);

          // The very last one allowed, then the one after it.
          await ctx.redis.set(key, String(limit - 1));
          expect((await hit(fixture)).status).toBeLessThan(300);
          const refused = await hit(fixture);
          expect(refused.status).toBe(429);
          expect(await ctx.redis.get(key)).toBe(String(limit + 1));
        } finally {
          delete process.env.RATE_LIMIT_IN_TESTS;
        }
      });
    }

    it("counts per member", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        await ctx.redis.set(keys.rateLimit("chat-send", a.membership.id), "60");
        expect((await chat(a).send(id)).status).toBe(429);
        expect((await chat(b).send(id)).status).toBe(201);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });
  });

  describe("muting", () => {
    it("is private: only the member's own devices hear about it", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      realtime.clear();
      await chat(b).mute(id, new Date(Date.now() + 3_600_000).toISOString());
      expect(realtime.to(a.user.id)).toEqual([]);
      expect(realtime.to(b.user.id).map((e) => e.event)).toContain("chat:changed");
      realtime.clear();
      await chat(b).mute(id, null);
      expect(realtime.to(a.user.id)).toEqual([]);
      expect(realtime.to(b.user.id).map((e) => e.event)).toContain("chat:changed");
    });

    it("doesn't change what the other member reads", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const before = (await chat(a).get(id)).body.data;
      await chat(b).mute(id, new Date(Date.now() + 3_600_000).toISOString());
      expect((await chat(a).get(id)).body.data).toEqual(before);
    });
  });

  describe("openDirectFromOrigin", () => {
    const ORIGIN_ID = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
    const open = (tenantId: string, a: Session, b: Session, origin: "MENTORSHIP" | "REFERRAL" = "MENTORSHIP", originId = ORIGIN_ID, note: string | undefined = "Please mentor me") =>
      runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId, aId: a.membership.id, bId: b.membership.id, origin, originId, ...(note ? { seedMessage: { senderMembershipId: a.membership.id, body: note } } : {}) }));

    it("creates an accepted thread when there's none, with the note as its first message", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversationId, created, message } = await open(tenant.id, a, b);
      expect(created).toBe(true);
      expect(message).toMatchObject({ kind: "TEXT", seq: 1, clientKey: `origin-${ORIGIN_ID}`, senderMembershipId: a.membership.id });
      expect(await conversationRow(ctx, conversationId)).toMatchObject({ directState: "ACCEPTED", origin: "MENTORSHIP", originId: ORIGIN_ID, lastSeq: 1 });
      expect((await chat(b).get(conversationId)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true });
      expect((await chat(b).messages(conversationId)).body.data[0].body).toBe("Please mentor me");
      expect(realtime.to(b.user.id).map((e) => e.event)).toContain("chat:message");
    });

    it("is idempotent: running again adds no message", async () => {
      const { tenant, a, b } = await setup();
      const first = await open(tenant.id, a, b);
      const second = await open(tenant.id, a, b);
      expect(second.conversationId).toBe(first.conversationId);
      expect(second.created).toBe(false);
      expect(second.message!.id).toBe(first.message!.id);
      expect((await conversationRow(ctx, first.conversationId)).lastSeq).toBe(1);
    });

    for (const state of ["PENDING", "DECLINED", "CLOSED"] as const) {
      it(`sets ${state} to accepted and takes the new origin`, async () => {
        const { tenant, a, b, chat } = await setup();
        const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Before");
        await ctx.db.update(chatConversations).set({ directState: state }).where(eq(chatConversations.id, conversation.id));
        const { conversationId, created } = await open(tenant.id, a, b, "REFERRAL");
        expect(created).toBe(false);
        expect(conversationId).toBe(conversation.id);
        expect(await conversationRow(ctx, conversationId)).toMatchObject({ directState: "ACCEPTED", origin: "REFERRAL", originId: ORIGIN_ID, lastSeq: 2 });
        expect((await chat(b).get(conversationId)).body.data.state).toBe("ACCEPTED");
      });
    }

    it("reuses an accepted thread without overwriting its origin", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const { conversationId, created } = await open(tenant.id, a, b, "MENTORSHIP");
      expect(conversationId).toBe(id);
      expect(created).toBe(false);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "ACCEPTED", origin: "MESSAGE_REQUEST", originId: null, lastSeq: 2 });
    });

    it("works with no note", async () => {
      const { tenant, a, b } = await setup();
      const { conversationId, message } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "REFERRAL", originId: ORIGIN_ID }));
      expect(message).toBeNull();
      expect((await conversationRow(ctx, conversationId)).lastSeq).toBe(0);
    });

    it("re-reads messaging fresh and refuses when it's off, leaving nothing behind", async () => {
      const { tenant, a, b } = await setup();
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await expect(open(tenant.id, a, b)).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
      expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, tenant.id))).toEqual([]);
    });

    it("refuses a suspended member", async () => {
      const { tenant, a, b } = await setup();
      await ctx.db.execute(sql`update memberships set status = 'SUSPENDED' where id = ${b.membership.id}`);
      await expect(open(tenant.id, a, b)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
    });

    it("refuses a current pupil, including when the school has switched messaging on", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true } });
      const a = await memberSession(ctx, tenant.id);
      const pupil = await memberSession(ctx, tenant.id, { batchYear: new Date().getFullYear() + 2 });
      await expect(open(tenant.id, a, pupil)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
    });

    it("refuses when either has the other blocked, as a backstop for what callers already handle", async () => {
      const { tenant, a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      await expect(open(tenant.id, a, b)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
      await chat(b).unblock(a.membership.id);
      await chat(a).block(b.membership.id);
      await expect(open(tenant.id, a, b)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
    });

    it("rolls back with the caller's transaction", async () => {
      const { tenant, a, b } = await setup();
      realtime.clear();
      await expect(
        runInTransaction(ctx, async (tx) => {
          await openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: ORIGIN_ID });
          throw new Error("the caller changed its mind");
        }),
      ).rejects.toThrow("changed its mind");
      expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, tenant.id))).toEqual([]);
      expect(realtime.events).toEqual([]);
    });
  });

  describe("closeOriginConversation", () => {
    const ORIGIN_ID = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
    const close = (tenantId: string, conversationId: string, hasOtherLiveConnection = false) => runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId, conversationId, hasOtherLiveConnection }));
    const opened = async (tenantId: string, a: Session, b: Session, origin: "MENTORSHIP" | "REFERRAL" = "MENTORSHIP") =>
      (await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId, aId: a.membership.id, bId: b.membership.id, origin, originId: ORIGIN_ID, seedMessage: { senderMembershipId: a.membership.id, body: "Note" } }))).conversationId;

    it("closes a thread a mentorship or referral opened, leaving it read-only until thirty days after closing", async () => {
      const { tenant, a, b, chat } = await setup();
      for (const origin of ["MENTORSHIP", "REFERRAL"] as const) {
        const c = await memberSession(ctx, tenant.id);
        const id = await opened(tenant.id, c, b, origin);
        expect(await close(tenant.id, id)).toBe(true);
        const row = await conversationRow(ctx, id);
        expect(row.directState).toBe("CLOSED");
        expect(Date.now() - row.requestedAt!.getTime()).toBeLessThan(10_000);
        expect((await chat(c).get(id)).body.data).toMatchObject({ state: "CLOSED", canSend: false });
        expect((await chat(b).get(id)).body.data).toMatchObject({ state: "CLOSED", canSend: false });
        const refused = await chat(c).send(id, "One more thing");
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe("CHAT_REQUEST_PENDING");
        expect((await chat(b).messages(id)).body.data).toHaveLength(1);
      }
      expect(a.membership.id).toBeTruthy();
    });

    it("lets either side ask again after thirty days, as a new request", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await opened(tenant.id, a, b);
      await close(tenant.id, id);
      await ageRequest(ctx, id, 31);
      expect((await chat(b).get(id)).body.data).toMatchObject({ state: "CLOSED", canSend: true });
      realtime.clear();
      const again = await chat(b).send(id, "Back in touch?");
      expect(again.status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "PENDING", requesterMembershipId: b.membership.id, requestCount: 1 });
      expect((await chat(a).list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
      expect(realtime.to(a.user.id).map((e) => e.event)).toEqual(["chat:changed"]);
      expect(realtime.to(b.user.id).map((e) => e.event).sort()).toEqual(["chat:changed", "chat:message"]);
    });

    it("doesn't treat a chat they agreed to by message request as the mentorship's, after one has ended", async () => {
      const { tenant, a, b, chat } = await setup();
      // A mentorship opens the thread and ends.
      const id = await opened(tenant.id, a, b);
      expect(await close(tenant.id, id)).toBe(true);
      // A month on, they agree to talk by message request. That's a new basis, whatever it was before.
      await ageRequest(ctx, id, 31);
      expect((await chat(a).send(id, "Shall we keep talking?")).status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ origin: "MESSAGE_REQUEST", originId: null });
      expect((await chat(b).get(id)).body.data.origin).toBe("MESSAGE_REQUEST");
      expect((await chat(b).accept(id)).body.data.state).toBe("ACCEPTED");
      // A second mentorship reuses the thread without taking it over, and ending that one leaves the chat alone.
      const second = "5f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a82";
      const { conversationId } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: second }));
      expect(conversationId).toBe(id);
      expect(await close(tenant.id, id)).toBe(false);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "ACCEPTED", origin: "MESSAGE_REQUEST" });
      expect((await chat(a).send(id, "Still here")).status).toBe(201);
    });

    it("keeps its origin when the request to re-open it is withheld, until a real one replaces it", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await opened(tenant.id, a, b);
      await close(tenant.id, id);
      await chat(b).block(a.membership.id);
      await ageRequest(ctx, id, 31);
      expect((await chat(a).send(id, "Withheld")).status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "CLOSED", origin: "MENTORSHIP" });
      expect((await chat(a).get(id)).body.data.origin).toBe("MESSAGE_REQUEST");
      expect((await chat(b).get(id)).body.data.origin).toBe("MENTORSHIP");

      await chat(b).unblock(a.membership.id);
      await ageRequest(ctx, id, 31);
      expect((await chat(a).send(id, "Real this time")).status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "PENDING", origin: "MESSAGE_REQUEST", requesterMembershipId: a.membership.id, requestCount: 2 });
    });

    it("never closes a thread that started as a message request", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      expect(await close(tenant.id, id)).toBe(false);
      expect((await conversationRow(ctx, id)).directState).toBe("ACCEPTED");
    });

    it("leaves it open while another live connection needs it", async () => {
      const { tenant, a, b } = await setup();
      const id = await opened(tenant.id, a, b);
      expect(await close(tenant.id, id, true)).toBe(false);
      expect((await conversationRow(ctx, id)).directState).toBe("ACCEPTED");
      expect(await close(tenant.id, id, false)).toBe(true);
    });

    it("leaves a thread alone that's already not accepted, or in another institution", async () => {
      const { tenant, a, b } = await setup();
      const other = await createTenant(ctx);
      const id = await opened(tenant.id, a, b);
      expect(await close(other.tenant.id, id)).toBe(false);
      expect((await conversationRow(ctx, id)).directState).toBe("ACCEPTED");
      await close(tenant.id, id);
      expect(await close(tenant.id, id)).toBe(false);
    });
  });
});
