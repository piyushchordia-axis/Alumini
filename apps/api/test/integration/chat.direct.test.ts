import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import { createDb } from "../../src/db/client";
import { auditLog, chatConversations, chatMessages, chatParticipants, memberships, notifications } from "../../src/db/schema";
import { encodeCursor } from "../../src/lib/pagination";
import { runInTransaction } from "../../src/lib/transaction";
import { lockConversation } from "../../src/repositories/chat.repo";
import { appendMessage } from "../../src/services/chat/fanout";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { acceptedThread, bareMember, chatApi, conversationRow, newKey, type Session } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("direct conversations", () => {
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
    return { tenant, a, b, chat };
  }

  describe("the first message", () => {
    it("opens a thread with both members in it, as a request with seq 1", async () => {
      const { a, b, chat } = await setup();
      const res = await chat(a).direct(b.membership.id, "  Hello Priya  ");
      expect(res.status).toBe(201);
      const { conversation, message } = res.body.data as { conversation: ChatConversationDto; message: ChatMessageDto };
      expect(message).toMatchObject({ seq: 1, body: "Hello Priya", kind: "TEXT", removed: false, sender: { id: a.membership.id } });
      expect(conversation).toMatchObject({ kind: "DIRECT", origin: "MESSAGE_REQUEST", state: "REQUEST_SENT", canSend: false, unread: 0, lastReadSeq: 1, peer: { id: b.membership.id } });
      const row = await conversationRow(ctx, conversation.id);
      expect(row).toMatchObject({ directState: "PENDING", requesterMembershipId: a.membership.id, requestCount: 1, lastSeq: 1 });
      const pair = [a.membership.id, b.membership.id].sort();
      expect([row.directLowId, row.directHighId]).toEqual(pair);
      expect(await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, conversation.id))).toHaveLength(2);
    });

    it("refuses messaging yourself and an unknown member", async () => {
      const { a, chat } = await setup();
      expect((await chat(a).direct(a.membership.id)).status).toBe(400);
      expect((await chat(a).direct("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81")).status).toBe(404);
    });

    it("validates the message and the client key", async () => {
      const { a, b, chat } = await setup();
      const send = (body: unknown, clientKey: unknown = newKey()) => chat(a).direct(b.membership.id, body as string, clientKey as string);
      expect((await send("x".repeat(4001))).status).toBe(400);
      expect((await send("   \n\t ")).status).toBe(400);
      expect((await send("​​")).status).toBe(400);
      expect((await send("Hello", "short")).status).toBe(400);
      expect((await send("Hello", "has spaces in it")).status).toBe(400);
      expect((await send("Hello", "x".repeat(65))).status).toBe(400);
      const stripped = await send("Hello\u0000 there");
      expect(stripped.status).toBe(201);
      expect(stripped.body.data.message.body).toBe("Hello there");
      await chat(b).accept(stripped.body.data.conversation.id);
      const full = await chat(a).send(stripped.body.data.conversation.id, "x".repeat(4000));
      expect(full.status).toBe(201);
    });
  });

  describe("under concurrency", () => {
    it("ends with one thread when two members write to each other at once", async () => {
      const { tenant, a, b, chat } = await setup();
      for (let round = 0; round < 6; round++) {
        await ctx.db.delete(chatConversations).where(eq(chatConversations.tenantId, tenant.id));
        const [ab, ba] = await Promise.all([chat(a).direct(b.membership.id, "From A"), chat(b).direct(a.membership.id, "From B")]);
        expect([ab.status, ba.status]).toEqual([201, 201]);
        expect(ab.body.data.conversation.id).toBe(ba.body.data.conversation.id);
        const rows = await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, tenant.id));
        expect(rows).toHaveLength(1);
        // Whoever came second replied to the first one's request, which accepts it.
        expect(rows[0]).toMatchObject({ directState: "ACCEPTED", lastSeq: 2 });
        const messages = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, rows[0]!.id));
        expect(messages.map((m) => m.seq).sort()).toEqual([1, 2]);
      }
    });

    it("gives parallel sends a gapless seq in commit order", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const sends = Array.from({ length: 24 }, (_, i) => chat(i % 2 ? a : b).send(id, `Message ${i}`));
      const results = await Promise.all(sends);
      expect(results.map((r) => r.status)).toEqual(results.map(() => 201));
      const seqs = results.map((r) => (r.body.data as ChatMessageDto).seq).sort((x, y) => x - y);
      expect(seqs).toEqual(Array.from({ length: 24 }, (_, i) => i + 2));
      expect((await conversationRow(ctx, id)).lastSeq).toBe(25);
      const stored = await ctx.db.select({ seq: chatMessages.seq }).from(chatMessages).where(eq(chatMessages.conversationId, id));
      expect(stored.map((m) => m.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });

    it("lets a reader catching up with afterSeq during a burst see everything, because seq follows commit order", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const seen: number[] = [1];
      let finished = false;
      const reader = (async () => {
        while (!finished || seen.length < 21) {
          const page = await chat(b).messages(id, { afterSeq: seen[seen.length - 1]!, limit: 50 });
          seen.push(...(page.body.data as ChatMessageDto[]).map((m) => m.seq));
        }
      })();
      await Promise.all(Array.from({ length: 20 }, (_, i) => chat(i % 2 ? a : b).send(id, `M${i}`)));
      finished = true;
      await reader;
      expect(seen).toEqual(Array.from({ length: 21 }, (_, i) => i + 1));
    });
  });

  describe("a retry", () => {
    it("returns the original message and consumes no seq", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = newKey();
      const first = await chat(a).send(id, "Only once", key);
      const again = await chat(a).send(id, "Only once", key);
      expect(again.status).toBe(201);
      expect(again.body.data).toEqual(first.body.data);
      expect((await conversationRow(ctx, id)).lastSeq).toBe(first.body.data.seq);
    });

    it("sent in parallel still makes one message", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const before = (await conversationRow(ctx, id)).lastSeq;
      const key = newKey();
      const results = await Promise.all(Array.from({ length: 8 }, () => chat(a).send(id, "Once", key)));
      expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
      expect((await conversationRow(ctx, id)).lastSeq).toBe(before + 1);
    });

    it("returns the original even if the thread has changed since, like a response lost before a block", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = newKey();
      const first = await chat(a).send(id, "Sent before blocking", key);
      await chat(a).block(b.membership.id);
      const again = await chat(a).send(id, "Sent before blocking", key);
      expect(again.status).toBe(201);
      expect(again.body.data.id).toBe(first.body.data.id);
      expect((await chat(a).send(id, "A new one", newKey())).body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
    });

    it("of a first message returns it without opening a second thread or a second request", async () => {
      const { tenant, a, b, chat } = await setup();
      const key = newKey();
      const first = await chat(a).direct(b.membership.id, "Hello", key);
      const again = await chat(a).direct(b.membership.id, "Hello", key);
      expect(again.status).toBe(201);
      expect(again.body.data.message.id).toBe(first.body.data.message.id);
      expect(await conversationRow(ctx, first.body.data.conversation.id)).toMatchObject({ lastSeq: 1, requestCount: 1 });
      expect(await ctx.db.select().from(chatConversations).where(eq(chatConversations.tenantId, tenant.id))).toHaveLength(1);
    });

    it("of a first message returns it even if the other member has since become unreachable", async () => {
      const { a, b, chat } = await setup();
      const key = newKey();
      const first = await chat(a).direct(b.membership.id, "Hello", key);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      const again = await chat(a).direct(b.membership.id, "Hello", key);
      expect(again.status).toBe(201);
      expect(again.body.data.message.id).toBe(first.body.data.message.id);
      const fresh = await chat(a).direct(b.membership.id, "Another", newKey());
      expect(fresh.status).toBe(409);
      expect(fresh.body.error.code).toBe("CONTACT_UNAVAILABLE");
    });

    it("keys per sender, so two members can't collide", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const key = newKey();
      const fromA = await chat(a).send(id, "Mine", key);
      const fromB = await chat(b).send(id, "Mine too", key);
      expect(fromB.body.data.id).not.toBe(fromA.body.data.id);
    });
  });

  describe("reading a thread", () => {
    async function threadWith(count: number, at?: Date) {
      const s = await setup();
      const id = await acceptedThread(ctx, s.tenant.slug, s.a, s.b);
      const base = (await conversationRow(ctx, id)).lastSeq;
      await ctx.db.update(chatConversations).set({ lastSeq: base + count }).where(eq(chatConversations.id, id));
      await ctx.db.insert(chatMessages).values(Array.from({ length: count }, (_, i) => ({ tenantId: s.tenant.id, conversationId: id, seq: base + i + 1, senderMembershipId: s.a.membership.id, body: `Row ${base + i + 1}`, ...(at ? { createdAt: at } : {}) })));
      return { ...s, id };
    }

    it("pages newest first through messages sent in the same millisecond, skipping and repeating nothing", async () => {
      const { id, b, chat } = await threadWith(11, new Date("2026-05-05T10:00:00.123Z"));
      const seen: number[] = [];
      let cursor: string | undefined;
      let pages = 0;
      do {
        const res = await chat(b).messages(id, { limit: 4, ...(cursor ? { cursor } : {}) });
        expect(res.status).toBe(200);
        seen.push(...(res.body.data as ChatMessageDto[]).map((m) => m.seq));
        cursor = res.body.nextCursor ?? undefined;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(Array.from({ length: 12 }, (_, i) => 12 - i));
    });

    it("fetches what came after a seq, oldest first, and says when there's more than a page", async () => {
      const { id, b, chat } = await threadWith(9);
      const short = await chat(b).messages(id, { afterSeq: 7 });
      expect((short.body.data as ChatMessageDto[]).map((m) => m.seq)).toEqual([8, 9, 10]);
      expect(short.body.nextCursor).toBeNull();
      const long = await chat(b).messages(id, { afterSeq: 2, limit: 3 });
      expect((long.body.data as ChatMessageDto[]).map((m) => m.seq)).toEqual([3, 4, 5]);
      expect(long.body.nextCursor).not.toBeNull();
      const none = await chat(b).messages(id, { afterSeq: 10 });
      expect(none.status).toBe(200);
      expect(none.body).toEqual({ data: [], nextCursor: null });
    });

    it("answers cursors and afterSeq outside 0 to 2147483647 with 400, not a database error", async () => {
      const { id, b, chat } = await threadWith(2);
      const anId = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
      for (const v of ["2147483648", "-1", "10.5", "1e3", "abc", "", " 1", "99999999999"]) {
        expect((await chat(b).messages(id, { cursor: encodeCursor({ v, id: anId }) })).status, `cursor ${JSON.stringify(v)}`).toBe(400);
      }
      for (const afterSeq of ["2147483648", "-1", "10.5", "1e3", "abc", " 1", "99999999999"]) {
        expect((await chat(b).messages(id, { afterSeq })).status, `afterSeq ${afterSeq}`).toBe(400);
      }
      expect((await chat(b).messages(id, { cursor: encodeCursor({ v: "2026-01-01T00:00:00.000Z", id: anId }) })).status).toBe(400);
      expect((await chat(b).messages(id, { cursor: encodeCursor({ v: "2147483647", id: anId }) })).status).toBe(200);
      expect((await chat(b).messages(id, { cursor: encodeCursor({ v: "0", id: anId }) })).status).toBe(200);
      expect((await chat(b).messages(id, { afterSeq: 0 })).status).toBe(200);
      expect((await chat(b).messages(id, { afterSeq: 2147483647 })).status).toBe(200);
      expect((await chat(b).messages(id, { afterSeq: 1, cursor: encodeCursor({ v: "2", id: anId }) })).status).toBe(400);
    });

    it("orders lists newest first by activity, pages them, and previews the last message", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      const withB = await acceptedThread(ctx, tenant.slug, a, b);
      const withC = await acceptedThread(ctx, tenant.slug, a, c);
      const withD = await acceptedThread(ctx, tenant.slug, a, d);
      await chat(b).send(withB, "Latest of all");
      const first = await chat(a).list("MAIN", { limit: 2 });
      expect(first.body.data.map((t: ChatConversationDto) => t.id)).toEqual([withB, withD]);
      expect(first.body.data[0]).toMatchObject({ lastMessage: { body: "Latest of all", mine: false }, unread: 1 });
      const second = await chat(a).list("MAIN", { limit: 2, cursor: first.body.nextCursor });
      expect(second.body.data.map((t: ChatConversationDto) => t.id)).toEqual([withC]);
      expect(second.body.nextCursor).toBeNull();
    });

    it("gives a missing or malformed list cursor a 400", async () => {
      const { a, chat } = await setup();
      expect((await chat(a).list("MAIN", { cursor: "nonsense" })).status).toBe(400);
      expect((await chat(a).list("MAIN", { cursor: encodeCursor({ v: "yesterday-ish", id: "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81" }) })).status).toBe(400);
    });

    it("rejects an unknown inbox", async () => {
      const { a, chat } = await setup();
      expect((await chat(a).list("ARCHIVE" as "MAIN")).status).toBe(400);
    });

    it("hides a thread from anyone outside it with a 404, never a 403", async () => {
      const { tenant, a, b, chat } = await setup();
      const outsider = await memberSession(ctx, tenant.id);
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const { body } = await chat(a).send(id);
      const api = chat(outsider);
      for (const res of [await api.get(id), await api.messages(id), await api.send(id), await api.read(id, 1), await api.mute(id, null), await api.accept(id), await api.decline(id), await api.report(body.data.id)]) {
        expect(res.status, res.request.url).toBe(404);
      }
    });

    it("marks every response no-store, errors included", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const api = chat(a);
      for (const res of [await api.list(), await api.get(id), await api.messages(id), await api.send(id), await api.badge(), await api.blocks(), await api.get("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81"), await api.send(id, "   ")]) {
        expect(res.headers["cache-control"], res.request.url).toBe("no-store");
      }
    });
  });

  describe("read position and mute", () => {
    it("moves forward only, stops at the end of the thread, and clears the badge", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).send(id);
      await chat(a).send(id);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 1, requests: 0, invites: 0 });
      expect((await chat(b).get(id)).body.data.unread).toBe(3);
      expect((await chat(b).read(id, 2)).body.data).toEqual({ lastReadSeq: 2 });
      expect((await chat(b).get(id)).body.data.unread).toBe(1);
      expect((await chat(b).read(id, 1)).body.data).toEqual({ lastReadSeq: 2 });
      expect((await chat(b).read(id, 99)).body.data).toEqual({ lastReadSeq: 3 });
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
    });

    it("counts conversations rather than messages, and leaves muted ones out until the mute ends", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const one = await acceptedThread(ctx, tenant.slug, a, b);
      const two = await acceptedThread(ctx, tenant.slug, c, b);
      await chat(a).send(one);
      await chat(a).send(one);
      await chat(c).send(two);
      expect((await chat(b).badge()).body.data.unread).toBe(2);
      const until = new Date(Date.now() + 3_600_000).toISOString();
      const muted = await chat(b).mute(one, until);
      expect(muted.body.data.mutedUntil).toBe(until);
      expect((await chat(b).badge()).body.data.unread).toBe(1);
      await chat(b).mute(one, new Date(Date.now() - 1000).toISOString());
      expect((await chat(b).badge()).body.data.unread).toBe(2);
      await chat(b).mute(one, until);
      expect((await chat(b).mute(one, null)).body.data.mutedUntil).toBeNull();
      expect((await chat(b).badge()).body.data.unread).toBe(2);
      expect((await chat(b).mute(one, "not a date")).status).toBe(400);
    });

    it("touches nothing in the notification bell", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).send(id);
      const rows = await ctx.db.execute(sql`select count(*)::int as n from notifications`);
      expect(rows.rows[0]).toEqual({ n: 0 });
    });
  });

  describe("transaction rules", () => {
    /** A context whose database handle throws, so anything inside a caller's transaction that reaches for it is caught. */
    const withoutDb = (): TestContext => new Proxy(ctx, { get: (target, key, receiver) => (key === "db" ? fail() : Reflect.get(target, key, receiver)) });
    const fail = () => {
      throw new Error("ctx.db used inside a transaction");
    };

    it("appendMessage works only through the caller's transaction", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const row = await runInTransaction(ctx, async (tx) => {
        const conversation = await lockConversation(tx, tenant.id, id);
        return appendMessage(withoutDb(), tx, { tenantSlug: tenant.slug, conversation: conversation!, sender: a.membership, body: "From a service" });
      });
      expect(row.seq).toBe(2);
    });

    it("openDirectFromOrigin and closeOriginConversation work only through the caller's transaction", async () => {
      const { tenant, a, b } = await setup();
      const originId = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";
      const { conversationId } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(withoutDb(), tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId, seedMessage: { senderMembershipId: a.membership.id, body: "A note" } }));
      expect(await runInTransaction(ctx, (tx) => closeOriginConversation(withoutDb(), tx, { tenantId: tenant.id, conversationId, hasOtherLiveConnection: false }))).toBe(true);
    });

    it("gets every write through on a single connection, which using ctx.db inside a transaction would freeze", async () => {
      const { tenant, a, b } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const leaving = await memberSession(ctx, tenant.id);
      const { pool, db } = createDb(ctx.config.DATABASE_URL);
      pool.options.max = 1;
      // A freeze ends in a failed request here, rather than a test that sits out the real timeout.
      pool.options.connectionTimeoutMillis = 3000;
      const narrow: TestContext = { ...ctx, db };
      narrow.app = createApp(narrow);
      const chat = (m: Session) => chatApi(narrow, tenant.slug, m);
      try {
        const opened = await chat(a).direct(b.membership.id, "A request");
        expect(opened.status).toBe(201);
        const id = opened.body.data.conversation.id as string;
        expect((await chat(b).accept(id)).status).toBe(200);
        const sent = await chat(a).send(id, "A message");
        expect(sent.status).toBe(201);
        expect((await chat(b).read(id, 3)).status).toBe(200);
        expect((await chat(b).mute(id, null)).status).toBe(200);

        const declined = await chat(c).direct(b.membership.id, "Another request");
        expect((await chat(b).decline(declined.body.data.conversation.id)).status).toBe(200);

        // The report notifies an admin and writes the audit log, both inside its transaction.
        expect((await chat(b).report(sent.body.data.id)).status).toBe(201);
        expect(await ctx.db.select().from(notifications)).toEqual([expect.objectContaining({ type: "CHAT_REPORT_FILED", recipientMembershipId: admin.membership.id })]);
        expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "chat_report.file"))).toHaveLength(1);

        // So does handling it: the view, the removal with its notification and tombstone, and the checks on who may act.
        const reports = `/api/v1/t/${tenant.slug}/admin/chat-reports`;
        const { body: queue } = await request(narrow.app).get(reports).set(admin.headers);
        const reportId = queue.data[0].id as string;
        expect((await request(narrow.app).post(`${reports}/${reportId}/view`).set(admin.headers).send()).status).toBe(200);
        expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "chat_report.view"))).toHaveLength(1);
        expect((await request(narrow.app).post(`${reports}/${reportId}/resolve`).set(admin.headers).send({ action: "REMOVE_MESSAGE", note: "Upheld" })).status).toBe(200);
        expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "chat_report.resolve"))).toHaveLength(1);
        expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "CHAT_MESSAGE_REMOVED"))).toHaveLength(1);
        expect((await request(narrow.app).patch(`/api/v1/t/${tenant.slug}/admin/members/${c.membership.id}/role`).set(admin.headers).send({ role: "MEMBER" })).status).toBe(200);

        expect((await chat(b).block(a.membership.id)).status).toBe(201);
        expect((await chat(a).send(id, "Withheld")).status).toBe(201);
        expect((await chat(b).unblock(a.membership.id)).status).toBe(204);
        expect((await chat(b).block(leaving.membership.id)).status).toBe(201);
        expect((await chat(leaving).direct(b.membership.id, "First, withheld")).status).toBe(201);

        expect((await request(narrow.app).post("/api/v1/me/delete").set(leaving.headers).send({ confirm: true })).status).toBeLessThan(300);

        const { conversationId } = await runInTransaction(narrow, (tx) => openDirectFromOrigin(narrow, tx, { tenantId: tenant.id, aId: a.membership.id, bId: c.membership.id, origin: "MENTORSHIP", originId: "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81", seedMessage: { senderMembershipId: a.membership.id, body: "A note" } }));
        expect(await runInTransaction(narrow, (tx) => closeOriginConversation(narrow, tx, { tenantId: tenant.id, conversationId, hasOtherLiveConnection: false }))).toBe(true);
      } finally {
        await pool.end();
      }
    }, 30_000);

    it("gets through ten at once holding all ten connections, which using ctx.db inside would freeze", async () => {
      const { tenant } = await setup();
      const members = await Promise.all(Array.from({ length: 11 }, () => bareMember(ctx, tenant.id)));
      const ten = members.slice(1);
      let inside = 0;
      let release!: () => void;
      const allInside = new Promise<void>((resolve) => (release = resolve));
      const outcome = Promise.all(
        ten.map((m, i) =>
          runInTransaction(ctx, async (tx) => {
            await tx.execute(sql`select 1`);
            inside += 1;
            if (inside === ten.length) release();
            await allInside;
            return openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: members[0]!.id, bId: m.id, origin: "REFERRAL", originId: `4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a${String(i).padStart(2, "0")}`, seedMessage: { senderMembershipId: m.id, body: "Note" } });
          }),
        ),
      );
      const results = await outcome;
      expect(new Set(results.map((r) => r.conversationId)).size).toBe(10);
    }, 15_000);

    it("gives up on a held row lock with a 503 instead of holding a connection, and a retry then works", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const holder = new pg.Client({ connectionString: ctx.config.DATABASE_URL });
      await holder.connect();
      const key = newKey();
      try {
        await holder.query("begin");
        await holder.query("select 1 from chat_conversations where id = $1 for update", [id]);
        const started = Date.now();
        const res = await chat(a).send(id, "Waiting", key);
        expect(res.status).toBe(503);
        expect(res.body.error.message).not.toContain("lock");
        expect(Date.now() - started).toBeLessThan(9000);
        await holder.query("rollback");
        expect((await chat(a).send(id, "Waiting", key)).status).toBe(201);
      } finally {
        await holder.end();
      }
    }, 20_000);
  });
});
