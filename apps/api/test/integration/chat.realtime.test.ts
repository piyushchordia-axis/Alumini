import type { ChatChangedEvent, ChatConversationDto, ChatDirectResultDto, ChatMessageDto, ChatMessageEvent, ChatReadEvent, ChatRemovedEvent, ChatUnreadEvent } from "@illuminize/shared";
import { chatKeys, createChatSync, highestSeq, type ChatMessagePages } from "@illuminize/shared/chat";
import { createApiClient, MemoryTokenStorage } from "@illuminize/shared/client";
import { createRealtimeClient } from "@illuminize/shared/realtime";
import { QueryClient } from "@tanstack/query-core";
import { eq } from "drizzle-orm";
import type { Socket } from "socket.io-client";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatMessages, memberships } from "../../src/db/schema";
import { runInTransaction } from "../../src/lib/transaction";
import { lockConversation } from "../../src/repositories/chat.repo";
import { appendMessage, chatRecipients, publishRemoved } from "../../src/services/chat/fanout";
import { acceptedThread, chatApi, createGroup, groupsApi, newKey, openRequest, type Session } from "../helpers/chat";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { connect, next, openSockets, startServer, waitForRoom, type Harness } from "../helpers/realtimeHarness";
import { isDatabaseAvailable } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** Everything a socket hears, so a test can show what it didn't. */
function heard(socket: Socket) {
  const events: Array<{ event: string; payload: unknown }> = [];
  socket.onAny((event: string, payload: unknown) => events.push({ event, payload }));
  return events;
}

const settle = () => new Promise((r) => setTimeout(r, 120));

describe.skipIf(!dbAvailable)("chat over real sockets", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer();
  });
  beforeEach(async () => {
    await h.ctx.truncateAll();
  });
  afterEach(() => {
    openSockets.splice(0).forEach((s) => s.disconnect());
  });
  afterAll(async () => {
    await h.close();
  });

  async function setup() {
    const { tenant } = await createTenant(h.ctx);
    const a = await memberSession(h.ctx, tenant.id);
    const b = await memberSession(h.ctx, tenant.id);
    const chat = (m: Session) => chatApi(h.ctx, tenant.slug, m);
    return { tenant, a, b, chat };
  }
  const live = async (m: Pick<Session, "token" | "user">, expected = 1) => {
    const socket = await connect(h.baseUrl, m.token);
    await waitForRoom(h, m.user.id, expected);
    return socket;
  };

  it("delivers to the other member and the sender's other device, with the client key only on the sender's copy", async () => {
    const { tenant, a, b, chat } = await setup();
    const outsider = await memberSession(h.ctx, tenant.id);
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    const peer = await live(b);
    const device = await live(a);
    const stranger = heard(await live(outsider));

    const atPeer = next<ChatMessageEvent>(peer, "chat:message");
    const atDevice = next<ChatMessageEvent>(device, "chat:message");
    const key = newKey();
    const sent = await chat(a).send(id, "Live", key);

    const delivered = await atPeer;
    expect(delivered).toMatchObject({ tenantSlug: tenant.slug, conversationId: id, message: { id: sent.body.data.id, body: "Live", seq: 2, clientKey: null, sender: { id: a.membership.id } } });
    expect((await atDevice).message).toEqual(sent.body.data);
    expect(sent.body.data.clientKey).toBe(key);
    expect(JSON.stringify(delivered)).not.toContain("withheld");
    await settle();
    expect(stranger).toEqual([]);
  });

  it("tells a request's recipient only that something changed, never what it says", async () => {
    const { tenant, a, b } = await setup();
    const device = await live(a);
    const recipient = await live(b);
    const events = heard(recipient);
    const changed = next<ChatChangedEvent>(recipient, "chat:changed");
    const echo = next<ChatMessageEvent>(device, "chat:message");
    const { conversation } = await openRequest(h.ctx, tenant.slug, a, b.membership.id, "A secret first line");
    expect(await changed).toEqual({ tenantSlug: tenant.slug, conversationId: conversation.id });
    expect((await echo).message.body).toBe("A secret first line");
    await settle();
    expect(events.map((e) => e.event)).toEqual(["chat:changed"]);
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("sends chat:changed to both sides on accept, which then opens normal delivery", async () => {
    const { tenant, a, b, chat } = await setup();
    const { conversation } = await openRequest(h.ctx, tenant.slug, a, b.membership.id);
    const requester = await live(a);
    const recipient = await live(b);
    const atRequester = next<ChatChangedEvent>(requester, "chat:changed");
    const atRecipient = next<ChatChangedEvent>(recipient, "chat:changed");
    await chat(b).accept(conversation.id);
    expect(await atRequester).toEqual({ tenantSlug: tenant.slug, conversationId: conversation.id });
    expect(await atRecipient).toEqual({ tenantSlug: tenant.slug, conversationId: conversation.id });

    const message = next<ChatMessageEvent>(recipient, "chat:message");
    await chat(a).send(conversation.id, "Now it goes through");
    expect((await message).message.body).toBe("Now it goes through");
  });

  it("sends a decline to nobody but the member declining", async () => {
    const { tenant, a, b, chat } = await setup();
    const { conversation } = await openRequest(h.ctx, tenant.slug, a, b.membership.id);
    const requester = heard(await live(a));
    const recipient = await live(b);
    const changed = next<ChatChangedEvent>(recipient, "chat:changed");
    const unread = next<ChatUnreadEvent>(recipient, "chat:unread");
    await chat(b).decline(conversation.id);
    await changed;
    expect(await unread).toEqual({ tenantSlug: tenant.slug, membershipId: b.membership.id, unread: 0, requests: 0, invites: 0 });
    await settle();
    expect(requester).toEqual([]);
  });

  it("sends chat:read and chat:unread to the reader's own devices only, because there are no read receipts", async () => {
    const { tenant, a, b, chat } = await setup();
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    await chat(a).send(id, "Read me");
    const sender = heard(await live(a));
    const otherDevice = await live(b);
    const read = next<ChatReadEvent>(otherDevice, "chat:read");
    const unread = next<ChatUnreadEvent>(otherDevice, "chat:unread");
    await chat(b).read(id, 2);
    expect(await read).toEqual({ tenantSlug: tenant.slug, conversationId: id, membershipId: b.membership.id, lastReadSeq: 2 });
    expect(await unread).toEqual({ tenantSlug: tenant.slug, membershipId: b.membership.id, unread: 0, requests: 0, invites: 0 });
    await settle();
    expect(sender).toEqual([]);
  });

  it("sends chat:removed to participants, and not to anyone suspended or outside", async () => {
    const { tenant, a, b, chat } = await setup();
    const c = await memberSession(h.ctx, tenant.id);
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    const { body } = await chat(a).send(id, "To be removed");
    const sender = await live(a);
    const suspended = heard(await live(b));
    const stranger = heard(await live(c));
    await h.ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
    const removed = next<ChatRemovedEvent>(sender, "chat:removed");
    const [row] = await h.ctx.db.select().from(chatMessages).where(eq(chatMessages.id, body.data.id));
    await publishRemoved(h.ctx, h.ctx.db, tenant.slug, row!);
    expect(await removed).toEqual({ tenantSlug: tenant.slug, conversationId: id, messageId: body.data.id, seq: body.data.seq });
    await settle();
    expect(suspended).toEqual([]);
    expect(stranger).toEqual([]);
  });

  it("keeps a blocked member's messages on their own devices", async () => {
    const { tenant, a, b, chat } = await setup();
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    await chat(b).block(a.membership.id);
    const sendersDevice = await live(a);
    const blocker = heard(await live(b));
    const echo = next<ChatMessageEvent>(sendersDevice, "chat:message");
    await chat(a).send(id, "Withheld");
    expect((await echo).message.body).toBe("Withheld");
    await settle();
    expect(blocker).toEqual([]);
  });

  it("stops delivering to a member an admin suspends, while their socket survives for their other institution", async () => {
    const { tenant, a, b, chat } = await setup();
    const admin = await memberSession(h.ctx, tenant.id, { role: "TENANT_ADMIN" });
    const elsewhere = (await createTenant(h.ctx, { slug: `elsewhere-${Date.now()}` })).tenant;
    const bElsewhere: Session = { ...b, membership: await createMembership(h.ctx, elsewhere.id, b.user.id) };
    const peerElsewhere = await memberSession(h.ctx, elsewhere.id);
    const here = await acceptedThread(h.ctx, tenant.slug, a, b);
    const there = await acceptedThread(h.ctx, elsewhere.slug, peerElsewhere, bElsewhere);

    const socket = await live(b);
    const events = heard(socket);
    const toldOfSuspension = next(socket, "notification:new");
    const res = await request(h.ctx.app).post(`/api/v1/t/${tenant.slug}/admin/members/${b.membership.id}/suspend`).set(admin.headers).send({ reason: "Testing" });
    expect(res.status).toBeLessThan(300);
    await h.ctx.jobs.drain();
    await toldOfSuspension;
    events.splice(0);

    // A send to them is refused, and a message that got past that check doesn't reach them either.
    expect((await chat(a).send(here, "Refused")).status).toBe(409);
    await runInTransaction(h.ctx, async (tx) => {
      const conversation = await lockConversation(tx, tenant.id, here);
      await appendMessage(h.ctx, tx, { tenantSlug: tenant.slug, conversation: conversation!, sender: a.membership, body: "Past the check" });
    });
    expect((await chatRecipients(h.ctx.db, here)).map((r) => r.membershipId)).toEqual([a.membership.id]);
    await settle();
    expect(events).toEqual([]);
    expect(socket.connected).toBe(true);

    const fromElsewhere = next<ChatMessageEvent>(socket, "chat:message");
    await chatApi(h.ctx, elsewhere.slug, peerElsewhere).send(there, "Still here");
    expect(await fromElsewhere).toMatchObject({ tenantSlug: elsewhere.slug, conversationId: there, message: { body: "Still here" } });

    // Reinstated, delivery comes back with no reconnect.
    await h.ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, b.membership.id));
    const back = next<ChatMessageEvent>(socket, "chat:message");
    await chat(a).send(here, "Welcome back");
    expect((await back).message.body).toBe("Welcome back");
  });

  it("names the right institution on every event for someone in two", async () => {
    const one = (await createTenant(h.ctx, { slug: "chat-one" })).tenant;
    const two = (await createTenant(h.ctx, { slug: "chat-two" })).tenant;
    const user = await createUser(h.ctx);
    const session = await loginAs(h.ctx, user.phoneE164);
    const inOne: Session = { user, membership: await createMembership(h.ctx, one.id, user.id), token: session.accessToken, headers: auth(session.accessToken) };
    const inTwo: Session = { ...inOne, membership: await createMembership(h.ctx, two.id, user.id) };
    const peerOne = await memberSession(h.ctx, one.id);
    const peerTwo = await memberSession(h.ctx, two.id);
    const threadOne = await acceptedThread(h.ctx, one.slug, peerOne, inOne);
    const threadTwo = await acceptedThread(h.ctx, two.slug, peerTwo, inTwo);

    const socket = await live(inOne);
    const first = next<ChatMessageEvent>(socket, "chat:message");
    await chatApi(h.ctx, one.slug, peerOne).send(threadOne, "In one");
    expect(await first).toMatchObject({ tenantSlug: "chat-one", conversationId: threadOne });
    const second = next<ChatMessageEvent>(socket, "chat:message");
    await chatApi(h.ctx, two.slug, peerTwo).send(threadTwo, "In two");
    expect(await second).toMatchObject({ tenantSlug: "chat-two", conversationId: threadTwo });
  });

  it("recovers what was sent while offline through afterSeq, in order and without gaps", async () => {
    const { tenant, a, b, chat } = await setup();
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    const socket = await live(b);
    const first = next<ChatMessageEvent>(socket, "chat:message");
    await chat(a).send(id, "Online");
    const highest = (await first).message.seq;

    const events = heard(socket);
    socket.disconnect();
    await chat(a).send(id, "Offline one");
    await chat(a).send(id, "Offline two");
    expect(events).toEqual([]);

    socket.connect();
    await waitForRoom(h, b.user.id, 1);
    const missed = await chat(b).messages(id, { afterSeq: highest });
    expect((missed.body.data as ChatMessageDto[]).map((m) => m.body)).toEqual(["Offline one", "Offline two"]);
    expect((missed.body.data as ChatMessageDto[]).map((m) => m.seq)).toEqual([highest + 1, highest + 2]);
  });

  it("ignores anything a client emits: writes go over REST", async () => {
    const { tenant, a, b } = await setup();
    const id = await acceptedThread(h.ctx, tenant.slug, a, b);
    const sender = await live(a);
    const peer = heard(await live(b));
    sender.emit("chat:message", { tenantSlug: tenant.slug, conversationId: id, message: { body: "Forged" } });
    sender.emit("chat:typing", { conversationId: id });
    sender.emit("chat:join", { conversationId: id });
    await settle();
    expect(peer).toEqual([]);
    expect(sender.connected).toBe(true);
    expect(await h.ctx.db.select().from(chatMessages).where(eq(chatMessages.body, "Forged"))).toEqual([]);
  });

  describe("in a group", () => {
    /** An open group a owns, with b and c in it, and d in the institution but not the group. */
    async function groupSetup() {
      const s = await setup();
      const c = await memberSession(h.ctx, s.tenant.id);
      const d = await memberSession(h.ctx, s.tenant.id);
      const groups = (m: Session) => groupsApi(h.ctx, s.tenant.slug, m);
      const group = await createGroup(h.ctx, s.tenant.slug, s.a, { name: "Live room" });
      for (const m of [s.b, c]) await groups(m).join(group.id);
      return { ...s, c, d, groups, group };
    }
    const events = (log: Array<{ event: string; payload: unknown }>, name: string) => log.filter((e) => e.event === name).map((e) => e.payload);

    it("delivers a message to every member and the sender's other devices, and to nobody outside it, gone from it, or who blocked the sender", async () => {
      const { tenant, a, b, c, d, chat, groups, group } = await groupSetup();
      const leaver = await memberSession(h.ctx, tenant.id);
      await groups(leaver).join(group.id);
      await groups(leaver).leave(group.id);
      await chat(c).block(b.membership.id);
      const atOwner = await live(a);
      const senderDevice = await live(b);
      const blocker = heard(await live(c));
      const outsider = heard(await live(d));
      const gone = heard(await live(leaver));

      const atA = next<ChatMessageEvent>(atOwner, "chat:message");
      const echo = next<ChatMessageEvent>(senderDevice, "chat:message");
      const key = newKey();
      const sent = await chat(b).send(group.id, "For the room", key);
      expect(await atA).toMatchObject({ tenantSlug: tenant.slug, conversationId: group.id, message: { body: "For the room", sender: { id: b.membership.id }, clientKey: null, redacted: false } });
      expect((await echo).message).toEqual(sent.body.data);
      await settle();
      expect(blocker).toEqual([]);
      expect(outsider).toEqual([]);
      expect(gone).toEqual([]);
    });

    it("tells a member who leaves or is removed on their own devices, and everyone still in it, and keeps their badge right", async () => {
      const { a, b, c, chat, groups, group } = await groupSetup();
      const leaving = await live(b);
      const staying = heard(await live(a));
      const leftChanged = next<ChatChangedEvent>(leaving, "chat:changed");
      const leftBadge = next<ChatUnreadEvent>(leaving, "chat:unread");
      await groups(b).leave(group.id);
      expect(await leftChanged).toMatchObject({ conversationId: group.id });
      expect(await leftBadge).toMatchObject({ membershipId: b.membership.id, unread: 0 });
      await settle();
      expect(events(staying, "chat:changed")).toEqual([expect.objectContaining({ conversationId: group.id })]);
      expect(events(staying, "chat:message")).toEqual([expect.objectContaining({ message: expect.objectContaining({ kind: "SYSTEM", meta: { event: "LEFT" }, sender: expect.objectContaining({ id: b.membership.id }) }) })]);

      const removed = await live(c);
      const removedChanged = next<ChatChangedEvent>(removed, "chat:changed");
      await groups(a).remove(group.id, c.membership.id);
      expect(await removedChanged).toMatchObject({ conversationId: group.id });
      // Gone from it, so a message after that is no longer theirs to hear.
      const after = heard(removed);
      await chat(a).send(group.id, "After they went");
      await settle();
      expect(events(after, "chat:message")).toEqual([]);
    });

    it("tells an invitee alone, with their badge, and nobody anything when the invitation is suppressed", async () => {
      const { tenant, a, b, d, groups, group } = await groupSetup();
      const member = heard(await live(b));
      const invitee = await live(d);
      const changed = next<ChatChangedEvent>(invitee, "chat:changed");
      const badge = next<ChatUnreadEvent>(invitee, "chat:unread");
      await groups(a).invite(group.id, [d.membership.id]);
      expect(await changed).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      expect(await badge).toEqual({ tenantSlug: tenant.slug, membershipId: d.membership.id, unread: 0, requests: 0, invites: 1 });

      const accepted = next<ChatUnreadEvent>(invitee, "chat:unread");
      await groups(d).accept(group.id);
      expect((await accepted).invites).toBe(0);
      await settle();
      expect(events(member, "chat:unread")).toEqual([]);

      const blocker = await memberSession(h.ctx, tenant.id);
      await chatApi(h.ctx, tenant.slug, blocker).block(a.membership.id);
      const nothing = heard(await live(blocker));
      await groups(a).invite(group.id, [blocker.membership.id]);
      await settle();
      expect(nothing).toEqual([]);
    });

    it("tells its members when an admin removes it, though they can no longer open it, and again when it's restored", async () => {
      const { tenant, b, group } = await groupSetup();
      const admin = await memberSession(h.ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await live(b);
      const removed = next<ChatChangedEvent>(member, "chat:changed");
      await request(h.ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${group.id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
      expect(await removed).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      const restored = next<ChatChangedEvent>(member, "chat:changed");
      await request(h.ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${group.id}/restore`).set(admin.headers).send({}).expect(200);
      expect(await restored).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
    });

    it("tells members and invitees when a published edit renames it, and the new owner when a suspension hands it over", async () => {
      const { tenant, a, b, d, groups, group } = await groupSetup();
      await groups(a).invite(group.id, [d.membership.id]);
      const member = await live(b);
      const invitee = await live(d);
      const atMember = next<ChatChangedEvent>(member, "chat:changed");
      const atInvitee = next<ChatChangedEvent>(invitee, "chat:changed");
      // Approved at once here, so what everyone sees changes with it.
      expect((await groups(a).edit(group.id, { name: "Live room, renamed" })).body.data.review).toMatchObject({ moderationStatus: "APPROVED" });
      expect(await atMember).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      expect(await atInvitee).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });

      const admin = await memberSession(h.ctx, tenant.id, { role: "TENANT_ADMIN" });
      const handedOver = next<ChatChangedEvent>(member, "chat:changed");
      const suspended = await request(h.ctx.app).post(`/api/v1/t/${tenant.slug}/admin/members/${a.membership.id}/suspend`).set(admin.headers).send({ reason: "Testing" });
      expect(suspended.status).toBeLessThan(300);
      expect(await handedOver).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ isOwner: true });
    });

    it("tells a waiting invitee when the group is archived, with their invitations counted down", async () => {
      const { tenant, a, d, groups, group } = await groupSetup();
      await groups(a).invite(group.id, [d.membership.id]);
      const invitee = await live(d);
      const changed = next<ChatChangedEvent>(invitee, "chat:changed");
      const badge = next<ChatUnreadEvent>(invitee, "chat:unread");
      await groups(a).archive(group.id);
      expect(await changed).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      expect(await badge).toMatchObject({ membershipId: d.membership.id, invites: 0 });
    });

    it("tells only the blocker's own devices about each group they share with whoever they block or unblock", async () => {
      const { tenant, b, c, chat, group } = await groupSetup();
      const blockerDevice = await live(c);
      const blocked = heard(await live(b));
      const blocking = next<ChatChangedEvent>(blockerDevice, "chat:changed");
      await chat(c).block(b.membership.id);
      expect(await blocking).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      const unblocking = next<ChatChangedEvent>(blockerDevice, "chat:changed");
      await chat(c).unblock(b.membership.id);
      expect(await unblocking).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      await settle();
      expect(blocked).toEqual([]);
    });

    it("keeps a joining member's inbox, and everyone's member count, current", async () => {
      const { tenant, a, d, groups, group } = await groupSetup();
      const joiner = heard(await live(d));
      const owner = await live(a);
      const ownerChanged = next<ChatChangedEvent>(owner, "chat:changed");
      await groups(d).join(group.id);
      expect(await ownerChanged).toEqual({ tenantSlug: tenant.slug, conversationId: group.id });
      await settle();
      expect(events(joiner, "chat:changed")).toEqual([{ tenantSlug: tenant.slug, conversationId: group.id }]);
      expect(events(joiner, "chat:message")).toEqual([expect.objectContaining({ message: expect.objectContaining({ kind: "SYSTEM", meta: { event: "JOINED" } }) })]);
    });
  });
});

describe.skipIf(!dbAvailable)("chat through the shared client", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await startServer({ ACCESS_TOKEN_TTL_SEC: "1" });
  });
  afterEach(() => {
    openSockets.splice(0).forEach((s) => s.disconnect());
  });
  afterAll(async () => {
    await h.close();
  });

  async function client(tenantId: string) {
    const user = await createUser(h.ctx);
    const membership = await createMembership(h.ctx, tenantId, user.id);
    const session = await loginAs(h.ctx, user.phoneE164);
    const storage = new MemoryTokenStorage();
    await storage.setTokens({ accessToken: session.accessToken, refreshToken: session.refreshToken });
    const api = createApiClient({ baseUrl: h.baseUrl, storage });
    return { user, membership, storage, api };
  }

  it("keeps a thread current across token refreshes, catching up on what it missed each time", async () => {
    await h.ctx.truncateAll();
    const { tenant } = await createTenant(h.ctx, { slug: "chat-refresh" });
    const a = await client(tenant.id);
    const b = await client(tenant.id);
    const { conversation } = (await a.api.chat.direct(tenant.slug, { membershipId: b.membership.id, body: "First", clientKey: newKey() })) as ChatDirectResultDto;
    await b.api.chat.accept(tenant.slug, conversation.id);

    const qc = new QueryClient();
    const key = chatKeys.messages(tenant.slug, conversation.id);
    const page = await b.api.chat.messages(tenant.slug, conversation.id);
    qc.setQueryData<ChatMessagePages>(key, { pages: [page], pageParams: [undefined] });

    const realtime = createRealtimeClient({ baseUrl: h.baseUrl, getAccessToken: () => b.storage.getAccessToken(), refresh: () => b.api.core.refresh() });
    let reconnects = 0;
    realtime.onReconnect(() => void (reconnects += 1));
    const sync = createChatSync({ realtime, api: b.api.chat, queryClient: qc, getActive: () => ({ slug: tenant.slug, conversationId: conversation.id }), refillAfterMs: 50 });
    const detach = sync.attach();
    realtime.start();
    const held = () => (qc.getQueryData<ChatMessagePages>(key)?.pages ?? []).flatMap((p) => p.data).map((m) => m.body);

    // Past the 1 second token: the server sends auth:expired, the client refreshes and reconnects, and sync catches up.
    for (let i = 0; i < 80 && reconnects === 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(reconnects).toBeGreaterThanOrEqual(1);
    expect(await b.storage.getAccessToken()).toBeTruthy();

    await a.api.chat.send(tenant.slug, conversation.id, { body: "Across a refresh", clientKey: newKey() });
    for (let i = 0; i < 80 && !held().includes("Across a refresh"); i++) await new Promise((r) => setTimeout(r, 50));
    expect(held()).toContain("Across a refresh");

    // Sent with this client away: nothing live can reach it, so only the reconnect's catch-up can bring it.
    realtime.stop();
    await a.api.chat.send(tenant.slug, conversation.id, { body: "While away", clientKey: newKey() });
    const before = reconnects;
    realtime.start();
    for (let i = 0; i < 80 && (reconnects === before || !held().includes("While away")); i++) await new Promise((r) => setTimeout(r, 50));
    expect(held()).toContain("While away");

    const sent = await sync.send(tenant.slug, conversation.id, "From this client");
    expect(sent).toMatchObject({ body: "From this client" });
    expect(highestSeq(qc.getQueryData<ChatMessagePages>(key))).toBe(sent!.seq);
    const fresh = (await b.api.chat.conversation(tenant.slug, conversation.id)) as ChatConversationDto;
    expect(fresh).toMatchObject({ state: "ACCEPTED" });

    detach();
    realtime.stop();
    qc.clear();
  }, 20_000);
});
