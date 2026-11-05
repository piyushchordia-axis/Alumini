import { CHAT_GROUP_MAX_MEMBERS, CHAT_GROUP_MAX_OWNED, CHAT_GROUP_MAX_PENDING_INVITES, wallPartsInZone, type ChatConversationDto, type ChatGroupDto, type ChatMessageDto } from "@illuminize/shared";
import { and, eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatGroups, chatInviteDeclines, chatMessages, chatParticipants, contentReports, memberships, tenantSettings, users } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { seedConnections, seedCore, seedMembers } from "../../src/db/seed";
import { seedDemoHistory } from "../../src/db/seedDemoHistory";
import { runInTransaction } from "../../src/lib/transaction";
import { findParticipantsWithNews, insertBlock, lockPair } from "../../src/repositories/chat.repo";
import { setGroupModeration } from "../../src/repositories/chatGroups.repo";
import { chatRecipients } from "../../src/services/chat/fanout";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, chatApi, createGroup, groupsApi, openRequest, participantRow, postToGroup, type Session } from "../helpers/chat";
import { createTenant, memberSession, nextId, type TenantFactoryOptions } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("groups", () => {
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

  async function setup(opts: TenantFactoryOptions = {}) {
    const { tenant } = await createTenant(ctx, opts);
    const owner = await memberSession(ctx, tenant.id, { fullName: "Olive Owner" });
    const b = await memberSession(ctx, tenant.id, { fullName: "Bina Member" });
    const c = await memberSession(ctx, tenant.id, { fullName: "Chetan Member" });
    const groups = (m: Session) => groupsApi(ctx, tenant.slug, m);
    const chat = (m: Session) => chatApi(ctx, tenant.slug, m);
    const admin = () => memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", fullName: "Asha Admin" });
    /** As the admin page does it: approving says which name and description it approves, read here as they stand now. */
    const moderate = async (as: Session, id: string, action: "approve" | "reject" | "remove" | "restore", note?: string) => {
      const g = action === "approve" ? await groupRow(id) : null;
      return request(ctx.app)
        .post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${id}/${action}`)
        .set(as.headers)
        .send({ ...(note ? { note } : {}), ...(g ? { reviewed: { name: g.name, description: g.description } } : {}) });
    };
    return { tenant, owner, b, c, groups, chat, admin, moderate };
  }

  const groupRow = async (id: string) => (await ctx.db.select().from(chatGroups).where(eq(chatGroups.conversationId, id)))[0]!;
  const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((g) => g.id);
  const lines = (res: { body: { data: ChatMessageDto[] } }) => [...res.body.data].reverse().map((m) => (m.kind === "SYSTEM" ? `${m.sender?.fullName ?? "?"} ${(m.meta as { event: string }).event}` : m.body));

  /** Members created in one go, for the caps. */
  async function manyMembers(tenantId: string, count: number): Promise<string[]> {
    const created = await ctx.db
      .insert(users)
      .values(Array.from({ length: count }, () => ({ phoneE164: `+9188${String(nextId()).padStart(8, "0")}`, phoneRegion: "IN" })))
      .returning({ id: users.id });
    const rows = await ctx.db
      .insert(memberships)
      .values(created.map((u, i) => ({ tenantId, userId: u.id, status: "APPROVED" as const, role: "MEMBER" as const, fullName: `Bulk ${i}`, batchYear: 2010, professionType: "EMPLOYED" as const, statusChangedAt: new Date() })))
      .returning({ id: memberships.id });
    return rows.map((r) => r.id);
  }

  describe("creating", () => {
    it("under auto-approval is live at once: in Discover, owned by its creator, its only member", async () => {
      const { owner, b, groups } = await setup();
      const res = await groups(owner).create({ name: "  Weekend runners  ", description: "Saturday 7am at the lake.", visibility: "OPEN" });
      expect(res.status).toBe(201);
      const group = res.body.data as ChatGroupDto;
      expect(group).toMatchObject({ name: "Weekend runners", description: "Saturday 7am at the lake.", visibility: "OPEN", memberCount: 1, myState: "ACTIVE", isOwner: true, canSend: true, canInvite: true, canEdit: true, canJoin: false, archived: false });
      expect(group.owner).toMatchObject({ id: owner.membership.id, fullName: "Olive Owner" });
      expect(group.review).toMatchObject({ moderationStatus: "APPROVED", shownToMembers: true, name: "Weekend runners" });
      expect(await participantRow(ctx, group.id, owner.membership.id)).toMatchObject({ state: "ACTIVE", role: "OWNER", joinedSeq: 0 });

      const seen = (await groups(b).list()).body.data as ChatGroupDto[];
      expect(seen.map((g) => g.id)).toEqual([group.id]);
      expect(seen[0]).toMatchObject({ myState: null, isOwner: false, canJoin: true, canSend: false, review: null });
    });

    it("under admin approval is its creator's alone until approved: hidden, 404 to others, no sends or invites", async () => {
      const { tenant, owner, b, groups, chat, admin, moderate } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const reviewer = await admin();
      const group = await createGroup(ctx, tenant.slug, owner, { name: "Startup founders" });
      expect(group).toMatchObject({ name: "Startup founders", canSend: false, canInvite: false, review: { moderationStatus: "PENDING", shownToMembers: false } });
      expect((await chat(owner).get(group.id)).body.data).toMatchObject({ canSend: false, group: { name: "Startup founders", isOwner: true } });
      expect((await groups(owner).invite(group.id, [b.membership.id])).status).toBe(403);

      for (const res of [await groups(b).get(group.id), await groups(b).join(group.id), await groups(b).members(group.id), await chat(b).get(group.id)]) expect(res.status, res.request.url).toBe(404);
      expect(ids(await groups(b).list())).toEqual([]);

      const queue = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/admin/moderation`).query({ contentType: "GROUP" }).set(reviewer.headers);
      expect(queue.body.data).toEqual([expect.objectContaining({ contentType: "GROUP", id: group.id, title: "Startup founders", author: expect.objectContaining({ fullName: "Olive Owner" }) })]);
      const notice = (await request(ctx.app).get(`/api/v1/t/${tenant.slug}/notifications`).set(reviewer.headers)).body.data[0];
      expect(notice).toMatchObject({ type: "CONTENT_PENDING", title: "New group awaiting approval", data: { contentType: "GROUP", contentId: group.id } });

      expect((await moderate(reviewer, group.id, "approve")).status).toBe(200);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ name: "Startup founders", canJoin: true });
      expect((await groups(b).join(group.id)).status).toBe(200);
      expect((await groups(owner).get(group.id)).body.data).toMatchObject({ canSend: true, canInvite: true, memberCount: 2, review: { moderationStatus: "APPROVED", shownToMembers: true } });
    });

    it("checks its name, description and visibility", async () => {
      const { owner, groups } = await setup();
      for (const body of [{ name: "ab", visibility: "OPEN" }, { name: "Fine name", visibility: "SECRET" }, { name: "Fine name" }, { name: "Fine name", visibility: "OPEN", description: "x".repeat(501) }, { name: "​​​​", visibility: "OPEN" }]) {
        expect((await groups(owner).create(body)).status, JSON.stringify(body)).toBe(400);
      }
      const longest = await groups(owner).create({ name: "n".repeat(80), visibility: "OPEN", description: "d".repeat(500) });
      expect(longest.status).toBe(201);
      expect((await groups(owner).create({ name: "Empty description", visibility: "OPEN", description: "   " })).body.data.description).toBeNull();
    });

    it(`caps the groups a member owns at ${CHAT_GROUP_MAX_OWNED}, counting archived ones out, even when creates race`, async () => {
      const { tenant, owner, groups } = await setup();
      const made = [];
      for (let i = 0; i < CHAT_GROUP_MAX_OWNED - 1; i += 1) made.push(await createGroup(ctx, tenant.slug, owner, { name: `Group number ${i}` }));
      const raced = await Promise.all([1, 2, 3].map((n) => groups(owner).create({ name: `Racing ${n}`, visibility: "OPEN" })));
      expect(raced.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      expect((await groups(owner).create({ name: "One too many", visibility: "OPEN" })).status).toBe(409);
      await groups(owner).archive(made[0]!.id);
      expect((await groups(owner).create({ name: "Room again", visibility: "OPEN" })).status).toBe(201);
    });
  });

  describe("visibility", () => {
    it("can't be changed after creation, so an invite-only group's history can never be opened up", async () => {
      const { tenant, owner, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      for (const body of [{ visibility: "OPEN" }, { name: "Renamed", visibility: "OPEN" }, {}, { name: "Renamed", archived: true }]) {
        expect((await groups(owner).edit(group.id, body)).status, JSON.stringify(body)).toBe(400);
      }
      expect(await groupRow(group.id)).toMatchObject({ visibility: "INVITE_ONLY", name: group.name, archivedAt: null });
    });
  });

  describe("joining, leaving and history", () => {
    it("an open group: joining shows the whole history, leaving takes it away, and a member who left may come back", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      await postToGroup(ctx, tenant, group.id, owner, "Before anyone joined");

      const joined = await groups(b).join(group.id);
      expect(joined.status).toBe(200);
      expect(joined.body.data).toMatchObject({ myState: "ACTIVE", memberCount: 2, canSend: true, canLeave: true, canJoin: false });
      expect(lines(await chat(b).messages(group.id))).toEqual(["Before anyone joined", "Bina Member JOINED"]);
      const row = ((await chat(b).list()).body.data as ChatConversationDto[]).find((t) => t.id === group.id);
      expect(row).toMatchObject({ kind: "GROUP", origin: "GROUP", peer: null, state: "ACCEPTED", unread: 0, group: { name: group.name, visibility: "OPEN", memberCount: 2, archived: false, isOwner: false } });
      expect((await groups(b).join(group.id)).status).toBe(200);
      expect((await groupRow(group.id)).memberCount).toBe(2);

      expect((await groups(b).leave(group.id)).status).toBe(204);
      expect((await chat(b).get(group.id)).status).toBe(404);
      expect((await chat(b).messages(group.id)).status).toBe(404);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ myState: "LEFT", canJoin: true, memberCount: 1 });
      expect((await groups(b).leave(group.id)).status).toBe(409);

      expect((await groups(b).join(group.id)).body.data).toMatchObject({ myState: "ACTIVE", memberCount: 2 });
      expect(lines(await chat(owner).messages(group.id))).toEqual(["Before anyone joined", "Bina Member JOINED", "Bina Member LEFT", "Bina Member JOINED"]);
    });

    it("a removed member needs an invitation to come back", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      await groups(b).join(group.id);
      expect((await groups(owner).remove(group.id, b.membership.id)).status).toBe(204);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ myState: "REMOVED", canJoin: false });
      expect((await chat(b).get(group.id)).status).toBe(404);
      expect((await groups(b).join(group.id)).status).toBe(409);
      expect((await groups(owner).remove(group.id, b.membership.id)).status).toBe(404);

      expect((await groups(owner).invite(group.id, [b.membership.id])).status).toBe(201);
      expect((await groups(b).accept(group.id)).body.data).toMatchObject({ myState: "ACTIVE", memberCount: 2 });
      expect(lines(await chat(owner).messages(group.id))).toEqual(["Bina Member JOINED", "Bina Member REMOVED", "Bina Member JOINED"]);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ removedAt: null });
      // Back in through an invitation, and free to leave and come back like anyone else.
      await groups(b).leave(group.id);
      expect((await groups(b).join(group.id)).status).toBe(200);
    });

    it("an invitation the removed member never saw, declined or let lapse doesn't let them back in", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      for (const m of [b, c]) await groups(m).join(group.id);
      await groups(owner).remove(group.id, b.membership.id);
      const stillRemoved = async () => {
        expect((await groups(b).get(group.id)).body.data).toMatchObject({ myState: "REMOVED", canJoin: false });
        const refused = await groups(b).join(group.id);
        expect(refused.status).toBe(409);
        expect(refused.body.error.message).toContain("removed");
      };

      // Bina blocked Chetan, so his invitation is held back from her: nothing about it may show, least of all a way in.
      await chat(b).block(c.membership.id);
      expect((await groups(c).invite(group.id, [b.membership.id])).status).toBe(201);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ state: "INVITED", inviteSuppressed: true, removedAt: expect.any(Date) });
      await stillRemoved();

      // An invitation she can see, declined.
      expect((await groups(owner).invite(group.id, [b.membership.id])).status).toBe(201);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ myState: "INVITED", canJoin: true });
      await groups(b).decline(group.id);
      await stillRemoved();

      // One she let lapse.
      await ctx.db.delete(chatInviteDeclines);
      await groups(owner).invite(group.id, [b.membership.id]);
      await ctx.db.update(chatParticipants).set({ invitedAt: new Date(Date.now() - 31 * 86_400_000) }).where(and(eq(chatParticipants.conversationId, group.id), eq(chatParticipants.membershipId, b.membership.id)));
      await stillRemoved();

      // Only one she can see lets her back, by accepting or by joining while it's open.
      await groups(owner).invite(group.id, [b.membership.id]);
      expect((await groups(b).join(group.id)).body.data).toMatchObject({ myState: "ACTIVE" });
    });

    it("an invite-only group shows each member the history from when they joined, and nothing before it, not even in the inbox", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await postToGroup(ctx, tenant, group.id, owner, "Secret plans");
      await postToGroup(ctx, tenant, group.id, owner, "More secret plans");
      await groups(owner).invite(group.id, [b.membership.id]);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ myState: "INVITED", canJoin: false });
      expect((await chat(b).get(group.id)).status).toBe(404);

      expect((await groups(b).accept(group.id)).status).toBe(200);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ joinedSeq: 2, lastReadSeq: 3 });
      expect(lines(await chat(b).messages(group.id))).toEqual(["Bina Member JOINED"]);
      expect(lines(await chat(b).messages(group.id, { afterSeq: "0" }))).toEqual(["Bina Member JOINED"]);
      await postToGroup(ctx, tenant, group.id, owner, "Welcome, Bina");
      expect(lines(await chat(b).messages(group.id))).toEqual(["Bina Member JOINED", "Welcome, Bina"]);
      expect(lines(await chat(owner).messages(group.id))).toEqual(["Secret plans", "More secret plans", "Bina Member JOINED", "Welcome, Bina"]);
    });

    it("hides the last message from before an invite-only member joined from their inbox preview", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await groups(owner).invite(group.id, [b.membership.id]);
      await postToGroup(ctx, tenant, group.id, owner, "Said before Bina was in");
      // Joining writes a line of its own, so take it out to see what the preview would fall back on.
      await groups(b).accept(group.id);
      await ctx.db.execute(sql`delete from chat_messages where conversation_id = ${group.id} and kind = 'SYSTEM'`);
      const row = ((await chat(b).list()).body.data as ChatConversationDto[]).find((t) => t.id === group.id)!;
      expect(row.lastMessage).toBeNull();
      expect(JSON.stringify((await chat(b).get(group.id)).body)).not.toContain("Said before Bina was in");
    });

    it("an archived group is read-only for its members and gone from Discover", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      await groups(b).join(group.id);
      expect((await groups(b).archive(group.id)).status).toBe(403);
      const archived = await groups(owner).archive(group.id);
      expect(archived.body.data).toMatchObject({ archived: true, canSend: false, canInvite: false, canEdit: false });
      expect((await groups(owner).archive(group.id)).status).toBe(200);
      expect(ids(await groups(c).list())).toEqual([]);
      for (const res of [await groups(c).get(group.id), await groups(c).join(group.id)]) expect(res.status, res.request.url).toBe(404);
      expect((await chat(b).get(group.id)).body.data).toMatchObject({ canSend: false, group: { archived: true } });
      expect(lines(await chat(b).messages(group.id)).at(-1)).toBe("Olive Owner ARCHIVED");
      expect((await groups(owner).edit(group.id, { name: "Too late" })).status).toBe(409);
      expect((await groups(owner).invite(group.id, [c.membership.id])).status).toBe(403);
      expect((await groups(owner).remove(group.id, b.membership.id)).status).toBe(409);
      expect((await groups(b).leave(group.id)).status).toBe(204);
    });

    it("passes ownership to the longest-standing approved member when the owner leaves, and archives the group once nobody is left", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      await groups(b).join(group.id);
      await groups(c).join(group.id);
      // Bina has been in longer, but she's suspended, so it goes past her.
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      expect((await groups(owner).leave(group.id)).status).toBe(204);
      expect((await groupRow(group.id)).ownerMembershipId).toBe(c.membership.id);
      expect((await groups(c).get(group.id)).body.data).toMatchObject({ isOwner: true, canEdit: true, memberCount: 2, owner: { id: c.membership.id } });
      expect((await groups(c).members(group.id)).body.data.find((m: { isMe: boolean }) => m.isMe)).toMatchObject({ role: "OWNER" });
      expect(lines(await chat(c).messages(group.id)).slice(-2)).toEqual(["Olive Owner LEFT", "Chetan Member OWNER_CHANGED"]);
      const owners = await ctx.db.select().from(chatParticipants).where(and(eq(chatParticipants.conversationId, group.id), eq(chatParticipants.role, "OWNER")));
      expect(owners.map((p) => p.membershipId)).toEqual([c.membership.id]);

      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, b.membership.id));
      await groups(c).leave(group.id);
      expect((await groupRow(group.id)).ownerMembershipId).toBe(b.membership.id);
      await groups(b).leave(group.id);
      expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: null, memberCount: 0, archivedAt: expect.any(Date) });
      expect((await groups(b).get(group.id)).status).toBe(404);
    });

    it("leaves the new owner's unread messages unread, so the badge and their push still say there's news", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      for (const m of [b, c]) await groups(m).join(group.id);
      await chat(c).send(group.id, "One");
      await chat(c).send(group.id, "Two");
      expect((await chat(b).get(group.id)).body.data.unread).toBe(2);
      await groups(owner).leave(group.id);
      expect((await groupRow(group.id)).ownerMembershipId).toBe(b.membership.id);
      expect((await chat(b).get(group.id)).body.data.unread).toBe(2);
      expect((await chat(b).badge()).body.data.unread).toBe(1);
      expect(await findParticipantsWithNews(ctx.db, group.id, [b.membership.id], new Date())).toEqual([b.membership.id]);
    });

    it("never passes a group to a current pupil, and archives one only a pupil is left in", async () => {
      const zone = "Asia/Kolkata";
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true, groups: true } });
      const year = wallPartsInZone(new Date(), zone).year;
      const groups = (m: Session) => groupsApi(ctx, tenant.slug, m);
      const owner = await memberSession(ctx, tenant.id, { batchYear: 2000, fullName: "Owner" });
      const later = await memberSession(ctx, tenant.id, { batchYear: 2001, fullName: "Now a pupil" });
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2002, fullName: "Alum" });
      const shared = await createGroup(ctx, tenant.slug, owner, { name: "Shared room" });
      const theirs = await createGroup(ctx, tenant.slug, owner, { name: "Pupil's room" });
      for (const m of [later, alum]) await groups(m).join(shared.id);
      await groups(later).join(theirs.id);
      // Longest in both, then a batch year in the future makes them a current pupil.
      await ctx.db.update(memberships).set({ batchYear: year + 1 }).where(eq(memberships.id, later.membership.id));
      await groups(owner).leave(shared.id);
      await groups(owner).leave(theirs.id);
      expect((await groupRow(shared.id)).ownerMembershipId).toBe(alum.membership.id);
      expect(await groupRow(theirs.id)).toMatchObject({ ownerMembershipId: null, archivedAt: expect.any(Date) });
    });

    it(`caps a group at ${CHAT_GROUP_MAX_MEMBERS} members, even when joins race`, async () => {
      const { tenant, owner, b, c, groups } = await setup();
      const d = await memberSession(ctx, tenant.id);
      const group = await createGroup(ctx, tenant.slug, owner);
      await ctx.db.update(chatGroups).set({ memberCount: CHAT_GROUP_MAX_MEMBERS - 1 }).where(eq(chatGroups.conversationId, group.id));
      const raced = await Promise.all([b, c, d].map((m) => groups(m).join(group.id)));
      expect(raced.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect((await groupRow(group.id)).memberCount).toBe(CHAT_GROUP_MAX_MEMBERS);
      const refused = raced.find((r) => r.status === 409)!;
      expect(refused.body.error.message).toContain(`${CHAT_GROUP_MAX_MEMBERS}`);
    });
  });

  describe("who may do what", () => {
    it("the owner edits, invites, removes and archives; a member sends, leaves, and invites only to an open group", async () => {
      const { tenant, owner, b, c, groups } = await setup();
      const open = await createGroup(ctx, tenant.slug, owner, { name: "Open room" });
      const closed = await createGroup(ctx, tenant.slug, owner, { name: "Closed room", visibility: "INVITE_ONLY" });
      await groups(b).join(open.id);
      await groups(owner).invite(closed.id, [b.membership.id]);
      await groups(b).accept(closed.id);

      expect((await groups(b).get(open.id)).body.data).toMatchObject({ canInvite: true, canEdit: false, canSend: true, canLeave: true });
      expect((await groups(b).get(closed.id)).body.data).toMatchObject({ canInvite: false, canEdit: false });
      expect((await groups(b).invite(open.id, [c.membership.id])).status).toBe(201);
      expect((await groups(b).invite(closed.id, [c.membership.id])).status).toBe(403);
      expect((await groups(b).candidates(closed.id)).status).toBe(403);
      for (const res of [await groups(b).edit(open.id, { name: "Mine now" }), await groups(b).archive(open.id), await groups(b).remove(open.id, owner.membership.id)]) expect(res.status, res.request.url).toBe(403);
      expect((await groups(owner).remove(open.id, owner.membership.id)).status).toBe(400);
      expect((await groups(owner).edit(open.id, { name: "Open room, renamed" })).body.data).toMatchObject({ name: "Open room, renamed" });
    });
  });

  describe("an invite-only group", () => {
    it("answers 404, never 403, to anyone who isn't in it or invited, on every route, POST /reports included", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await groups(owner).invite(group.id, [b.membership.id]);
      await groups(b).accept(group.id);
      const outsider = groups(c);
      for (const res of [
        await outsider.get(group.id),
        await outsider.members(group.id),
        await outsider.candidates(group.id),
        await outsider.join(group.id),
        await outsider.leave(group.id),
        await outsider.invite(group.id, [owner.membership.id]),
        await outsider.accept(group.id),
        await outsider.decline(group.id),
        await outsider.remove(group.id, b.membership.id),
        await outsider.edit(group.id, { name: "Hijacked" }),
        await outsider.archive(group.id),
        await outsider.report(group.id),
        await chat(c).get(group.id),
        await chat(c).messages(group.id),
        await chat(c).read(group.id, 1),
        await chat(c).mute(group.id, null),
      ]) {
        expect(res.status, res.request.url).toBe(404);
      }
      expect(ids(await outsider.list())).toEqual([]);
      expect(ids(await groups(b).list())).toEqual([]);
      expect(await ctx.db.select().from(contentReports)).toEqual([]);
      // Its members can report it, and its owner can't report their own.
      expect((await groups(b).report(group.id)).status).toBe(201);
      expect((await groups(owner).report(group.id)).status).toBe(400);
    });

    it("lets a pending invitee see it, until they decline", async () => {
      const { tenant, owner, b, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY", name: "Reunion committee" });
      await groups(owner).invite(group.id, [b.membership.id]);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ name: "Reunion committee", myState: "INVITED" });
      expect((await groups(b).members(group.id)).body.data.map((m: { member: { id: string } }) => m.member.id)).toEqual([owner.membership.id]);
      const invites = (await groups(b).invites()).body.data;
      expect(invites).toEqual([expect.objectContaining({ group: expect.objectContaining({ id: group.id, myState: "INVITED" }), invitedBy: expect.objectContaining({ id: owner.membership.id }) })]);
      expect((await groups(b).decline(group.id)).status).toBe(204);
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect((await groups(b).accept(group.id)).status).toBe(404);
      expect((await groups(b).invites()).body.data).toEqual([]);
    });
  });

  describe("an edit under admin approval", () => {
    async function liveGroup() {
      const s = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const reviewer = await s.admin();
      const group = await createGroup(ctx, s.tenant.slug, s.owner, { name: "Coffee club", description: "Fridays at nine." });
      expect((await s.moderate(reviewer, group.id, "approve")).status).toBe(200);
      await s.groups(s.b).join(group.id);
      return { ...s, reviewer, group };
    }

    it("keeps the room running under its approved name, pauses invitations, and shows the edit to its owner alone", async () => {
      const { owner, b, c, groups, chat, moderate, reviewer, group } = await liveGroup();
      const edited = await groups(owner).edit(group.id, { name: "Coffee and code", description: "Fridays at nine, laptops welcome." });
      expect(edited.body.data).toMatchObject({ name: "Coffee club", description: "Fridays at nine.", canInvite: false, canSend: true, review: { moderationStatus: "PENDING", shownToMembers: true, name: "Coffee and code", description: "Fridays at nine, laptops welcome." } });

      const asMember = (await groups(b).get(group.id)).body.data as ChatGroupDto;
      expect(asMember).toMatchObject({ name: "Coffee club", description: "Fridays at nine.", canSend: true, canInvite: false, review: null });
      expect(JSON.stringify(asMember)).not.toContain("Coffee and code");
      expect(JSON.stringify((await chat(b).list()).body)).not.toContain("Coffee and code");
      expect((await chat(b).get(group.id)).body.data).toMatchObject({ canSend: true, group: { name: "Coffee club" } });
      // Still in Discover, under the approved name, and open to join: hiding it would protect nothing.
      const discovered = (await groups(c).list()).body.data as ChatGroupDto[];
      expect(discovered.map((g) => [g.id, g.name, g.description, g.canJoin])).toEqual([[group.id, "Coffee club", "Fridays at nine.", true]]);
      expect(JSON.stringify(discovered)).not.toContain("Coffee and code");
      expect(ids(await groups(c).list({ q: "code" }))).toEqual([]);
      expect(ids(await groups(b).list({ scope: "MINE" }))).toEqual([group.id]);
      expect((await groups(owner).invite(group.id, [c.membership.id])).status).toBe(403);
      expect((await groups(b).invite(group.id, [c.membership.id])).status).toBe(403);

      expect((await moderate(reviewer, group.id, "approve")).status).toBe(200);
      expect((await groups(c).get(group.id)).body.data).toMatchObject({ name: "Coffee and code", description: "Fridays at nine, laptops welcome.", canJoin: true });
      expect((await groups(owner).invite(group.id, [c.membership.id])).status).toBe(201);
    });

    it("rejected, clears the approval and freezes the group for everyone but its owner, whose next edit waits for an admin", async () => {
      const { owner, b, groups, chat, moderate, reviewer, group } = await liveGroup();
      await groups(owner).edit(group.id, { name: "Coffee and crypto tips" });
      expect((await moderate(reviewer, group.id, "reject", "No promotions, please.")).status).toBe(200);
      expect((await groupRow(group.id)).approvedAt).toBeNull();

      for (const res of [await groups(b).get(group.id), await chat(b).get(group.id), await chat(b).messages(group.id)]) expect(res.status, res.request.url).toBe(404);
      expect(((await chat(b).list()).body.data as ChatConversationDto[]).map((t) => t.id)).not.toContain(group.id);
      expect((await groups(owner).get(group.id)).body.data).toMatchObject({ canSend: false, canInvite: false, canEdit: true, review: { moderationStatus: "REJECTED", moderationNote: "No promotions, please.", shownToMembers: false } });
      const owned = (await groups(owner).list({ scope: "OWNED" })).body.data as ChatGroupDto[];
      expect(owned).toEqual([expect.objectContaining({ id: group.id, review: expect.objectContaining({ moderationStatus: "REJECTED", moderationNote: "No promotions, please." }) })]);

      // The owner's edit can't reopen it by itself.
      await groups(owner).edit(group.id, { name: "Coffee club again" });
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect((await groups(owner).get(group.id)).body.data.review).toMatchObject({ moderationStatus: "PENDING", shownToMembers: false, moderationNote: null });
      expect((await moderate(reviewer, group.id, "approve")).status).toBe(200);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ name: "Coffee club again", myState: "ACTIVE", canSend: true });
    });

    it("removed, hides the group from members, and restored, brings it back with its members and messages intact", async () => {
      const { tenant, owner, b, groups, chat, moderate, reviewer, group } = await liveGroup();
      await postToGroup(ctx, tenant, group.id, b, "Still here?");
      expect((await moderate(reviewer, group.id, "remove", "Off topic")).status).toBe(200);
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect((await chat(b).get(group.id)).status).toBe(404);
      expect((await groups(owner).get(group.id)).body.data).toMatchObject({ canSend: false, canEdit: false, review: { moderationStatus: "REMOVED", moderationNote: "Off topic" } });
      expect((await groups(owner).edit(group.id, { name: "Back please" })).status).toBe(403);

      expect((await moderate(reviewer, group.id, "restore")).status).toBe(200);
      expect((await groups(b).get(group.id)).body.data).toMatchObject({ name: "Coffee club", myState: "ACTIVE", memberCount: 2, canSend: true });
      expect(lines(await chat(b).messages(group.id))).toEqual(["Bina Member JOINED", "Still here?"]);
    });

    it("an admin's decision lands only on the state they acted on, so one racing a change of status publishes nothing", async () => {
      const { tenant, owner, groups, group } = await liveGroup();
      await groups(owner).edit(group.id, { name: "Coffee lovers" });
      const decision = { moderationStatus: "APPROVED" as const, moderatedByUserId: null, moderatedAt: new Date(), moderationNote: null };
      // Read as REJECTED, but an edit has since made it PENDING.
      expect(await setGroupModeration(ctx.db, tenant.id, group.id, decision, "REJECTED")).toBe(false);
      expect(await groupRow(group.id)).toMatchObject({ moderationStatus: "PENDING", approvedName: "Coffee club" });
      expect(await setGroupModeration(ctx.db, tenant.id, group.id, decision, "PENDING", { name: "Coffee lovers", description: "Fridays at nine." })).toBe(true);
      expect(await groupRow(group.id)).toMatchObject({ moderationStatus: "APPROVED", approvedName: "Coffee lovers", approvedAt: decision.moderatedAt });
    });

    it("an approval publishes only the name and description the admin was shown, though a second edit leaves the status as it was", async () => {
      const { tenant, owner, b, groups, reviewer, group } = await liveGroup();
      const approve = (body: object) => request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${group.id}/approve`).set(reviewer.headers).send(body);
      await groups(owner).edit(group.id, { name: "Coffee lovers" });
      // The admin opens it and reads "Coffee lovers". Before they press Approve, the owner edits again: still PENDING.
      const shown = { name: "Coffee lovers", description: "Fridays at nine." };
      await groups(owner).edit(group.id, { name: "Buy crypto now" });
      expect((await approve({ reviewed: shown })).status).toBe(409);
      expect(await groupRow(group.id)).toMatchObject({ moderationStatus: "PENDING", approvedName: "Coffee club", name: "Buy crypto now" });
      expect((await groups(b).get(group.id)).body.data.name).toBe("Coffee club");
      // Saying nothing about what was approved isn't an approval either, and nor is a description that doesn't match.
      expect((await approve({})).status).toBe(400);
      expect((await approve({ reviewed: { name: "Buy crypto now", description: "Something else" } })).status).toBe(409);
      expect((await groupRow(group.id)).approvedName).toBe("Coffee club");
      // What the admin now sees is what goes out.
      expect((await approve({ reviewed: { name: "Buy crypto now", description: "Fridays at nine." } })).status).toBe(200);
      expect((await groups(b).get(group.id)).body.data.name).toBe("Buy crypto now");
    });
  });

  describe("ownership passing on", () => {
    async function liveGroup() {
      const s = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const reviewer = await s.admin();
      const group = await createGroup(ctx, s.tenant.slug, s.owner, { name: "Book club", description: "One book a month." });
      expect((await s.moderate(reviewer, group.id, "approve", "Welcome aboard, Olive")).status).toBe(200);
      await s.groups(s.b).join(group.id);
      return { ...s, reviewer, group };
    }
    const queued = async (tenantSlug: string, reviewer: Session) => (await request(ctx.app).get(`/api/v1/t/${tenantSlug}/admin/moderation`).query({ contentType: "GROUP" }).set(reviewer.headers)).body.total;

    it("drops the old owner's edit waiting for review and the admin's note to them, so the new owner inherits only what members saw", async () => {
      const { tenant, owner, b, groups, reviewer, group } = await liveGroup();
      await groups(owner).edit(group.id, { name: "Bina is a liar", description: "Everything about Bina" });
      expect(await queued(tenant.slug, reviewer)).toBe(1);
      await groups(owner).leave(group.id);

      expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: b.membership.id, name: "Book club", description: "One book a month.", approvedName: "Book club", moderationStatus: "APPROVED", moderationNote: null, archivedAt: null });
      const asOwner = (await groups(b).get(group.id)).body.data as ChatGroupDto;
      expect(asOwner).toMatchObject({ isOwner: true, canInvite: true, canEdit: true, review: { name: "Book club", description: "One book a month.", moderationStatus: "APPROVED", moderationNote: null } });
      const seen = JSON.stringify([asOwner, (await groups(b).list({ scope: "OWNED" })).body, (await request(ctx.app).get(`/api/v1/t/${tenant.slug}/notifications`).set(b.headers)).body]);
      expect(seen).not.toContain("liar");
      expect(seen).not.toContain("Welcome aboard");
      // Nothing is left waiting for an admin, so no decision about the old edit can ever reach the new owner.
      expect(await queued(tenant.slug, reviewer)).toBe(0);
    });

    it("isn't given to anyone while moderation hides the group: it's archived, with its admin's note going nowhere", async () => {
      const { tenant, owner, b, groups, moderate, reviewer, group } = await liveGroup();
      await groups(owner).edit(group.id, { name: "Bina is a liar" });
      expect((await moderate(reviewer, group.id, "reject", "Harassment of Bina, final warning")).status).toBe(200);
      expect((await groups(owner).leave(group.id)).status).toBe(204);

      expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: null, archivedAt: expect.any(Date) });
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ state: "ACTIVE", role: "MEMBER" });
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect(ids(await groups(b).list({ scope: "OWNED" }))).toEqual([]);
      const seen = JSON.stringify([(await groups(b).list({ scope: "MINE" })).body, (await chatApi(ctx, tenant.slug, b).list()).body]);
      expect(seen).not.toContain("liar");
      expect(seen).not.toContain("final warning");
    });
  });

  describe("invitations", () => {
    it(`allow up to ${CHAT_GROUP_MAX_PENDING_INVITES} waiting at once, delivered or not, even when invites race`, async () => {
      const { tenant, owner, b, c, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      const others = await manyMembers(tenant.id, CHAT_GROUP_MAX_PENDING_INVITES - 1);
      for (let i = 0; i < others.length; i += 25) expect((await groups(owner).invite(group.id, others.slice(i, i + 25))).status).toBe(201);
      const raced = await Promise.all([b, c].map((m) => groups(owner).invite(group.id, [m.membership.id])));
      expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
      // Asking again for someone already invited adds nothing.
      expect((await groups(owner).invite(group.id, [others[0]!])).status).toBe(201);
      const waiting = await ctx.db.select({ count: sql<number>`count(*)::int` }).from(chatParticipants).where(and(eq(chatParticipants.conversationId, group.id), eq(chatParticipants.state, "INVITED")));
      expect(waiting[0]!.count).toBe(CHAT_GROUP_MAX_PENDING_INVITES);
    });

    it("refuses more than 25 at once, someone outside the institution, and anyone the inviter blocked", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      expect((await groups(owner).invite(group.id, await manyMembers(tenant.id, 26))).status).toBe(400);
      const elsewhere = await memberSession(ctx, (await createTenant(ctx)).tenant.id);
      expect((await groups(owner).invite(group.id, [elsewhere.membership.id])).status).toBe(404);
      await chat(owner).block(b.membership.id);
      const refused = await groups(owner).invite(group.id, [b.membership.id]);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
      expect(ids(await groups(owner).candidates(group.id))).not.toContain(b.membership.id);
    });

    it("look the same to the inviter whether delivered or suppressed by a block, and never reach whoever blocked them", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await chat(b).block(owner.membership.id);

      const toBlocker = await groups(owner).invite(group.id, [b.membership.id]);
      const toOther = await groups(owner).invite(group.id, [c.membership.id]);
      expect(toBlocker.status).toBe(toOther.status);
      expect(toBlocker.body).toEqual(toOther.body);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ state: "INVITED", inviteSuppressed: true });

      // B never hears of it: no invitation, no badge, and the group doesn't exist for them.
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect((await chat(b).badge()).body.data.invites).toBe(0);
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect((await groups(b).accept(group.id)).status).toBe(404);
      expect((await chat(c).badge()).body.data.invites).toBe(1);

      // The inviter sees the two the same way: neither is a candidate, neither is a member, and inviting again changes nothing.
      const candidates = ((await groups(owner).candidates(group.id)).body.data as Array<{ id: string }>).map((m) => m.id);
      expect(candidates).not.toContain(b.membership.id);
      expect(candidates).not.toContain(c.membership.id);
      expect((await groups(owner).members(group.id)).body.data).toHaveLength(1);
      expect((await groups(owner).invite(group.id, [b.membership.id])).body).toEqual((await groups(owner).invite(group.id, [c.membership.id])).body);
    });

    it("from someone the invitee blocks afterwards disappear, and the inviter still sees no change", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await groups(owner).invite(group.id, [b.membership.id]);
      const before = (await groups(owner).get(group.id)).body.data;
      expect((await groups(b).invites()).body.data).toHaveLength(1);
      await chat(b).block(owner.membership.id);
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect((await groups(owner).get(group.id)).body.data).toEqual(before);
    });

    it("can't slip past a block made while they're being sent: the invitation waits for it, then is held back", async () => {
      const { tenant, owner, b, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      // Bina's block, part-way through, holding the lock every block takes and not yet committed.
      let finish!: () => void;
      const held = new Promise<void>((resolve) => (finish = resolve));
      let locked!: () => void;
      const hasLock = new Promise<void>((resolve) => (locked = resolve));
      const blocking = runInTransaction(ctx, async (tx) => {
        await lockPair(tx, tenant.id, b.membership.id, owner.membership.id);
        await insertBlock(tx, { tenantId: tenant.id, blockerMembershipId: b.membership.id, blockedMembershipId: owner.membership.id });
        locked();
        await held;
      });
      await hasLock;
      const inviting = groups(owner).invite(group.id, [b.membership.id]).then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 300));
      finish();
      await blocking;
      expect((await inviting).status).toBe(201);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ state: "INVITED", inviteSuppressed: true });
      expect((await groups(b).invites()).body.data).toEqual([]);
    });

    it("from the inviter, are withdrawn when they block the invitee, who can no longer accept them", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const family = await createGroup(ctx, tenant.slug, owner, { name: "Family", visibility: "INVITE_ONLY" });
      const open = await createGroup(ctx, tenant.slug, owner, { name: "Open room" });
      for (const g of [family, open]) await groups(owner).invite(g.id, [b.membership.id]);
      expect((await chat(b).badge()).body.data.invites).toBe(2);
      await chat(owner).block(b.membership.id);
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect((await chat(b).badge()).body.data.invites).toBe(0);
      expect((await groups(b).accept(family.id)).status).toBe(404);
      expect((await groups(b).accept(open.id)).status).toBe(409);
      expect(await participantRow(ctx, family.id, b.membership.id)).toMatchObject({ state: "INVITED", inviteSuppressed: true });
    });

    it("declined, also hide that inviter's other invitations already waiting, and nobody else's", async () => {
      const { tenant, owner, b, c, groups, chat } = await setup();
      const rooms = [];
      for (const name of ["Room one", "Room two", "Room three"]) rooms.push(await createGroup(ctx, tenant.slug, owner, { name, visibility: "INVITE_ONLY" }));
      const chetans = await createGroup(ctx, tenant.slug, c, { name: "Chetan's room" });
      for (const g of rooms) await groups(owner).invite(g.id, [b.membership.id]);
      await groups(c).invite(chetans.id, [b.membership.id]);
      const before = (await groups(owner).get(rooms[1]!.id)).body.data;
      expect((await chat(b).badge()).body.data.invites).toBe(4);

      await groups(b).decline(rooms[0]!.id);
      expect((await groups(b).invites()).body.data.map((i: { group: { id: string } }) => i.group.id)).toEqual([chetans.id]);
      expect((await chat(b).badge()).body.data.invites).toBe(1);
      expect((await groups(b).get(rooms[1]!.id)).status).toBe(404);
      // The inviter sees no change.
      expect((await groups(owner).get(rooms[1]!.id)).body.data).toEqual(before);
    });

    it("declined, keep that inviter's next ones away for 30 days across every group, and the inviter can't tell", async () => {
      const { tenant, owner, b, c, groups } = await setup();
      const first = await createGroup(ctx, tenant.slug, owner, { name: "First room", visibility: "INVITE_ONLY" });
      const second = await createGroup(ctx, tenant.slug, owner, { name: "Second room", visibility: "INVITE_ONLY" });
      await groups(owner).invite(first.id, [b.membership.id]);
      await groups(b).decline(first.id);
      expect(await participantRow(ctx, first.id, b.membership.id)).toMatchObject({ state: "INVITED", inviteSuppressed: true });
      expect(await ctx.db.select().from(chatInviteDeclines)).toEqual([expect.objectContaining({ declinerMembershipId: b.membership.id, inviterMembershipId: owner.membership.id })]);

      const declined = await groups(owner).invite(second.id, [b.membership.id]);
      const control = await groups(owner).invite(second.id, [c.membership.id]);
      expect(declined.body).toEqual(control.body);
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect((await groups(b).get(second.id)).status).toBe(404);
      expect((await groups(c).invites()).body.data).toHaveLength(1);

      // Someone else's invitation still gets through, and takes the place of the suppressed one.
      const open = await createGroup(ctx, tenant.slug, owner, { name: "Open room" });
      await groups(owner).invite(open.id, [b.membership.id]);
      expect((await groups(b).invites()).body.data).toEqual([]);
      await groups(c).join(open.id);
      expect((await groups(c).invite(open.id, [b.membership.id])).status).toBe(201);
      expect((await groups(b).invites()).body.data).toEqual([expect.objectContaining({ group: expect.objectContaining({ id: open.id }), invitedBy: expect.objectContaining({ id: c.membership.id }) })]);
      await groups(b).decline(open.id);

      // Thirty days on, the same inviter gets through again.
      await ctx.db.update(chatInviteDeclines).set({ declinedAt: new Date(Date.now() - 31 * 86_400_000) });
      const third = await createGroup(ctx, tenant.slug, owner, { name: "Third room", visibility: "INVITE_ONLY" });
      await groups(owner).invite(third.id, [b.membership.id]);
      expect((await groups(b).invites()).body.data.map((i: { group: { id: string } }) => i.group.id)).toEqual([third.id]);
    });

    it("declining a message request suppresses the requester's group invitations too", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, owner, b.membership.id);
      const earlier = await createGroup(ctx, tenant.slug, owner, { name: "Earlier room", visibility: "INVITE_ONLY" });
      await groups(owner).invite(earlier.id, [b.membership.id]);
      expect((await chat(b).badge()).body.data).toMatchObject({ requests: 1, invites: 1 });
      await chat(b).decline(conversation.id);
      // The one already waiting goes too.
      expect((await chat(b).badge()).body.data).toMatchObject({ requests: 0, invites: 0 });
      expect((await groups(b).get(earlier.id)).status).toBe(404);
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      expect((await groups(owner).invite(group.id, [b.membership.id])).status).toBe(201);
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect(await participantRow(ctx, group.id, b.membership.id)).toMatchObject({ inviteSuppressed: true });
    });

    it("lapse after 30 days, for the invitee and for the inviter's candidate list alike", async () => {
      const { tenant, owner, b, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner, { visibility: "INVITE_ONLY" });
      await groups(owner).invite(group.id, [b.membership.id]);
      await ctx.db.update(chatParticipants).set({ invitedAt: new Date(Date.now() - 31 * 86_400_000) }).where(eq(chatParticipants.membershipId, b.membership.id));
      expect((await groups(b).invites()).body.data).toEqual([]);
      expect((await groups(b).get(group.id)).status).toBe(404);
      expect(((await groups(owner).candidates(group.id)).body.data as Array<{ id: string }>).map((m) => m.id)).toContain(b.membership.id);
      await groups(owner).invite(group.id, [b.membership.id]);
      expect((await groups(b).invites()).body.data).toHaveLength(1);
    });

    it("count on the badge, apart from Messages, and leave it once answered", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const one = await createGroup(ctx, tenant.slug, owner, { name: "Room one", visibility: "INVITE_ONLY" });
      const two = await createGroup(ctx, tenant.slug, owner, { name: "Room two" });
      await groups(owner).invite(one.id, [b.membership.id]);
      await groups(owner).invite(two.id, [b.membership.id]);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 2 });
      await groups(b).accept(one.id);
      await groups(b).decline(two.id);
      expect((await chat(b).badge()).body.data).toEqual({ unread: 0, requests: 0, invites: 0 });
    });
  });

  describe("rate limits", () => {
    beforeEach(() => {
      process.env.RATE_LIMIT_IN_TESTS = "1";
    });
    afterEach(() => {
      delete process.env.RATE_LIMIT_IN_TESTS;
    });

    it("allow five new groups a day", async () => {
      const { owner, groups } = await setup();
      for (let i = 0; i < 5; i += 1) expect((await groups(owner).create({ name: `Daily room ${i}`, visibility: "OPEN" })).status).toBe(201);
      const refused = await groups(owner).create({ name: "Daily room 5", visibility: "OPEN" });
      expect(refused.status).toBe(429);
      expect(refused.body.error.code).toBe("RATE_LIMITED");
    });

    it("allow 30 edits an hour, and 60 joins and leaves an hour", async () => {
      const { tenant, owner, b, groups } = await setup();
      const group = await createGroup(ctx, tenant.slug, owner);
      await ctx.redis.set(keys.rateLimit("chat-group-edit", owner.membership.id), "30", "EX", 3600);
      expect((await groups(owner).edit(group.id, { name: "One edit too many" })).status).toBe(429);
      await ctx.redis.set(keys.rateLimit("chat-group-member", b.membership.id), "59", "EX", 3600);
      expect((await groups(b).join(group.id)).status).toBe(200);
      expect((await groups(b).leave(group.id)).status).toBe(429);
    });

    it("count each person newly invited against 200 a day, and nothing for a refused call or someone already invited", async () => {
      const { tenant, owner, b, groups, chat } = await setup();
      const rooms = [];
      for (const name of ["Room one", "Room two", "Room three"]) rooms.push(await createGroup(ctx, tenant.slug, owner, { name }));
      const people = await manyMembers(tenant.id, 201);
      const key = keys.rateLimit("chat-group-invite", owner.membership.id);
      const used = async () => Number((await ctx.redis.get(key)) ?? 0);

      await chat(owner).block(b.membership.id);
      expect((await groups(owner).invite(rooms[0]!.id, [people[0]!, b.membership.id])).status).toBe(409);
      expect(await used()).toBe(0);
      for (let i = 0; i < 200; i += 25) expect((await groups(owner).invite(rooms[Math.floor(i / 100)]!.id, people.slice(i, i + 25))).status).toBe(201);
      expect(await used()).toBe(200);
      const ttl = await ctx.redis.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(24 * 60 * 60);
      // Asking again for someone already invited costs nothing, and the next new person is one too many.
      expect((await groups(owner).invite(rooms[0]!.id, [people[0]!])).status).toBe(201);
      const over = await groups(owner).invite(rooms[2]!.id, [people[200]!]);
      expect(over.status).toBe(429);
      expect(over.body.error.code).toBe("RATE_LIMITED");
      expect((await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, rooms[2]!.id))).map((p) => p.membershipId)).toEqual([owner.membership.id]);
    });
  });

  describe("invite candidates", () => {
    it("with the directory switched off, are only people the inviter already chats with", async () => {
      const { tenant, owner, b, c, groups } = await setup({ features: { directory: false } });
      await memberSession(ctx, tenant.id, { fullName: "Dev Stranger" });
      const group = await createGroup(ctx, tenant.slug, owner);
      // Bina is in another group with the owner, and Chetan has an accepted chat with them.
      const binas = await createGroup(ctx, tenant.slug, b, { name: "Bina's room" });
      await groups(owner).join(binas.id);
      await acceptedThread(ctx, tenant.slug, owner, c);
      const names = async () => ((await groups(owner).candidates(group.id)).body.data as Array<{ fullName: string }>).map((m) => m.fullName).sort();
      expect(await names()).toEqual(["Bina Member", "Chetan Member"]);
      expect(ids(await groups(owner).candidates(group.id, "dev"))).toEqual([]);
      await ctx.db.update(tenantSettings).set({ features: { directory: true } }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect(await names()).toEqual(["Bina Member", "Chetan Member", "Dev Stranger"]);
    });

    it("leave out pupils, unapproved members, members, invitees and anyone the inviter blocked, but not those who blocked the inviter", async () => {
      const zone = "Asia/Kolkata";
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { messaging: true, groups: true } });
      const year = wallPartsInZone(new Date(), zone).year;
      const owner = await memberSession(ctx, tenant.id, { batchYear: 2000, fullName: "Owner" });
      const groups = (m: Session) => groupsApi(ctx, tenant.slug, m);
      const group = await createGroup(ctx, tenant.slug, owner);
      const alum = await memberSession(ctx, tenant.id, { batchYear: 2001, fullName: "Alum" });
      const pupils = [
        await memberSession(ctx, tenant.id, { batchYear: year + 1, fullName: "Future batch" }),
        await memberSession(ctx, tenant.id, { batchYear: year - 1, dateOfBirth: `${year - 15}-01-01`, fullName: "Fifteen" }),
        await memberSession(ctx, tenant.id, { batchYear: year, fullName: "This year, no birthday" }),
      ];
      const grown = await memberSession(ctx, tenant.id, { batchYear: year, dateOfBirth: `${year - 19}-01-01`, fullName: "This year, nineteen" });
      const pending = await memberSession(ctx, tenant.id, { batchYear: 2002, status: "PENDING", fullName: "Pending" });
      const member = await memberSession(ctx, tenant.id, { batchYear: 2003, fullName: "Joined" });
      const invitee = await memberSession(ctx, tenant.id, { batchYear: 2004, fullName: "Invited" });
      const blockedByOwner = await memberSession(ctx, tenant.id, { batchYear: 2005, fullName: "Blocked by owner" });
      const blocksOwner = await memberSession(ctx, tenant.id, { batchYear: 2006, fullName: "Blocks owner" });
      await groups(member).join(group.id);
      await groups(owner).invite(group.id, [invitee.membership.id]);
      await chatApi(ctx, tenant.slug, owner).block(blockedByOwner.membership.id);
      await chatApi(ctx, tenant.slug, blocksOwner).block(owner.membership.id);

      const names = ((await groups(owner).candidates(group.id)).body.data as Array<{ fullName: string }>).map((m) => m.fullName).sort();
      expect(names).toEqual(["Alum", "Blocks owner", "This year, nineteen"].sort());
      for (const pupil of pupils) {
        const res = await groups(owner).invite(group.id, [pupil.membership.id]);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
      }
      expect((await groups(owner).invite(group.id, [pending.membership.id])).body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect(ids(await groups(owner).candidates(group.id, "nine"))).toEqual([grown.membership.id]);
      expect(ids(await groups(owner).candidates(group.id, "alu"))).toEqual([alum.membership.id]);
    });
  });

  describe("demo data", () => {
    it("seeds an open and an invite-only group in the university and the Samaj only, each with one pending invitation, and none of the e2e members", async () => {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const membershipIds = await seedMembers(ctx.db, tenantIds);
      await seedDemoHistory(ctx.db, tenantIds, membershipIds);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      const uni = tenantIds["demo-university"]!;
      const samaj = tenantIds["shri-gujarati-samaj"]!;
      const bothInviteOnly = [
        [uni, "INVITE_ONLY"],
        [samaj, "INVITE_ONLY"],
      ].sort();

      const groups = await ctx.db.select().from(chatGroups);
      expect(groups.map((g) => [g.tenantId, g.visibility]).sort()).toEqual([...bothInviteOnly, [uni, "OPEN"], [samaj, "OPEN"]].sort());
      for (const g of groups) {
        expect(g).toMatchObject({ moderationStatus: "APPROVED", approvedName: g.name, approvedDescription: g.description, archivedAt: null });
        expect(g.approvedAt).toBeInstanceOf(Date);
        const people = await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, g.conversationId));
        const active = people.filter((p) => p.state === "ACTIVE");
        expect(active.length).toBeGreaterThanOrEqual(3);
        expect(g.memberCount).toBe(active.length);
        expect(active.filter((p) => p.role === "OWNER").map((p) => p.membershipId)).toEqual([g.ownerMembershipId]);
        const messages = await ctx.db.execute<{ seq: number }>(sql`select seq from chat_messages where conversation_id = ${g.conversationId} order by seq`);
        expect(messages.rows.map((m) => m.seq)).toEqual(Array.from({ length: messages.rows.length }, (_, i) => i + 1));
        expect(messages.rows.length).toBeGreaterThanOrEqual(3);
        // As joining does: an open group's history is everyone's, an invite-only group's starts when each member joined.
        const sent = await ctx.db.select({ seq: chatMessages.seq, at: chatMessages.createdAt }).from(chatMessages).where(eq(chatMessages.conversationId, g.conversationId));
        for (const p of active) {
          const before = sent.filter((m) => m.at < p.joinedAt!).length;
          expect(p.joinedSeq, `${g.name}: ${p.membershipId}`).toBe(g.visibility === "OPEN" ? 0 : before);
          expect(p.lastReadSeq).toBeGreaterThanOrEqual(p.joinedSeq);
        }
        if (g.visibility === "INVITE_ONLY") expect(Math.max(...active.map((p) => p.joinedSeq))).toBeGreaterThan(0);
      }
      const invited = await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.state, "INVITED"));
      const invitedTo = invited.map((p) => groups.find((g) => g.conversationId === p.conversationId)!);
      expect(invitedTo.map((g) => [g.tenantId, g.visibility]).sort()).toEqual(bothInviteOnly);

      // Nobody the e2e journeys sign in as is in a group or invited to one, so their inboxes and badges stay as they expect.
      const named = ["+919100000003", "+919100000004", "+919100000005", "+919100000006", "+919000000001"].map((p) => membershipIds[`demo-university:${p}`]!);
      // The two generated members the mobile groups journey signs in as, looked up by phone.
      const generated = await ctx.db
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, uni), sql`${users.phoneE164} in ('+91931000006', '+91931000007')`));
      expect(generated).toHaveLength(2);
      const e2e = [...named, ...generated.map((g) => g.id)];
      const groupIds = new Set(groups.map((g) => g.conversationId));
      expect((await ctx.db.select().from(chatParticipants)).filter((p) => groupIds.has(p.conversationId) && e2e.includes(p.membershipId))).toEqual([]);
      // No reports come with them: demo-college must still end the admin e2e on "No open reports".
      const reports = await ctx.db.select().from(contentReports);
      expect(reports.filter((r) => r.contentType === "GROUP" || r.tenantId === tenantIds["demo-college"])).toEqual([]);
    });
  });

  describe("messages", () => {
    /** An open group with Olive owning it and Bina and Chetan in it. */
    async function room(opts: TenantFactoryOptions = {}) {
      const s = await setup(opts);
      const group = await createGroup(ctx, s.tenant.slug, s.owner, { name: "Weekend runners" });
      for (const m of [s.b, s.c]) await s.groups(m).join(group.id);
      return { ...s, group };
    }
    const bodies = (res: { body: { data: ChatMessageDto[] } }) => [...res.body.data].reverse().filter((m) => m.kind === "TEXT").map((m) => m.body);

    it("go to everyone in it, in order, under each sender's name, and a retry returns the original without taking a place", async () => {
      const { owner, b, c, chat, group } = await room();
      const first = await chat(b).send(group.id, "Who's in for Saturday?", "retry-key-0001");
      expect(first.status).toBe(201);
      expect(first.body.data).toMatchObject({ kind: "TEXT", body: "Who's in for Saturday?", sender: { id: b.membership.id, fullName: "Bina Member" }, redacted: false, clientKey: "retry-key-0001" });
      await chat(c).send(group.id, "Me");
      await chat(owner).send(group.id, "Me too");
      const retried = await chat(b).send(group.id, "Who's in for Saturday?", "retry-key-0001");
      expect(retried.status).toBe(201);
      expect(retried.body.data).toEqual(first.body.data);

      const seen = (await chat(c).messages(group.id)).body.data as ChatMessageDto[];
      expect(bodies({ body: { data: seen } })).toEqual(["Who's in for Saturday?", "Me", "Me too"]);
      const seqs = [...seen].reverse().map((m) => m.seq);
      expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
      expect(seen.find((m) => m.body === "Me too")).toMatchObject({ sender: { fullName: "Olive Owner" }, clientKey: null, redacted: false });
      expect(lines(await chat(c).messages(group.id)).slice(0, 2)).toEqual(["Bina Member JOINED", "Chetan Member JOINED"]);
    });

    it("are refused outside it, after leaving, once it's archived, and before it's first approved, but not while an edit waits for review", async () => {
      const { tenant, owner, b, c, groups, chat, admin, moderate } = await setup({ contentModerationMode: "ADMIN_APPROVAL" });
      const reviewer = await admin();
      const group = await createGroup(ctx, tenant.slug, owner, { name: "Startup founders" });
      expect((await chat(owner).send(group.id, "Too early")).status).toBe(409);
      expect((await moderate(reviewer, group.id, "approve")).status).toBe(200);
      expect((await chat(b).send(group.id, "Not in it yet")).status).toBe(404);
      await groups(b).join(group.id);
      await groups(c).join(group.id);

      await groups(owner).edit(group.id, { name: "Startup founders club" });
      expect((await chat(b).send(group.id, "While the new name is reviewed")).status).toBe(201);
      expect((await moderate(reviewer, group.id, "approve")).status).toBe(200);

      await groups(c).leave(group.id);
      expect((await chat(c).send(group.id, "After leaving")).status).toBe(404);
      await groups(owner).archive(group.id);
      const archived = await chat(b).send(group.id, "After archiving");
      expect(archived.status).toBe(409);
      expect(archived.body.error.message).toContain("archived");
    });

    it("in a group moderation hid are 404 to its members and refused to its owner, and work again once it's restored", async () => {
      const { owner, b, c, chat, admin, moderate, group } = await room();
      const reviewer = await admin();
      const everyone = [owner, b, c].map((m) => m.membership.id).sort();
      expect((await chatRecipients(ctx.db, group.id)).map((r) => r.membershipId).sort()).toEqual(everyone);
      expect((await moderate(reviewer, group.id, "remove", "Off topic")).status).toBe(200);
      expect((await chat(b).send(group.id, "Hello?")).status).toBe(404);
      expect((await chat(owner).send(group.id, "Hello?")).status).toBe(409);
      // Nothing about it reaches anyone it's hidden from, except a hint with nothing in it.
      expect((await chatRecipients(ctx.db, group.id)).map((r) => r.membershipId)).toEqual([owner.membership.id]);
      expect((await chatRecipients(ctx.db, group.id, { evenIfHidden: true })).map((r) => r.membershipId).sort()).toEqual(everyone);
      expect((await moderate(reviewer, group.id, "restore")).status).toBe(200);
      expect((await chat(b).send(group.id, "Back again")).status).toBe(201);
    });

    it("reach nobody once groups are switched off, read fresh, and an invite-only one nobody once messaging is", async () => {
      const { tenant, owner, b, groups, group } = await room();
      const closed = await createGroup(ctx, tenant.slug, owner, { name: "Committee", visibility: "INVITE_ONLY" });
      await groups(owner).invite(closed.id, [b.membership.id]);
      await groups(b).accept(closed.id);
      const reach = async (id: string) => (await chatRecipients(ctx.db, id)).length;
      await ctx.db.update(tenantSettings).set({ features: { messaging: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      expect([await reach(group.id), await reach(closed.id)]).toEqual([3, 0]);
      await ctx.db.update(tenantSettings).set({ features: { groups: false } }).where(eq(tenantSettings.tenantId, tenant.id));
      expect([await reach(group.id), await reach(closed.id)]).toEqual([0, 0]);
    });

    it(`are limited to 120 a minute in one group, whoever sends them, and a retry still returns the original`, async () => {
      const { b, c, chat, group } = await room();
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        const sent = await chat(b).send(group.id, "Before the rush", "rush-key-0001");
        expect(sent.status).toBe(201);
        // As if the room had already had its 120 this minute, none of them from C.
        await ctx.redis.set(keys.rateLimit("chat-send-group", group.id), "120", "EX", 60);
        const refused = await chat(c).send(group.id, "One too many");
        expect(refused.status).toBe(429);
        // The room's limit, not the sender's, so the app doesn't tell them they're sending too fast.
        expect(refused.body.error.code).toBe("CHAT_GROUP_BUSY");
        expect(refused.body.error.message).toBe("This group is very busy right now. Try again in a moment.");
        expect((await chat(b).send(group.id, "Before the rush", "rush-key-0001")).body.data.id).toBe(sent.body.data.id);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });

    it("from a member who deleted their account stay, from Deleted member, with the line saying they left", async () => {
      const { b, c, chat, group } = await room();
      await chat(b).send(group.id, "Leaving soon");
      expect((await request(ctx.app).post("/api/v1/me/delete").set(b.headers).send({ confirm: true })).status).toBeLessThan(300);
      const seen = [...((await chat(c).messages(group.id)).body.data as ChatMessageDto[])].reverse();
      expect(seen.find((m) => m.body === "Leaving soon")).toMatchObject({ sender: null, redacted: false });
      expect(seen.at(-1)).toMatchObject({ kind: "SYSTEM", sender: null, body: "left the group", meta: { event: "LEFT" } });
      expect((await groupRow(group.id)).memberCount).toBe(2);
    });

    describe("from someone a member blocked", () => {
      it("reach that member redacted, with no name, words or unread, while the sender and everyone else see them as sent", async () => {
        const { owner, b, c, chat, group } = await room();
        const before = (await chat(b).messages(group.id)).body.data;
        await chat(c).block(b.membership.id);
        await chat(b).send(group.id, "Secret words from Bina");

        const forBlocker = (await chat(c).messages(group.id)).body.data as ChatMessageDto[];
        const redacted = forBlocker.filter((m) => m.redacted);
        expect(redacted.map((m) => [m.kind, m.sender, m.body])).toEqual([
          ["TEXT", null, null],
          ["SYSTEM", null, "joined the group"],
        ]);
        const asText = JSON.stringify([forBlocker, (await chat(c).list()).body, (await chat(c).get(group.id)).body]);
        expect(asText).not.toContain("Secret words");
        expect(asText).not.toContain("Bina");
        expect((await chat(c).get(group.id)).body.data).toMatchObject({ unread: 0, lastMessage: { redacted: true, body: null, sender: null, mine: false } });
        expect((await chat(c).badge()).body.data.unread).toBe(0);

        // Nothing differs for the sender, and the owner reads it as written.
        expect((await chat(b).messages(group.id)).body.data.slice(1)).toEqual(before);
        expect((await chat(b).messages(group.id)).body.data[0]).toMatchObject({ body: "Secret words from Bina", redacted: false });
        expect((await chat(owner).messages(group.id)).body.data[0]).toMatchObject({ body: "Secret words from Bina", sender: { fullName: "Bina Member" }, redacted: false });
        expect((await chat(owner).get(group.id)).body.data).toMatchObject({ unread: 1, lastMessage: { body: "Secret words from Bina", sender: { fullName: "Bina Member" }, redacted: false } });

        // Unblocking shows them again.
        await chat(c).unblock(b.membership.id);
        expect((await chat(c).messages(group.id)).body.data[0]).toMatchObject({ body: "Secret words from Bina", redacted: false });
      });
    });

    it("count as unread without system lines, removed ones or the member's own, and a muted group stays off the badge", async () => {
      const { tenant, owner, b, chat, group } = await room();
      const d = await memberSession(ctx, tenant.id, { fullName: "Dev Member" });
      // Writing reads the thread, so the member's own message comes first here.
      await chat(b).send(group.id, "Mine doesn't count");
      await chat(owner).send(group.id, "One");
      const two = (await chat(owner).send(group.id, "Two")).body.data as ChatMessageDto;
      expect((await chat(b).get(group.id)).body.data.unread).toBe(2);
      await groupsApi(ctx, tenant.slug, d).join(group.id);
      expect((await chat(b).get(group.id)).body.data.unread).toBe(2);
      await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, two.id));
      expect((await chat(b).get(group.id)).body.data.unread).toBe(1);
      expect((await chat(b).badge()).body.data.unread).toBe(1);
      const row = ((await chat(b).list()).body.data as ChatConversationDto[]).find((t) => t.id === group.id)!;
      expect(row).toMatchObject({ unread: 1, lastMessage: { kind: "SYSTEM", body: "joined the group", sender: { fullName: "Dev Member" }, mine: false } });

      await chat(b).read(group.id, row.lastMessage!.seq);
      expect((await chat(b).get(group.id)).body.data.unread).toBe(0);
      await chat(b).mute(group.id, new Date(Date.now() + 3_600_000).toISOString());
      await chat(owner).send(group.id, "Three");
      expect((await chat(b).get(group.id)).body.data.unread).toBe(1);
      expect((await chat(b).badge()).body.data.unread).toBe(0);
    });
  });

  describe("lists", () => {
    it("Discover finds open groups by name, page by page; My groups and Owned are the member's own", async () => {
      const { tenant, owner, b, groups } = await setup();
      const made: ChatGroupDto[] = [];
      for (const name of ["Cricket fans", "Book club", "Cricket coaching", "Hiking"]) made.push(await createGroup(ctx, tenant.slug, owner, { name }));
      const hidden = await createGroup(ctx, tenant.slug, owner, { name: "Cricket insiders", visibility: "INVITE_ONLY" });
      // A minute apart, so the order can't come down to which ones shared a millisecond.
      for (const [i, g] of [...made, hidden].entries()) await ctx.db.update(chatGroups).set({ createdAt: new Date(Date.now() - (10 - i) * 60_000) }).where(eq(chatGroups.conversationId, g.id));
      await groups(b).join(made[1]!.id);

      expect(ids(await groups(b).list({ q: "cricket" })).sort()).toEqual([made[0]!.id, made[2]!.id].sort());
      expect(ids(await groups(b).list({ q: "100%" }))).toEqual([]);
      const first = await groups(b).list({ limit: 3 });
      const second = await groups(b).list({ limit: 3, cursor: first.body.nextCursor });
      expect([...ids(first), ...ids(second)]).toEqual([...made].reverse().map((g) => g.id));
      expect(second.body.nextCursor).toBeNull();

      expect(ids(await groups(b).list({ scope: "MINE" }))).toEqual([made[1]!.id]);
      expect(ids(await groups(b).list({ scope: "OWNED" }))).toEqual([]);
      expect(ids(await groups(owner).list({ scope: "OWNED" }))).toEqual([hidden, ...[...made].reverse()].map((g) => g.id));
      expect(ids(await groups(owner).list({ scope: "MINE" }))).toHaveLength(5);
    });
  });
});
