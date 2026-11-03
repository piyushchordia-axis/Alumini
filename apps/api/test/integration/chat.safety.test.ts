import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatBlocks, chatConversations, chatMessages, chatParticipants, chatReports, contentReports, memberships, notifications, outboundMessages, tenantSettings, tenants } from "../../src/db/schema";
import { SEEDED_REPORTED_CHAT_BODY, seedConnections, seedCore, seedMembers } from "../../src/db/seed";
import { createApp } from "../../src/app";
import { runInTransaction } from "../../src/lib/transaction";
import { lockPair, type ChatMessageRow } from "../../src/repositories/chat.repo";
import { chatRecipientOf, chatRecipients } from "../../src/services/chat/fanout";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { capturingLogger } from "../helpers/capturingLogger";
import { acceptedThread, ageRequest, chatApi, conversationRow, createGroup, groupsApi, openRequest, participantRow, postToGroup, type Session } from "../helpers/chat";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const SECRET_TAG = "demo-chat-report-7Q4X";

describe.skipIf(!dbAvailable)("chat safety", () => {
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
  const bodies = (res: { body: { data: ChatMessageDto[] } }) => res.body.data.map((m) => m.body);

  describe("blocking in an accepted thread", () => {
    async function blockedThread() {
      const s = await setup();
      const id = await acceptedThread(ctx, s.tenant.slug, s.a, s.b);
      await s.chat(s.a).send(id, "Before the block");
      expect((await s.chat(s.b).block(s.a.membership.id)).status).toBe(201);
      realtime.clear();
      return { ...s, id };
    }

    it("makes the blocked member's sends look normal to them and reach only their own devices", async () => {
      const { a, b, chat, id } = await blockedThread();
      const before = (await chat(a).get(id)).body.data as ChatConversationDto;
      expect(before).toMatchObject({ state: "ACCEPTED", canSend: true, blockedByMe: false });

      const sent = await chat(a).send(id, "After the block");
      expect(sent.status).toBe(201);
      expect(sent.body.data).toMatchObject({ body: "After the block", seq: 3, removed: false });
      expect(JSON.stringify(sent.body)).not.toContain("withheld");
      expect(realtime.to(a.user.id, "chat:message")).toHaveLength(1);
      expect(realtime.to(b.user.id)).toEqual([]);
      expect(bodies(await chat(a).messages(id))).toContain("After the block");
      const after = (await chat(a).get(id)).body.data as ChatConversationDto;
      expect(after).toMatchObject({ state: "ACCEPTED", canSend: true, unread: 0, lastMessage: { body: "After the block", mine: true } });
      expect(JSON.stringify(after)).not.toContain("withheld");
    });

    it("returns CHAT_BLOCKED_BY_YOU to the blocker, on either route, and changes nothing", async () => {
      const { a, b, chat, id } = await blockedThread();
      const before = (await conversationRow(ctx, id)).lastSeq;
      for (const res of [await chat(b).send(id, "Oops"), await chat(b).direct(a.membership.id, "Oops")]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
      }
      expect((await conversationRow(ctx, id)).lastSeq).toBe(before);
      expect((await chat(b).get(id)).body.data).toMatchObject({ canSend: false, blockedByMe: true });
    });

    it("hides what's withheld from the blocker: no unread, no badge, no preview, no list movement", async () => {
      const { a, b, chat, id } = await blockedThread();
      const beforeRow = (await chat(b).get(id)).body.data as ChatConversationDto;
      await new Promise((r) => setTimeout(r, 5));
      await chat(a).send(id, "Withheld one");
      await chat(a).send(id, "Withheld two");
      const view = (await chat(b).get(id)).body.data as ChatConversationDto;
      expect(view.unread).toBe(0);
      expect(view.lastMessage!.body).toBe("Before the block");
      expect(view.lastMessageAt).toBe(beforeRow.lastMessageAt);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
      expect(bodies(await chat(b).messages(id))).not.toContain("Withheld one");
      expect(bodies(await chat(b).messages(id, { afterSeq: 2 }))).toEqual([]);
      const list = (await chat(b).list()).body.data as ChatConversationDto[];
      expect(list[0]).toMatchObject({ id, lastMessageAt: beforeRow.lastMessageAt, unread: 0, blockedByMe: true });
      expect(JSON.stringify(list)).not.toContain("Withheld");
    });

    it("keeps the blocker's list in place while the blocked member sends, and the blocked member's list moves as normal", async () => {
      const { tenant, a, b, chat, id } = await blockedThread();
      const c = await memberSession(ctx, tenant.id);
      const other = await acceptedThread(ctx, tenant.slug, c, b);
      await new Promise((r) => setTimeout(r, 5));
      await chat(a).send(id, "Withheld");
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([other, id]);
      expect((await chat(a).list()).body.data[0].id).toBe(id);
    });

    it("on unblocking, marks everything read and keeps withheld rows hidden permanently", async () => {
      const { a, b, chat, id } = await blockedThread();
      await chat(a).send(id, "Withheld");
      realtime.clear();
      expect((await chat(b).unblock(a.membership.id)).status).toBe(204);
      expect(realtime.to(a.user.id)).toEqual([]);
      const view = (await chat(b).get(id)).body.data as ChatConversationDto;
      // Marked read as the plan says, and the position they're shown is what they can see, or it would count what was withheld.
      expect(view).toMatchObject({ unread: 0, blockedByMe: false, canSend: true, lastReadSeq: 2 });
      expect((await participantRow(ctx, id, b.membership.id)).lastReadSeq).toBe(3);
      expect(bodies(await chat(b).messages(id))).not.toContain("Withheld");

      await chat(a).send(id, "Delivered again");
      expect((await chat(b).get(id)).body.data.unread).toBe(1);
      expect(bodies(await chat(b).messages(id))).toEqual(["Delivered again", "Before the block", "Hello there"]);
      expect(bodies(await chat(a).messages(id))).toEqual(["Delivered again", "Withheld", "Before the block", "Hello there"]);
    });

    it("on unblocking, keeps the thread's time and place, so nothing shows when a withheld message was sent", async () => {
      const { tenant, a, b, chat, id } = await blockedThread();
      const c = await memberSession(ctx, tenant.id);
      const frozen = (await chat(b).get(id)).body.data as ChatConversationDto;
      await new Promise((r) => setTimeout(r, 5));
      const other = await acceptedThread(ctx, tenant.slug, c, b);
      await new Promise((r) => setTimeout(r, 5));
      await chat(a).send(id, "Withheld, later than the other thread");

      await chat(b).unblock(a.membership.id);
      const after = (await chat(b).get(id)).body.data as ChatConversationDto;
      expect(after.lastMessageAt).toBe(frozen.lastMessageAt);
      expect(after.lastMessage).toEqual(frozen.lastMessage);
      expect(after.lastMessageAt).toBe(frozen.lastMessage!.createdAt);
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([other, id]);

      // Blocking and unblocking again can't advance it either.
      await chat(b).block(a.membership.id);
      expect(((await chat(b).get(id)).body.data as ChatConversationDto).lastMessageAt).toBe(frozen.lastMessageAt);
      await chat(b).unblock(a.membership.id);
      expect(((await chat(b).get(id)).body.data as ChatConversationDto).lastMessageAt).toBe(frozen.lastMessageAt);

      // The next message they can see moves it as normal.
      const { body } = await chat(a).send(id, "Delivered again");
      const moved = (await chat(b).get(id)).body.data as ChatConversationDto;
      expect(moved).toMatchObject({ lastMessageAt: body.data.createdAt, unread: 1, lastMessage: { body: "Delivered again" } });
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id, other]);
      expect((await participantRow(ctx, id, b.membership.id)).frozenSortAt).toBeNull();
    });

    it("moves the thread for someone who unblocked when they write themselves, though the other still has them blocked", async () => {
      const { a, b, chat, id } = await blockedThread();
      await chat(a).block(b.membership.id);
      await chat(b).unblock(a.membership.id);
      // a blocks b now, so b's send is withheld from a and only b sees it.
      const { body } = await chat(b).send(id, "Can't reach them");
      expect(body.data.body).toBe("Can't reach them");
      expect((await chat(b).get(id)).body.data).toMatchObject({ lastMessageAt: body.data.createdAt, lastMessage: { body: "Can't reach them", mine: true } });
      expect((await chat(a).get(id)).body.data.lastMessage.body).not.toBe("Can't reach them");
    });

    it("gives the blocker no running count of withheld sends through the read position", async () => {
      const { a, b, chat, id } = await blockedThread();
      const max = 2147483647;
      expect((await chat(b).read(id, max)).body.data).toEqual({ lastReadSeq: 2 });
      for (const n of [1, 2, 3]) {
        await chat(a).send(id, `Withheld ${n}`);
        expect((await chat(b).read(id, max)).body.data).toEqual({ lastReadSeq: 2 });
      }
      expect((await chat(b).get(id)).body.data.lastReadSeq).toBe(2);
      expect((await participantRow(ctx, id, b.membership.id)).lastReadSeq).toBe(2);

      await chat(b).unblock(a.membership.id);
      expect((await chat(b).get(id)).body.data.lastReadSeq).toBe(2);
      realtime.clear();
      expect((await chat(b).read(id, max)).body.data).toEqual({ lastReadSeq: 2 });
      expect((realtime.to(b.user.id, "chat:read")[0]!.payload as { lastReadSeq: number }).lastReadSeq).toBe(2);
      expect((await chat(b).get(id)).body.data.unread).toBe(0);
    });

    it("leaves the blocked sender's own copy showing nothing unusual after an unblock", async () => {
      const { a, b, chat, id } = await blockedThread();
      await chat(a).send(id, "Withheld");
      await chat(b).unblock(a.membership.id);
      const seqs = (await chat(b).messages(id)).body.data.map((m: ChatMessageDto) => m.seq);
      expect(seqs).toEqual([2, 1]);
      await chat(b).send(id, "Hello after");
      expect((await chat(a).messages(id)).body.data[0]).toMatchObject({ body: "Hello after", seq: 4 });
    });
  });

  describe("blocking a pending request", () => {
    it("declines it and removes it from the recipient's lists", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await chat(b).block(a.membership.id);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect((await chat(b).list("REQUESTS")).body.data).toEqual([]);
      expect((await chat(b).list()).body.data).toEqual([]);
      expect((await chat(b).badge()).body.data.requests).toBe(0);
    });

    it("by the requester of their own request leaves it open to the recipient, who can still answer", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hi");
      await chat(a).block(b.membership.id);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("PENDING");
      expect((await chat(b).list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([conversation.id]);
      expect((await chat(a).get(conversation.id)).body.data).toMatchObject({ canSend: false, blockedByMe: true, state: "REQUEST_SENT" });
    });
  });

  describe("the first message while blocked", () => {
    it("creates a declined conversation with the message withheld, and the blocker hears nothing", async () => {
      const { a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      realtime.clear();
      const res = await chat(a).direct(b.membership.id, "Are you there?");
      expect(res.status).toBe(201);
      expect(res.body.data.conversation).toMatchObject({ state: "REQUEST_SENT" });
      const row = await conversationRow(ctx, res.body.data.conversation.id);
      expect(row.directState).toBe("DECLINED");
      const [stored] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, row.id));
      expect(stored!.withheld).toBe(true);
      expect(realtime.to(b.user.id)).toEqual([]);
      for (const inbox of ["MAIN", "REQUESTS"] as const) expect((await chat(b).list(inbox)).body.data).toEqual([]);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
      expect(bodies(await chat(b).messages(row.id))).toEqual([]);
    });

    it("shows the blocker nothing unread even by id, and lifting the block keeps it that way", async () => {
      const { a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      const res = await chat(a).direct(b.membership.id, "Hi");
      const id = res.body.data.conversation.id;
      expect((await chat(b).get(id)).body.data).toMatchObject({ unread: 0, blockedByMe: true, canSend: false, lastMessage: null, lastReadSeq: 0 });
      await chat(b).unblock(a.membership.id);
      expect((await chat(b).get(id)).body.data).toMatchObject({ unread: 0, blockedByMe: false, lastReadSeq: 0, lastMessage: null });
      expect((await participantRow(ctx, id, b.membership.id)).lastReadSeq).toBe(1);
    });

    it("gives the blocker no way in while blocked", async () => {
      const { a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      const res = await chat(a).direct(b.membership.id, "Hi");
      const id = res.body.data.conversation.id;
      expect((await chat(b).send(id, "Reply")).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
      expect((await chat(b).accept(id)).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
    });
  });

  describe("what a blocked member does", () => {
    /** Everything a member can read about a thread. */
    const everything = async (api: ReturnType<typeof chatApi>, id: string) => {
      // The read comes first, so a position that can be moved at all has moved before anything is compared.
      const [reads, thread, main, requests, messages, badge] = [await api.read(id, 2147483647), await api.get(id), await api.list(), await api.list("REQUESTS"), await api.messages(id), await api.badge()];
      return { thread: thread.body.data, main: main.body.data, requests: requests.body.data, messages: messages.body.data, badge: badge.body.data, reads: reads.body.data };
    };
    const ORIGIN_ID = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
    /** A thread a mentorship opened and ended, old enough to ask again. */
    async function closedThread() {
      const s = await setup();
      const { conversationId: id } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: s.tenant.id, aId: s.a.membership.id, bId: s.b.membership.id, origin: "MENTORSHIP", originId: ORIGIN_ID, seedMessage: { senderMembershipId: s.b.membership.id, body: "A note" } }));
      expect(await runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId: s.tenant.id, conversationId: id, hasOtherLiveConnection: false }))).toBe(true);
      await ageRequest(ctx, id, 31);
      return { ...s, id };
    }

    it("in an accepted thread changes nothing the blocker can read", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(b).block(a.membership.id);
      const before = await everything(chat(b), id);
      expect((await chat(a).send(id, "Withheld")).status).toBe(201);
      expect(await everything(chat(b), id)).toEqual(before);
    });

    it("asking again after a decline changes nothing the blocker can read", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "First");
      await chat(b).block(a.membership.id);
      await ageRequest(ctx, conversation.id, 31);
      const before = await everything(chat(b), conversation.id);
      expect((await chat(a).send(conversation.id, "Second")).status).toBe(201);
      expect(await everything(chat(b), conversation.id)).toEqual(before);
    });

    it("asking again in a closed thread changes nothing the blocker can read, during the block or after it", async () => {
      const { a, b, chat, id } = await closedThread();
      await chat(a).block(b.membership.id);
      const before = await everything(chat(a), id);
      expect(before.thread).toMatchObject({ state: "CLOSED", canSend: false, blockedByMe: true, lastMessage: { body: "A note" } });
      expect(before.main.map((t: ChatConversationDto) => t.id)).toEqual([id]);

      realtime.clear();
      const sent = await chat(b).send(id, "Back in touch?");
      expect(sent.status).toBe(201);
      expect(realtime.to(a.user.id)).toEqual([]);
      expect(await everything(chat(a), id)).toEqual(before);
      expect((await conversationRow(ctx, id)).directState).toBe("CLOSED");
      // The blocked member's own copy shows a request sent, as it would with no block.
      expect((await chat(b).get(id)).body.data).toMatchObject({ state: "REQUEST_SENT", canSend: false });
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);

      // Unblocking brings back the same closed thread, with the same date to ask again, and the withheld request stays hidden.
      await chat(a).unblock(b.membership.id);
      const after = (await chat(a).get(id)).body.data as ChatConversationDto;
      expect(after).toEqual({ ...before.thread, blockedByMe: false, canSend: true });
      expect((await chat(a).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
      expect((await chat(a).list("REQUESTS")).body.data).toEqual([]);
      expect(bodies(await chat(a).messages(id))).toEqual(["A note"]);
    });

    it("asking again once the block has gone is a real request, counted with the one that was withheld", async () => {
      const { a, b, chat, id } = await closedThread();
      await chat(a).block(b.membership.id);
      await chat(b).send(id, "Withheld request");
      await chat(a).unblock(b.membership.id);
      expect((await chat(b).send(id, "Too soon")).body.error.code).toBe("CHAT_REQUEST_PENDING");

      await ageRequest(ctx, id, 31);
      realtime.clear();
      expect((await chat(b).send(id, "A real request")).status).toBe(201);
      expect(await conversationRow(ctx, id)).toMatchObject({ directState: "PENDING", requesterMembershipId: b.membership.id, requestCount: 2 });
      expect(await participantRow(ctx, id, b.membership.id)).toMatchObject({ withheldState: null, withheldRequestedAt: null, withheldRequestCount: null });
      expect(realtime.to(a.user.id).map((e) => e.event)).toEqual(["chat:changed"]);
      expect((await chat(a).list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
      expect((await chat(a).badge()).body.data).toEqual({ unread: 0, requests: 1, invites: 0 });
      expect((await chat(a).get(id)).body.data).toMatchObject({ state: "REQUEST_RECEIVED", unread: 1 });
      expect(bodies(await chat(a).messages(id))).toEqual(["A real request", "A note"]);
    });

    it("lets the blocker ask first once they've unblocked, which replaces what the other believed", async () => {
      const { a, b, chat, id } = await closedThread();
      await chat(a).block(b.membership.id);
      await chat(b).send(id, "Withheld request");
      await chat(a).unblock(b.membership.id);
      expect((await chat(a).get(id)).body.data).toMatchObject({ state: "CLOSED", canSend: true });
      expect((await chat(a).send(id, "Hello again")).status).toBe(201);
      expect((await chat(a).get(id)).body.data.state).toBe("REQUEST_SENT");
      expect((await chat(b).get(id)).body.data.state).toBe("REQUEST_RECEIVED");
      expect((await chat(b).list("REQUESTS")).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
      expect(bodies(await chat(a).messages(id))).toEqual(["Hello again", "A note"]);
    });

    for (const how of ["replying", "accepting"] as const) {
      it(`${how} to a request from someone who then blocked them changes nothing that member can read`, async () => {
        const { tenant, a, b, chat } = await setup();
        const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Asking");
        const id = conversation.id;
        await chat(a).block(b.membership.id);
        const before = await everything(chat(a), id);
        expect(before.thread).toMatchObject({ state: "REQUEST_SENT", blockedByMe: true });
        realtime.clear();

        const answered = how === "replying" ? await chat(b).send(id, "Hi back") : await chat(b).accept(id);
        expect(answered.status).toBeLessThan(300);
        expect(realtime.to(a.user.id)).toEqual([]);
        expect(await everything(chat(a), id)).toEqual(before);
        expect((await conversationRow(ctx, id)).directState).toBe("PENDING");
        // They see it accepted, and hear about it on their own devices, as anyone would.
        expect((await chat(b).get(id)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true });
        expect(realtime.to(b.user.id).map((e) => e.event)).toContain("chat:changed");
        expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
        expect((await chat(b).list("REQUESTS")).body.data).toEqual([]);
        expect((await chat(b).badge()).body.data.requests).toBe(0);

        // Still nothing once it's lifted, until they write again, which then really does accept it.
        await chat(a).unblock(b.membership.id);
        expect((await chat(a).get(id)).body.data.state).toBe("REQUEST_SENT");
        realtime.clear();
        expect((await chat(b).send(id, "Are you there?")).status).toBe(201);
        expect(await conversationRow(ctx, id)).toMatchObject({ directState: "ACCEPTED" });
        expect((await participantRow(ctx, id, b.membership.id)).withheldState).toBeNull();
        expect(realtime.to(a.user.id).map((e) => e.event).sort()).toEqual(["chat:changed", "chat:message"]);
        expect((await chat(a).get(id)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true, unread: 1, lastMessage: { body: "Are you there?" } });
        expect(bodies(await chat(a).messages(id))).toEqual(["Are you there?", "Asking"]);
      });
    }

    it("doesn't survive a mentorship being accepted, which is real for both of them", async () => {
      const { a, b, chat, id, tenant } = await closedThread();
      await chat(a).block(b.membership.id);
      await chat(b).send(id, "Withheld request");
      await chat(a).unblock(b.membership.id);
      await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: "5f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a82" }));
      expect((await participantRow(ctx, id, b.membership.id)).withheldState).toBeNull();
      for (const m of [a, b]) expect((await chat(m).get(id)).body.data).toMatchObject({ state: "ACCEPTED", canSend: true, origin: "MENTORSHIP" });
    });

    it("is refused when they've blocked each other, and lifting one block leaves the other in force", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).block(b.membership.id);
      await chat(b).block(a.membership.id);
      const lastSeq = (await conversationRow(ctx, id)).lastSeq;
      for (const m of [a, b]) expect((await chat(m).send(id, "No")).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
      expect((await conversationRow(ctx, id)).lastSeq).toBe(lastSeq);

      await chat(a).unblock(b.membership.id);
      const beforeB = await everything(chat(b), id);
      realtime.clear();
      expect((await chat(a).send(id, "Sent into the void")).status).toBe(201);
      expect(realtime.to(b.user.id)).toEqual([]);
      expect(await everything(chat(b), id)).toEqual(beforeB);
      expect((await chat(a).get(id)).body.data.lastMessage.body).toBe("Sent into the void");
      expect((await chat(b).send(id, "Still blocked")).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");

      await chat(b).unblock(a.membership.id);
      expect(bodies(await chat(b).messages(id))).toEqual(["Hello there"]);
      expect((await chat(b).get(id)).body.data).toMatchObject({ unread: 0, canSend: true, lastReadSeq: 1 });
    });

    it("can't be seen through a closed thread blocked from both ends either", async () => {
      const { a, b, chat, id } = await closedThread();
      await chat(a).block(b.membership.id);
      await chat(b).block(a.membership.id);
      for (const m of [a, b]) {
        expect((await chat(m).send(id, "No")).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
        expect((await chat(m).get(id)).body.data).toMatchObject({ state: "CLOSED", canSend: false, blockedByMe: true });
      }
      expect((await conversationRow(ctx, id)).lastSeq).toBe(1);
    });
  });

  describe("paging a list with a frozen thread in it", () => {
    /** The whole list, one row at a time, in the order the pages come. */
    const pageThrough = async (api: ReturnType<typeof chatApi>, limit = 1) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await api.list("MAIN", { limit, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        seen.push(...res.body.data.map((t: ChatConversationDto) => t.id));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor && pages < 10);
      return seen;
    };
    const pause = () => new Promise((r) => setTimeout(r, 5));

    it("shows each thread once, in frozen order, when withheld sends have moved it past the others underneath", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      const oldest = await acceptedThread(ctx, tenant.slug, c, b);
      await pause();
      const frozen = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(b).block(a.membership.id);
      await pause();
      const newest = await acceptedThread(ctx, tenant.slug, d, b);
      await pause();
      await chat(a).send(frozen, "Withheld, moving the row underneath");
      expect((await conversationRow(ctx, frozen)).lastMessageAt.getTime()).toBeGreaterThan((await conversationRow(ctx, newest)).lastMessageAt.getTime());

      expect(await pageThrough(chat(b))).toEqual([newest, frozen, oldest]);
      expect(await pageThrough(chat(b), 2)).toEqual([newest, frozen, oldest]);
    });

    it("shows each thread once when two have exactly the same time", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const one = await acceptedThread(ctx, tenant.slug, a, b);
      const two = await acceptedThread(ctx, tenant.slug, c, b);
      const at = new Date("2026-05-05T10:00:00.123Z");
      await ctx.db.update(chatConversations).set({ lastMessageAt: at }).where(eq(chatConversations.tenantId, tenant.id));
      const seen = await pageThrough(chat(b));
      expect(seen).toHaveLength(2);
      expect([...seen].sort()).toEqual([one, two].sort());
    });

    it("shows each thread once when a frozen one ties with a live one", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const live = await acceptedThread(ctx, tenant.slug, a, b);
      const frozen = await acceptedThread(ctx, tenant.slug, c, b);
      await chat(b).block(c.membership.id);
      const at = new Date("2026-05-05T10:00:00.123Z");
      await ctx.db.update(chatConversations).set({ lastMessageAt: at }).where(eq(chatConversations.id, live));
      await ctx.db.update(chatParticipants).set({ frozenSortAt: at }).where(and(eq(chatParticipants.conversationId, frozen), eq(chatParticipants.membershipId, b.membership.id)));
      const seen = await pageThrough(chat(b));
      expect(seen).toHaveLength(2);
      expect([...seen].sort()).toEqual([live, frozen].sort());
    });
  });

  describe("an unblock and a first message landing together", () => {
    it("waits its turn on the pair, so it can't miss a thread being created", async () => {
      const { tenant, a, b, chat } = await setup();
      await chat(b).block(a.membership.id);
      let finished = false;
      let unblock!: Promise<{ status: number }>;
      await runInTransaction(ctx, async (tx) => {
        await lockPair(tx, tenant.id, a.membership.id, b.membership.id);
        unblock = chat(b).unblock(a.membership.id).then((res) => {
          finished = true;
          return res;
        });
        await new Promise((r) => setTimeout(r, 300));
        expect(finished).toBe(false);
      });
      expect((await unblock).status).toBe(204);
    });

    it("marks what got withheld as read, whichever gets there first", async () => {
      const { tenant } = await setup();
      for (let round = 0; round < 8; round++) {
        const blocker = await memberSession(ctx, tenant.id);
        const sender = await memberSession(ctx, tenant.id);
        const blockerApi = chatApi(ctx, tenant.slug, blocker);
        await blockerApi.block(sender.membership.id);
        const [sent, lifted] = await Promise.all([chatApi(ctx, tenant.slug, sender).direct(blocker.membership.id, "Racing"), blockerApi.unblock(sender.membership.id)]);
        expect([sent.status, lifted.status]).toEqual([201, 204]);
        const id = sent.body.data.conversation.id as string;
        const [stored] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id));
        const view = (await blockerApi.get(id)).body.data as ChatConversationDto;
        if (stored!.withheld) {
          expect((await participantRow(ctx, id, blocker.membership.id)).lastReadSeq).toBe(1);
          expect(view).toMatchObject({ state: "REQUEST_DECLINED", unread: 0 });
        } else {
          expect(view).toMatchObject({ state: "REQUEST_RECEIVED", unread: 1 });
        }
      }
    });
  });

  describe("a block and a first message landing together", () => {
    it("never leaves a request from a blocked member showing, whichever gets there first", async () => {
      const { tenant } = await setup();
      for (let round = 0; round < 8; round++) {
        const blocker = await memberSession(ctx, tenant.id);
        const sender = await memberSession(ctx, tenant.id);
        const [sent, blocked] = await Promise.all([chatApi(ctx, tenant.slug, sender).direct(blocker.membership.id, "Racing"), chatApi(ctx, tenant.slug, blocker).block(sender.membership.id)]);
        expect([sent.status, blocked.status]).toEqual([201, 201]);
        expect((await conversationRow(ctx, sent.body.data.conversation.id)).directState).toBe("DECLINED");
        const api = chatApi(ctx, tenant.slug, blocker);
        expect((await api.list("REQUESTS")).body.data).toEqual([]);
        expect((await api.badge()).body.data.requests).toBe(0);
        // What the sender sees is the same however it went.
        expect(sent.body.data.conversation).toMatchObject({ state: "REQUEST_SENT", canSend: false });
      }
    });
  });

  describe("an id in capitals", () => {
    const shouted = (id: string) => id.toUpperCase();

    it("is still you, for blocking and messaging", async () => {
      const { a, chat } = await setup();
      expect((await chat(a).block(shouted(a.membership.id))).status).toBe(400);
      expect((await chat(a).direct(shouted(a.membership.id))).status).toBe(400);
      expect(await ctx.db.select().from(chatBlocks)).toEqual([]);
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
    });

    it("finds the same thread and the same block, even where capitals would sort the pair the other way", async () => {
      const s = await setup();
      // Lower case sorts after capitals, so "aaaa" comes before "bbbb" and after "BBBB".
      const withId = async (m: Session, id: string): Promise<Session> => {
        await ctx.db.update(memberships).set({ id }).where(eq(memberships.id, m.membership.id));
        return { ...m, membership: { ...m.membership, id } };
      };
      const a = await withId(s.a, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
      const b = await withId(s.b, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      const { chat, tenant } = s;
      const id = await acceptedThread(ctx, tenant.slug, a, b);

      expect((await chat(a).block(shouted(b.membership.id))).status).toBe(201);
      expect((await participantRow(ctx, id, a.membership.id)).frozenSortAt).not.toBeNull();
      await chat(b).send(id, "Withheld");
      expect((await chat(a).unblock(shouted(b.membership.id))).status).toBe(204);
      expect(await ctx.db.select().from(chatBlocks)).toEqual([]);
      expect((await participantRow(ctx, id, a.membership.id)).lastReadSeq).toBe((await conversationRow(ctx, id)).lastSeq);
      expect((await chat(a).direct(shouted(b.membership.id), "Same thread")).body.data.conversation.id).toBe(id);
    });

    it("can't make a self-block, which the table refuses however it's asked", async () => {
      const { tenant, a } = await setup();
      await expect(ctx.db.insert(chatBlocks).values({ tenantId: tenant.id, blockerMembershipId: a.membership.id, blockedMembershipId: a.membership.id })).rejects.toThrow();
    });
  });

  describe("chat:unread", () => {
    it("follows the same rules as every other event, and an institution suspended under a stale cache hears nothing", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      realtime.clear();
      await chat(a).read(id, 1);
      expect(realtime.to(a.user.id).map((e) => e.event).sort()).toEqual(["chat:read", "chat:unread"]);

      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      realtime.clear();
      // Not invalidated, so the request's copy of the institution still says active.
      expect((await chat(a).read(id, 1)).status).toBe(200);
      expect(realtime.to(a.user.id)).toEqual([]);
    });

    it("has a helper that applies the rules to one member", async () => {
      const { tenant, a } = await setup();
      expect(await chatRecipientOf(ctx.db, a.membership.id)).toEqual({ membershipId: a.membership.id, userId: a.user.id });
      await ctx.db.execute(sql`update memberships set status = 'SUSPENDED' where id = ${a.membership.id}`);
      expect(await chatRecipientOf(ctx.db, a.membership.id)).toBeNull();
      await ctx.db.execute(sql`update memberships set status = 'APPROVED' where id = ${a.membership.id}`);
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      expect(await chatRecipientOf(ctx.db, a.membership.id)).toBeNull();
    });
  });

  describe("chatRecipients", () => {
    it("leaves out whoever has the member acting blocked, and nobody otherwise", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const everyone = [a.membership.id, b.membership.id].sort();
      const ids = async (opts?: { actorMembershipId?: string }) => (await chatRecipients(ctx.db, id, opts)).map((r) => r.membershipId).sort();
      expect(await ids({ actorMembershipId: a.membership.id })).toEqual(everyone);
      await chat(b).block(a.membership.id);
      expect(await ids({ actorMembershipId: a.membership.id })).toEqual([a.membership.id]);
      expect(await ids({ actorMembershipId: b.membership.id })).toEqual(everyone);
      expect(await ids()).toEqual(everyone);
    });

    it("leaves out a participant who has left or been removed", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      for (const state of ["LEFT", "REMOVED", "INVITED"] as const) {
        await ctx.db.update(chatParticipants).set({ state }).where(and(eq(chatParticipants.conversationId, id), eq(chatParticipants.membershipId, b.membership.id)));
        expect((await chatRecipients(ctx.db, id)).map((r) => r.membershipId), state).toEqual([a.membership.id]);
      }
    });
  });

  describe("the blocks list", () => {
    it("adds, lists and removes, idempotently and per member", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const first = await chat(a).block(b.membership.id);
      expect(first.status).toBe(201);
      expect(first.body.data.member).toEqual({ id: b.membership.id, fullName: b.membership.fullName, avatarUrl: null });
      const again = await chat(a).block(b.membership.id);
      expect(again.body.data).toEqual(first.body.data);
      await chat(a).block(c.membership.id);
      const list = await chat(a).blocks();
      expect(list.body.data.map((x: { member: { id: string } }) => x.member.id).sort()).toEqual([b.membership.id, c.membership.id].sort());
      expect(JSON.stringify(list.body)).not.toContain(b.user.phoneE164);
      expect((await chat(b).blocks()).body.data).toEqual([]);
      expect((await chat(a).unblock(b.membership.id)).status).toBe(204);
      expect((await chat(a).unblock(b.membership.id)).status).toBe(204);
      expect((await chat(a).blocks()).body.data).toHaveLength(1);
    });

    it("pages", async () => {
      const { tenant, a, chat } = await setup();
      for (let i = 0; i < 3; i++) await chat(a).block((await memberSession(ctx, tenant.id)).membership.id);
      const first = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/blocks`).query({ limit: 2 }).set(a.headers);
      expect(first.body.data).toHaveLength(2);
      const second = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/chat/blocks`).query({ limit: 2, cursor: first.body.nextCursor }).set(a.headers);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.nextCursor).toBeNull();
    });

    it("refuses yourself", async () => {
      const { a, chat } = await setup();
      expect((await chat(a).block(a.membership.id)).status).toBe(400);
    });
  });

  describe("a profile's canMessage", () => {
    it("is never false because of a block, in either direction", async () => {
      const { tenant, a, b, chat } = await setup();
      const profile = (viewer: Session, target: Session) => request(ctx.app).get(`/api/v1/t/${tenant.slug}/directory/${target.membership.id}`).set(viewer.headers);
      expect((await profile(a, b)).body.data.canMessage).toBe(true);
      await chat(b).block(a.membership.id);
      expect((await profile(a, b)).body.data.canMessage).toBe(true);
      expect((await profile(b, a)).body.data.canMessage).toBe(true);
    });

    it("is false for your own profile and with messaging off", async () => {
      const { tenant, a, b } = await setup();
      const profile = (viewer: Session, target: Session) => request(ctx.app).get(`/api/v1/t/${tenant.slug}/directory/${target.membership.id}`).set(viewer.headers);
      expect((await profile(a, a)).body.data.canMessage).toBe(false);
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect((await profile(a, b)).body.data.canMessage).toBe(false);
    });
  });

  describe("with messaging off", () => {
    async function offThread() {
      const s = await setup();
      const id = await acceptedThread(ctx, s.tenant.slug, s.a, s.b);
      const { body } = await s.chat(s.b).send(id, "Reportable");
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, s.tenant.id));
      await invalidateTenantCache(ctx, s.tenant.slug);
      return { ...s, id, messageId: body.data.id as string };
    }

    it("refuses every thread route", async () => {
      const { a, b, chat, id } = await offThread();
      const api = chat(a);
      for (const res of [await api.direct(b.membership.id), await api.get(id), await api.messages(id), await api.send(id), await api.read(id, 1), await api.mute(id, null), await api.accept(id), await api.decline(id)]) {
        expect(res.status, res.request.url).toBe(403);
        expect(res.body.error.code, res.request.url).toBe("FEATURE_DISABLED");
      }
    });

    it("leaves direct threads out of the inbox while groups keep it open, and closes it once groups are off too", async () => {
      const { a, chat, tenant } = await offThread();
      for (const inbox of ["MAIN", "REQUESTS"] as const) {
        const res = await chat(a).list(inbox);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      }
      await ctx.db.update(tenantSettings).set({ features: { messaging: false, groups: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      for (const inbox of ["MAIN", "REQUESTS"] as const) {
        const res = await chat(a).list(inbox);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
    });

    it("keeps block, unblock and report available, and the badge reads zero", async () => {
      const { a, b, chat, messageId } = await offThread();
      expect((await chat(a).block(b.membership.id)).status).toBe(201);
      expect((await chat(a).blocks()).body.data).toHaveLength(1);
      expect((await chat(a).unblock(b.membership.id)).status).toBe(204);
      expect((await chat(a).report(messageId)).status).toBe(201);
      const badge = await chat(a).badge();
      expect(badge.status).toBe(200);
      expect(badge.body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
    });

    it("reads the setting fresh for a send, even when the cached institution still says on", async () => {
      const s = await setup();
      const id = await acceptedThread(ctx, s.tenant.slug, s.a, s.b);
      expect((await s.chat(s.a).get(id)).status).toBe(200);
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, s.tenant.id));
      // Not invalidated, so the request's copy of the institution still says on.
      expect((await s.chat(s.a).get(id)).status).toBe(200);
      const refused = await s.chat(s.a).send(id, "Too late");
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("FEATURE_DISABLED");
      const direct = await s.chat(s.b).direct(s.a.membership.id, "Too late");
      expect(direct.status).toBe(403);
    });
  });

  describe("filing a report", () => {
    /** A thread of `count` messages, alternating senders, as a reporter sees it. */
    async function longThread(count: number) {
      const s = await setup();
      const id = await acceptedThread(ctx, s.tenant.slug, s.a, s.b);
      const sent: ChatMessageDto[] = [];
      for (let i = 0; i < count; i++) sent.push((await s.chat(i % 2 ? s.a : s.b).send(id, `Message ${i}`)).body.data as ChatMessageDto);
      return { ...s, id, sent };
    }
    const reportRow = async (id: string) => (await ctx.db.select().from(chatReports).where(eq(chatReports.id, id)))[0]!;
    /** Ids of everything in the thread, oldest first. */
    const allIds = async (conversationId: string) => (await ctx.db.select({ id: chatMessages.id, seq: chatMessages.seq }).from(chatMessages).where(eq(chatMessages.conversationId, conversationId))).sort((x, y) => x.seq - y.seq).map((m) => m.id);

    it("freezes the target and up to five either side, oldest first, computed for that reporter", async () => {
      const { a, b, chat, id, sent } = await longThread(20);
      const target = sent.find((m) => m.sender!.id === b.membership.id && m.seq >= 10)!;
      const res = await chat(a).report(target.id, { reason: "HARASSMENT", details: "  Unkind  " });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ targetKind: "MESSAGE", targetId: target.id, reason: "HARASSMENT", status: "OPEN" });
      expect(Object.keys(res.body.data)).not.toContain("contextMessageIds");
      const report = await reportRow(res.body.data.id);
      expect(report).toMatchObject({ reporterMembershipId: a.membership.id, reportedMembershipId: b.membership.id, conversationId: id, details: "Unkind", targetKind: "MESSAGE" });
      const ids = await allIds(id);
      const at = ids.indexOf(target.id);
      expect(report.contextMessageIds).toEqual(ids.slice(at - 5, at + 6));
      expect(report.contextMessageIds).toHaveLength(11);
    });

    it("stops at the ends of the thread", async () => {
      const { a, chat, id } = await longThread(2);
      const ids = await allIds(id);
      const [, second] = (await chat(a).messages(id)).body.data.slice().reverse() as ChatMessageDto[];
      const res = await chat(a).report(second!.id);
      expect((await reportRow(res.body.data.id)).contextMessageIds).toEqual(ids);
    });

    it("doesn't move once filed, whatever is sent afterwards", async () => {
      const { a, b, chat, id, sent } = await longThread(10);
      const target = sent.filter((m) => m.sender!.id === b.membership.id).at(-1)!;
      const res = await chat(a).report(target.id);
      const frozen = (await reportRow(res.body.data.id)).contextMessageIds;
      for (let i = 0; i < 4; i++) await chat(b).send(id, `Later ${i}`);
      expect((await reportRow(res.body.data.id)).contextMessageIds).toEqual(frozen);
    });

    it("excludes withheld and already-removed rows", async () => {
      const { a, b, chat, id, sent } = await longThread(8);
      const reported = sent.find((m) => m.sender!.id === a.membership.id)!;
      // a blocks b, then b's next sends are withheld from a.
      const targetFromB = sent.filter((m) => m.sender!.id === b.membership.id).at(-1)!;
      await chat(a).block(b.membership.id);
      const withheld = (await chat(b).send(id, "Withheld from the reporter")).body.data as ChatMessageDto;
      await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, sent.at(-1)!.id));
      expect(reported).toBeTruthy();

      const res = await chat(a).report(targetFromB.id);
      const { contextMessageIds } = await reportRow(res.body.data.id);
      expect(contextMessageIds).toContain(targetFromB.id);
      expect(contextMessageIds).not.toContain(withheld.id);
      expect(contextMessageIds).not.toContain(sent.at(-1)!.id);
      const stored = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id));
      const byId = new Map(stored.map((m) => [m.id, m]));
      for (const included of contextMessageIds) expect(byId.get(included)!).toMatchObject({ withheld: false, removedAt: null });
    });

    it("excludes anything before the reporter joined", async () => {
      const { a, b, chat, id, sent } = await longThread(10);
      await ctx.db.update(chatParticipants).set({ joinedSeq: 6 }).where(and(eq(chatParticipants.conversationId, id), eq(chatParticipants.membershipId, a.membership.id)));
      const target = sent.filter((m) => m.sender!.id === b.membership.id).at(-1)!;
      const res = await chat(a).report(target.id);
      const stored = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id));
      const seqOf = new Map(stored.map((m) => [m.id, m.seq]));
      for (const included of (await reportRow(res.body.data.id)).contextMessageIds) expect(seqOf.get(included)!).toBeGreaterThan(6);
      const before = sent.find((m) => m.sender!.id === b.membership.id && m.seq <= 6)!;
      expect((await chat(a).report(before.id)).status).toBe(404);
    });

    it("excludes what's redacted for the reporter in a group, and refuses reporting it", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const room = await createGroup(ctx, tenant.slug, c, { name: "Reading room" });
      for (const m of [a, b]) await groupsApi(ctx, tenant.slug, m).join(room.id);
      const senders = [c, b, c, b, c];
      const rows: ChatMessageRow[] = [];
      for (const [i, m] of senders.entries()) rows.push(await postToGroup(ctx, tenant, room.id, m, `Room ${i}`));
      await chat(a).block(b.membership.id);

      const res = await chat(a).report(rows[2]!.id);
      expect(res.status).toBe(201);
      const { contextMessageIds } = await reportRow(res.body.data.id);
      // Everything around it but what B wrote, the line saying B joined included.
      const thread = (await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, room.id))).sort((x, y) => x.seq - y.seq);
      expect(contextMessageIds).toEqual(thread.filter((m) => m.senderMembershipId !== b.membership.id).map((m) => m.id));
      expect(contextMessageIds).toContain(rows[0]!.id);
      expect(contextMessageIds).not.toContain(rows[1]!.id);
      expect((await chat(a).report(rows[1]!.id)).status).toBe(404);
    });

    it("in an invite-only group, excludes what came before the reporter joined", async () => {
      const { tenant, a, b, chat } = await setup();
      const room = await createGroup(ctx, tenant.slug, b, { name: "Committee", visibility: "INVITE_ONLY" });
      const before = await postToGroup(ctx, tenant, room.id, b, "Before A was invited");
      await groupsApi(ctx, tenant.slug, b).invite(room.id, [a.membership.id]);
      await groupsApi(ctx, tenant.slug, a).accept(room.id);
      const target = await postToGroup(ctx, tenant, room.id, b, "After A joined");

      const res = await chat(a).report(target.id);
      expect(res.status).toBe(201);
      const { contextMessageIds } = await reportRow(res.body.data.id);
      expect(contextMessageIds).not.toContain(before.id);
      expect(contextMessageIds).toContain(target.id);
      expect((await chat(a).report(before.id)).status).toBe(404);
    });

    it("refuses reporting in a group moderation has hidden, which its members can't read", async () => {
      const { tenant, a, b, chat } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const room = await createGroup(ctx, tenant.slug, b, { name: "Soon gone" });
      await groupsApi(ctx, tenant.slug, a).join(room.id);
      const said = await postToGroup(ctx, tenant, room.id, b, "Something");
      await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${room.id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
      expect((await chat(a).report(said.id)).status).toBe(404);
      await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${room.id}/restore`).set(admin.headers).send({}).expect(200);
      expect((await chat(a).report(said.id)).status).toBe(201);
    });

    it("shows an admin a group message and its context through the same audited view", async () => {
      const { tenant, a, b, chat } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const room = await createGroup(ctx, tenant.slug, b, { name: "Open room" });
      await groupsApi(ctx, tenant.slug, a).join(room.id);
      const target = await postToGroup(ctx, tenant, room.id, b, "Reported group words");
      const filed = await chat(a).report(target.id);
      const view = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/chat-reports/${filed.body.data.id}/view`).set(admin.headers).send();
      expect(view.status).toBe(200);
      expect(view.body.data.messages.find((m: { isTarget: boolean }) => m.isTarget)).toMatchObject({ body: "Reported group words", sender: { id: b.membership.id } });
    });

    it("keeps a blocked sender's earlier messages in a 1:1, where the history isn't redacted", async () => {
      const { a, b, chat, id, sent } = await longThread(4);
      await chat(a).block(b.membership.id);
      const target = sent.filter((m) => m.sender!.id === b.membership.id).at(-1)!;
      const res = await chat(a).report(target.id);
      expect((await reportRow(res.body.data.id)).contextMessageIds).toEqual(await allIds(id));
    });

    it("refuses own messages, SYSTEM messages, duplicates and removed ones", async () => {
      const { tenant, a, b, chat, id, sent } = await longThread(2);
      const own = sent.find((m) => m.sender!.id === a.membership.id)!;
      const theirs = sent.find((m) => m.sender!.id === b.membership.id)!;
      expect((await chat(a).report(own.id)).status).toBe(400);
      const [system] = await ctx.db.insert(chatMessages).values({ tenantId: tenant.id, conversationId: id, seq: 99, kind: "SYSTEM", body: "Someone joined" }).returning();
      expect((await chat(a).report(system!.id)).status).toBe(400);
      expect((await chat(a).report(theirs.id)).status).toBe(201);
      const duplicate = await chat(a).report(theirs.id);
      expect(duplicate.status).toBe(409);
      await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, theirs.id));
      const c = await memberSession(ctx, tenant.id);
      expect((await chatApi(ctx, tenant.slug, c).report(theirs.id)).status).toBe(404);
    });

    it("lets the recipient of a request report it, waiting or declined", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const waiting = await openRequest(ctx, tenant.slug, a, b.membership.id, "Unwanted");
      expect((await chat(b).report(waiting.message.id)).status).toBe(201);
      const declined = await openRequest(ctx, tenant.slug, c, b.membership.id, "Also unwanted");
      await chat(b).decline(declined.conversation.id);
      expect((await chat(b).report(declined.message.id)).status).toBe(201);
    });

    it("refuses anyone outside the conversation with a 404", async () => {
      const { tenant, chat, sent } = await longThread(2);
      const outsider = await memberSession(ctx, tenant.id);
      expect((await chat(outsider).report(sent[0]!.id)).status).toBe(404);
    });

    it("treats a withheld message like one that doesn't exist, for everyone, without revealing it to its sender", async () => {
      const { tenant, a, b, chat, id } = await longThread(2);
      await chat(a).block(b.membership.id);
      const withheld = (await chat(b).send(id, "Withheld")).body.data as ChatMessageDto;

      const asBlocker = await chat(a).report(withheld.id);
      const nonsense = await chat(a).report("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81");
      expect(asBlocker.status).toBe(404);
      expect(asBlocker.body).toEqual(nonsense.body);

      // Its sender gets exactly what reporting any message of their own gets them.
      const ownWithheld = await chat(b).report(withheld.id);
      const ownDelivered = (await chat(b).messages(id)).body.data.find((m: ChatMessageDto) => m.seq === 2) as ChatMessageDto;
      const ownNormal = await chat(b).report(ownDelivered.sender!.id === b.membership.id ? ownDelivered.id : withheld.id);
      expect(ownWithheld.status).toBe(400);
      expect(ownWithheld.body).toEqual(ownNormal.body);

      const outsider = await memberSession(ctx, tenant.id);
      expect((await chat(outsider).report(withheld.id)).status).toBe(404);
      expect(await ctx.db.select().from(chatReports)).toEqual([]);
    });

    it("validates the reason", async () => {
      const { a, b, chat, sent } = await longThread(2);
      const theirs = sent.find((m) => m.sender!.id === b.membership.id)!;
      expect((await chat(a).report(theirs.id, { reason: "BECAUSE" })).status).toBe(400);
    });

    describe("telling admins", () => {
      async function reported() {
        const { tenant, a, b, chat } = await setup();
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const otherAdmin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const id = await acceptedThread(ctx, tenant.slug, a, b);
        const secret = "A body that must stay out of every admin surface";
        const { body } = await chat(b).send(id, secret);
        return { tenant, a, b, chat, admin, otherAdmin, id, secret, messageId: body.data.id as string };
      }

      it("notifies admins with no body and ids only", async () => {
        const { a, chat, admin, otherAdmin, messageId, secret } = await reported();
        const res = await chat(a).report(messageId, { reason: "SPAM", details: "Reporter's own words" });
        await ctx.jobs.drain();
        const rows = await ctx.db.select().from(notifications).where(eq(notifications.type, "CHAT_REPORT_FILED"));
        expect(rows.map((r) => r.recipientMembershipId).sort()).toEqual([admin.membership.id, otherAdmin.membership.id].sort());
        for (const row of rows) {
          expect(row.body).toBeNull();
          expect(row.data).toEqual({ chatReportId: res.body.data.id });
          expect(JSON.stringify(row)).not.toContain(secret);
          expect(JSON.stringify(row)).not.toContain("Reporter's own words");
        }
        expect(realtime.to(admin.user.id, "notification:new")).toHaveLength(1);
        expect(JSON.stringify(realtime.events)).not.toContain("Reporter's own words");
      });

      it("leaves out an admin the report names, as reported or as reporter", async () => {
        const { tenant } = await setup();
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const reporterAdmin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const bystander = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const id = await acceptedThread(ctx, tenant.slug, reporterAdmin, admin);
        const { body } = await chatApi(ctx, tenant.slug, admin).send(id, "From an admin");
        expect((await chatApi(ctx, tenant.slug, reporterAdmin).report(body.data.id)).status).toBe(201);
        const rows = await ctx.db.select().from(notifications).where(eq(notifications.type, "CHAT_REPORT_FILED"));
        expect(rows.map((r) => r.recipientMembershipId)).toEqual([bystander.membership.id]);
      });

      it("writes an audit row with no reporter and no message text", async () => {
        const { a, tenant, chat, messageId, secret } = await reported();
        const res = await chat(a).report(messageId, { reason: "SPAM", details: "Reporter's own words" });
        const rows = await ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenant.id), eq(auditLog.action, "chat_report.file")));
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ actorUserId: null, actorMembershipId: null, ip: null, targetType: "chat_report", targetId: res.body.data.id });
        expect(rows[0]!.metadata).toEqual({ reason: "SPAM", targetKind: "MESSAGE" });
        expect(JSON.stringify(rows)).not.toContain(secret);
        expect(JSON.stringify(rows)).not.toContain(a.membership.id);
      });

      it("sends no outbound message and leaves content reports alone", async () => {
        const { a, chat, messageId } = await reported();
        await chat(a).report(messageId);
        await ctx.jobs.drain();
        expect(await ctx.db.select().from(outboundMessages)).toEqual([]);
        expect(await ctx.db.select().from(contentReports)).toEqual([]);
      });

      it("keeps message text out of the job payloads", async () => {
        const { a, chat, messageId, secret } = await reported();
        await chat(a).report(messageId);
        expect(JSON.stringify(ctx.jobs.history)).not.toContain(secret);
      });
    });
  });

  describe("staying out of moderation", () => {
    it("moderation_items never reads a chat table", async () => {
      const usage = await ctx.db.execute<{ table_name: string }>(sql`select table_name from information_schema.view_table_usage where view_name = 'moderation_items'`);
      const tables = usage.rows.map((r) => r.table_name);
      expect(tables.length).toBeGreaterThan(0);
      // Groups are in it, through their own table, which holds a name and a description and nothing anyone said.
      expect(tables).toContain("chat_groups");
      for (const table of ["chat_messages", "chat_conversations", "chat_participants", "chat_reports", "chat_blocks", "chat_invite_declines"]) expect(tables).not.toContain(table);
    });

    it("chat messages can't be filed through content reports", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const { body } = await chat(b).send(id, "Private");
      for (const contentType of ["MESSAGE", "CHAT_MESSAGE", "POST", "COMMENT"]) {
        const res = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/reports`).set(a.headers).send({ contentType, contentId: body.data.id, reason: "SPAM" });
        expect([400, 404], contentType).toContain(res.status);
      }
    });

    it("no admin page or list serves a message body", async () => {
      const { tenant, a, b, chat } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const secret = "Another private sentence nobody but them should read";
      const { body } = await chat(b).send(id, secret);
      await chat(a).report(body.data.id);
      await ctx.jobs.drain();
      const base = `/api/v1/t/${tenant.slug}/admin`;
      for (const path of ["/moderation", "/reports", "/chat-reports", "/audit", "/dashboard", "/members", "/analytics"]) {
        const res = await request(ctx.app).get(`${base}${path}`).set(admin.headers);
        expect(JSON.stringify(res.body), path).not.toContain(secret);
      }
      const notices = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/notifications`).set(admin.headers);
      expect(notices.body.data[0]).toMatchObject({ type: "CHAT_REPORT_FILED", body: null });
      expect(JSON.stringify(notices.body)).not.toContain(secret);
    });
  });

  describe("demo data", () => {
    async function seed() {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const membershipIds = await seedMembers(ctx.db, tenantIds);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      return { tenantIds, membershipIds, uni: tenantIds["demo-university"]!, college: tenantIds["demo-college"]!, school: tenantIds["demo-school"]! };
    }

    it("has threads with real, gapless seq values in the university, and one pending request", async () => {
      const { uni } = await seed();
      // Groups are seeded too, and chat.groups checks those.
      const threads = await ctx.db.select().from(chatConversations).where(and(eq(chatConversations.tenantId, uni), eq(chatConversations.kind, "DIRECT")));
      expect(threads.length).toBeGreaterThanOrEqual(3);
      expect(threads.filter((t) => t.directState === "PENDING")).toHaveLength(1);
      for (const thread of threads) {
        expect(thread.kind).toBe("DIRECT");
        expect(thread.directLowId! < thread.directHighId!).toBe(true);
        const messages = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, thread.id));
        expect(messages.map((m) => m.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: thread.lastSeq }, (_, i) => i + 1));
        expect(await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, thread.id))).toHaveLength(2);
      }
    });

    it("has one open chat report in the university, naming neither the admin the e2e signs in as", async () => {
      const { uni, membershipIds } = await seed();
      const reports = await ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, uni));
      expect(reports).toHaveLength(1);
      const admin = membershipIds["demo-university:+919000000001"];
      expect(reports[0]).toMatchObject({ status: "OPEN", targetKind: "MESSAGE" });
      expect(reports[0]!.reportedMembershipId).not.toBe(admin);
      expect(reports[0]!.reporterMembershipId).not.toBe(admin);
      const [target] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, reports[0]!.targetId));
      expect(target!.body).toBe(SEEDED_REPORTED_CHAT_BODY);
      expect(reports[0]!.contextMessageIds).toContain(target!.id);
      expect(reports[0]!.reportedMembershipId).toBe(target!.senderMembershipId);
    });

    it("keeps the reported body out of notifications, the audit log, moderation and content reports", async () => {
      await seed();
      const everywhere = JSON.stringify([await ctx.db.select().from(notifications), await ctx.db.select().from(auditLog), await ctx.db.select().from(contentReports), (await ctx.db.execute(sql`select * from moderation_items`)).rows, ctx.jobs.history]);
      expect(everywhere).not.toContain(SEEDED_REPORTED_CHAT_BODY);
    });

    it("only the audited view reads the reported body: not moderation, the reports or chat queues, or the logs of a view that fails", async () => {
      await seed();
      const admin = auth((await loginAs(ctx, "+919000000001")).accessToken);
      const staff = auth((await loginAs(ctx, "+919999999999")).accessToken);
      const base = "/api/v1/t/demo-university/admin";
      const [report] = await ctx.db.select().from(chatReports);
      expect(report!.details).toBeTruthy();

      expect(JSON.stringify((await ctx.db.execute(sql`select * from moderation_items`)).rows)).not.toContain(SECRET_TAG);
      for (const path of ["/moderation", "/reports", "/chat-reports", "/audit", "/dashboard"]) {
        const res = await request(ctx.app).get(`${base}${path}`).set(admin);
        expect(res.status, path).toBe(200);
        expect(JSON.stringify(res.body), path).not.toContain(SECRET_TAG);
      }
      const queue = await request(ctx.app).get(`${base}/chat-reports`).set(admin);
      expect(queue.body.total).toBe(1);
      expect(JSON.stringify(queue.body)).not.toContain(report!.details!);
      // It names no admin and the university has admins left, so staff get nothing of it.
      expect((await request(ctx.app).get("/api/v1/platform/chat-reports").set(staff)).body.total).toBe(0);

      const { logger, text } = capturingLogger();
      await ctx.db.execute(sql`alter table audit_log add constraint test_refuse_seeded_view check (action <> 'chat_report.view') not valid`);
      try {
        const failed = await request(createApp({ ...ctx, logger })).post(`${base}/chat-reports/${report!.id}/view`).set(admin).send();
        expect(failed.status).toBe(500);
        expect(JSON.stringify(failed.body)).not.toContain(SECRET_TAG);
      } finally {
        await ctx.db.execute(sql`alter table audit_log drop constraint test_refuse_seeded_view`);
      }
      expect(text()).toContain("Unhandled error");
      expect(text()).not.toContain(SECRET_TAG);

      const viewed = await request(ctx.app).post(`${base}/chat-reports/${report!.id}/view`).set(admin).send();
      expect(viewed.body.data.messages.find((m: { isTarget: boolean }) => m.isTarget).body).toBe(SEEDED_REPORTED_CHAT_BODY);
      expect(viewed.body.data.messages.find((m: { isTarget: boolean }) => m.isTarget).sender.fullName).toBeTruthy();
    });

    it("adds no content report to the college, whose admin e2e expects none", async () => {
      const { college } = await seed();
      expect(await ctx.db.select().from(contentReports).where(eq(contentReports.tenantId, college))).toEqual([]);
      expect(await ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, college))).toEqual([]);
    });

    it("adds a future-batch pupil to the school, who chat refuses", async () => {
      const { school } = await seed();
      const rows = await ctx.db.execute<{ id: string; batch_year: number; status: string }>(sql`select id, batch_year, status from memberships where tenant_id = ${school} and batch_year > ${new Date().getFullYear()}`);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.status).toBe("APPROVED");
    });

    it("adds no notification, so the unread counts the e2e asserts hold", async () => {
      await seed();
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });

    it("runs once, each part guarding itself", async () => {
      const { tenantIds, membershipIds } = await seed();
      const count = async () => [await ctx.db.select().from(chatConversations), await ctx.db.select().from(chatMessages), await ctx.db.select().from(chatReports)].map((r) => r.length);
      const before = await count();
      await seedConnections(ctx.db, tenantIds, membershipIds);
      expect(await count()).toEqual(before);
      // With the report gone, only the report comes back.
      await ctx.db.delete(chatReports);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      expect(await count()).toEqual(before);
    });
  });
});
