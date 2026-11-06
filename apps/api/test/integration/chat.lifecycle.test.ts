import type { ChatConversationDto, ChatMessageDto } from "@illuminize/shared";
import { DELETED_MEMBER_NAME } from "@illuminize/shared";
import { and, eq, sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatBlocks, chatConversations, chatGroups, chatMessages, chatParticipants, chatReports, deletedAccountBlocks, memberships, mentorProfiles, mentorships, notifications, referralRequests, tenants } from "../../src/db/schema";
import { phoneHash } from "../../src/lib/phoneHash";
import { runInTransaction } from "../../src/lib/transaction";
import { chatRecipients } from "../../src/services/chat/fanout";
import { closeOriginConversation, openDirectFromOrigin } from "../../src/services/chat/open";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, ageRequest, chatApi, comparable, comparableMessage, conversationRow, createGroup, groupsApi, openRequest, type Session } from "../helpers/chat";
import { PROFILE, auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { acceptedMentorship, askMentor, mentorshipApi, NOTE, offerToMentor } from "../helpers/mentorship";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { acceptedReferral, askForReferral, postReferralJob, REFERRAL_NOTE, referralsApi } from "../helpers/referrals";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("chat lifecycle", () => {
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
  const deleteAccount = (m: Session) => request(ctx.app).post("/api/v1/me/delete").set(m.headers).send({ confirm: true });

  describe("deleting an account", () => {
    it("keeps their messages in the other member's thread with a null sender", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).send(id, "Goodbye");
      expect((await deleteAccount(a)).status).toBeLessThan(300);

      const messages = (await chat(b).messages(id)).body.data as ChatMessageDto[];
      expect(messages.map((m) => m.body)).toEqual(["Goodbye", "Hello there"]);
      for (const m of messages) expect(m).toMatchObject({ sender: null, removed: false });
      expect(DELETED_MEMBER_NAME).toBe("Deleted member");
    });

    it("leaves the 1:1 read-only for the other member, on both routes", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const before = (await conversationRow(ctx, id)).lastSeq;
      await deleteAccount(a);
      const view = (await chat(b).get(id)).body.data as ChatConversationDto;
      expect(view).toMatchObject({ peer: null, canSend: false, state: "ACCEPTED", blockedByMe: false });
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id)).toEqual([id]);
      const refused = await chat(b).send(id, "Anyone there?");
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect((await conversationRow(ctx, id)).lastSeq).toBe(before);
      const row = await conversationRow(ctx, id);
      expect([row.directLowId, row.directHighId].filter(Boolean)).toEqual([b.membership.id]);
    });

    it("removes their participant row and blocks, keeps the blocks on them for their number, and gives those back unseen when it joins again", async () => {
      const { tenant, a, b, chat } = await setup();
      const [c, d] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(b).block(a.membership.id);
      // One they placed, which goes with them.
      await chat(a).block(c.membership.id);
      const [placed] = await ctx.db.select().from(chatBlocks).where(eq(chatBlocks.blockerMembershipId, b.membership.id));
      await deleteAccount(a);
      expect(await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, id))).toHaveLength(1);
      expect(await ctx.db.select().from(chatBlocks)).toEqual([]);
      const held = await ctx.db.select().from(deletedAccountBlocks);
      expect(held).toEqual([{ phoneHash: phoneHash(ctx.config, a.user.phoneE164), tenantId: tenant.id, blockerMembershipId: b.membership.id, blockedAt: placed!.createdAt }]);
      expect(JSON.stringify(held)).not.toContain(a.user.phoneE164.slice(3));

      // Back through the real sign-in and registration.
      const session = await loginAs(ctx, a.user.phoneE164);
      expect(session.user.id).not.toBe(a.user.id);
      const joined = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/memberships`).set(auth(session.accessToken)).send(PROFILE);
      expect(joined.status).toBe(201);
      expect(joined.body.data.status).toBe("APPROVED");
      const back = chatApi(ctx, tenant.slug, { headers: auth(session.accessToken) });
      expect(await ctx.db.select().from(deletedAccountBlocks)).toEqual([]);
      expect(await ctx.db.select().from(chatBlocks)).toEqual([expect.objectContaining({ blockerMembershipId: b.membership.id, blockedMembershipId: joined.body.data.id, createdAt: placed!.createdAt })]);
      expect((await chat(b).blocks()).body.data.map((r: { member: { id: string } }) => r.member.id)).toEqual([joined.body.data.id]);

      // Their first message to the blocker is withheld, and looks to them like any first message to someone who hasn't.
      const normal = await chat(c).direct(d.membership.id, "New me", "key-for-comparing-1");
      const blocked = await back.direct(b.membership.id, "New me", "key-for-comparing-2");
      expect(blocked.status).toBe(normal.status);
      expect(blocked.body.data.conversation.id).not.toBe(id);
      expect(comparable(blocked.body.data.conversation)).toEqual(comparable(normal.body.data.conversation));
      expect(comparableMessage(blocked.body.data.message)).toEqual(comparableMessage(normal.body.data.message));
      const view = async (as: ReturnType<typeof chatApi>, conversationId: string) => ({
        thread: comparable((await as.get(conversationId)).body.data),
        listRow: comparable(((await as.list()).body.data as ChatConversationDto[]).find((t) => t.id === conversationId)!),
        badge: (await as.badge()).body.data,
      });
      expect(await view(back, blocked.body.data.conversation.id)).toEqual(await view(chat(c), normal.body.data.conversation.id));
      const [stored] = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, blocked.body.data.conversation.id));
      expect(stored!.withheld).toBe(true);
      expect((await chat(b).list("REQUESTS")).body.data).toEqual([]);
    });

    it("lets one member keep threads with several people who've since deleted their accounts", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const one = await acceptedThread(ctx, tenant.slug, a, b);
      const two = await acceptedThread(ctx, tenant.slug, c, b);
      expect((await deleteAccount(a)).status).toBeLessThan(300);
      expect((await deleteAccount(c)).status).toBeLessThan(300);
      const rows = [await conversationRow(ctx, one), await conversationRow(ctx, two)];
      for (const row of rows) expect([row.directLowId, row.directHighId].filter(Boolean)).toEqual([b.membership.id]);
      expect((await chat(b).list()).body.data.map((t: ChatConversationDto) => t.id).sort()).toEqual([one, two].sort());
    });

    it("lets the other member report what they left behind, naming nobody, and admins still hear", async () => {
      const { tenant, a, b, chat } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const { body } = await chat(a).send(id, "Something unkind, then gone");
      await deleteAccount(a);

      const res = await chat(b).report(body.data.id, { reason: "HARASSMENT" });
      expect(res.status).toBe(201);
      const [report] = await ctx.db.select().from(chatReports).where(eq(chatReports.id, res.body.data.id));
      expect(report).toMatchObject({ reportedMembershipId: null, reporterMembershipId: b.membership.id, targetId: body.data.id, conversationId: id });
      expect(report!.contextMessageIds).toContain(body.data.id);
      const notified = await ctx.db.select().from(notifications).where(eq(notifications.type, "CHAT_REPORT_FILED"));
      expect(notified.map((n) => n.recipientMembershipId)).toEqual([admin.membership.id]);
    });

    it("gives up on a held lock with a 503, leaving them signed in to try again", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const me = () => request(ctx.app).get("/api/v1/me").set(a.headers);
      const holder = new pg.Client({ connectionString: ctx.config.DATABASE_URL });
      await holder.connect();
      try {
        await holder.query("begin");
        await holder.query("select 1 from chat_conversations where id = $1 for update", [id]);
        const started = Date.now();
        const refused = await deleteAccount(a);
        expect(refused.status).toBe(503);
        expect(Date.now() - started).toBeLessThan(9000);
        await holder.query("rollback");
      } finally {
        await holder.end();
      }
      // Nothing happened, and they haven't been signed out of the account they still have.
      expect((await me()).status).toBe(200);
      expect((await chat(b).get(id)).body.data.peer).toMatchObject({ id: a.membership.id });

      expect((await deleteAccount(a)).status).toBeLessThan(300);
      expect((await me()).status).toBe(401);
    }, 20_000);

    it("declines pending requests they sent, so the recipient stops seeing them", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await deleteAccount(a);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect((await chat(b).list("REQUESTS")).body.data).toEqual([]);
      expect((await chat(b).badge()).body.data.requests).toBe(0);
    });

    it("declines pending requests they received, which the requester sees as a read-only thread", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id, "Hello");
      await deleteAccount(b);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect((await chat(a).get(conversation.id)).body.data).toMatchObject({ state: "REQUEST_SENT", peer: null, canSend: false, canRerequestAt: null });
      expect((await chat(a).messages(conversation.id)).body.data).toHaveLength(1);
    });

    it("promises no later request in a closed thread whose other member is gone", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversationId } = await runInTransaction(ctx, (tx) => openDirectFromOrigin(ctx, tx, { tenantId: tenant.id, aId: a.membership.id, bId: b.membership.id, origin: "MENTORSHIP", originId: a.membership.id }));
      await runInTransaction(ctx, (tx) => closeOriginConversation(ctx, tx, { tenantId: tenant.id, conversationId, hasOtherLiveConnection: false }));
      expect((await chat(b).get(conversationId)).body.data.canRerequestAt).toEqual(expect.any(String));
      await deleteAccount(a);
      expect((await chat(b).get(conversationId)).body.data).toMatchObject({ state: "CLOSED", peer: null, canSend: false, canRerequestAt: null });
      await ageRequest(ctx, conversationId, 31);
      expect((await chat(b).get(conversationId)).body.data).toMatchObject({ canSend: false, canRerequestAt: null });
    });

    it("does still say when for a suspended member, who could be reinstated", async () => {
      const { tenant, a, b, chat } = await setup();
      const { conversation } = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      expect((await chat(a).get(conversation.id)).body.data).toMatchObject({ canSend: false, canRerequestAt: conversation.canRerequestAt });
    });

    it("hard-deletes their withheld messages and nothing else", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).send(id, "Delivered");
      await chat(b).block(a.membership.id);
      await chat(a).send(id, "Withheld");
      await chat(b).unblock(a.membership.id);
      await chat(b).send(id, "From the other side");
      await deleteAccount(a);
      const stored = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id));
      expect(stored.map((m) => m.body).sort()).toEqual(["Delivered", "From the other side", "Hello there"]);
      expect(stored.every((m) => !m.withheld)).toBe(true);
    });

    it("keeps the withheld messages of other people", async () => {
      const { tenant, a, b, chat } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).block(b.membership.id);
      await chat(b).send(id, "Withheld from a");
      await deleteAccount(c);
      const stored = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, id));
      expect(stored.some((m) => m.withheld)).toBe(true);
    });

    it("keeps reports, with null parties", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      const { body } = await chat(a).send(id, "Rude");
      await chat(b).report(body.data.id);
      const c = await memberSession(ctx, tenant.id);
      const second = await acceptedThread(ctx, tenant.slug, c, b);
      const theirs = await chat(c).send(second, "Also rude");
      await chat(b).report(theirs.body.data.id);

      await deleteAccount(a);
      await deleteAccount(b);
      const reports = await ctx.db.select().from(chatReports);
      expect(reports).toHaveLength(2);
      for (const report of reports) {
        expect(report.status).toBe("OPEN");
        expect(report.reporterMembershipId).toBeNull();
        expect(report.contextMessageIds.length).toBeGreaterThan(0);
        expect(report.conversationId).not.toBeNull();
      }
      expect(reports.filter((r) => r.reportedMembershipId === null)).toHaveLength(1);
      // The messages a report points at are still there to review.
      expect((await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, reports[0]!.targetId)))[0]).toBeDefined();
    });

    it("works across every institution they belong to", async () => {
      const { tenant, a, b, chat } = await setup();
      const other = await createTenant(ctx);
      const [elsewhere] = await ctx.db.insert(memberships).values({ tenantId: other.tenant.id, userId: a.user.id, status: "APPROVED", fullName: "A elsewhere", startYear: 2006, batchYear: 2010, professionType: "EMPLOYED" }).returning();
      const otherPeer = await memberSession(ctx, other.tenant.id);
      const { conversation } = await openRequest(ctx, other.tenant.slug, otherPeer, elsewhere!.id);
      const here = await openRequest(ctx, tenant.slug, a, b.membership.id);
      await deleteAccount(a);
      expect((await conversationRow(ctx, conversation.id)).directState).toBe("DECLINED");
      expect((await conversationRow(ctx, here.conversation.id)).directState).toBe("DECLINED");
      expect(chat).toBeTruthy();
    });

    it("tolerates someone who never chatted", async () => {
      const { a } = await setup();
      expect((await deleteAccount(a)).status).toBeLessThan(300);
    });
  });

  describe("suspending a member", () => {
    const suspend = (m: Session) => ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, m.membership.id));

    it("blocks their REST access to chat", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await suspend(a);
      const api = chat(a);
      for (const res of [await api.get(id), await api.messages(id), await api.send(id), await api.list(), await api.badge(), await api.blocks(), await api.block(b.membership.id)]) {
        expect(res.status, res.request.url).toBe(403);
        expect(res.body.error.code, res.request.url).toBe("MEMBERSHIP_SUSPENDED");
      }
    });

    it("keeps their messages visible and tells peers they can't send", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await chat(a).send(id, "Before suspension");
      await suspend(a);
      expect((await chat(b).messages(id)).body.data.map((m: ChatMessageDto) => m.body)).toContain("Before suspension");
      expect((await chat(b).get(id)).body.data).toMatchObject({ canSend: false, peer: { id: a.membership.id }, state: "ACCEPTED" });
      const refused = await chat(b).send(id, "Are you there?");
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
    });

    it("refuses a new thread to them", async () => {
      const { b, a, chat } = await setup();
      await suspend(a);
      const refused = await chat(b).direct(a.membership.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
    });

    it("hands everything back when reinstated", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await suspend(a);
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, a.membership.id));
      expect((await chat(b).get(id)).body.data.canSend).toBe(true);
      expect((await chat(a).send(id, "Back")).status).toBe(201);
    });

    it("refuses a membership still pending as a contact", async () => {
      const { tenant, b, chat } = await setup();
      const pending = await memberSession(ctx, tenant.id, { status: "PENDING" });
      const refused = await chat(b).direct(pending.membership.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect((await chat(pending).badge()).body.error.code).toBe("MEMBERSHIP_PENDING");
    });
  });

  describe("suspending an institution", () => {
    it("blocks every member's chat", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      for (const res of [await chat(a).get(id), await chat(a).send(id), await chat(a).badge()]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("TENANT_INACTIVE");
      }
    });

    it("tells nobody anything, whatever else gets through", async () => {
      const { tenant, a, b } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      expect((await chatRecipients(ctx.db, id)).map((r) => r.membershipId).sort()).toEqual([a.membership.id, b.membership.id].sort());
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      expect(await chatRecipients(ctx.db, id)).toEqual([]);
    });

    it("stops a send even when the request's copy of the institution is stale", async () => {
      const { tenant, a, b, chat } = await setup();
      const id = await acceptedThread(ctx, tenant.slug, a, b);
      await ctx.db.execute(sql`update tenants set status = 'SUSPENDED' where id = ${tenant.id}`);
      const refused = await chat(a).send(id);
      expect(refused.status).toBe(403);
      expect(refused.body.error.code).toBe("TENANT_INACTIVE");
    });

    it("tells nobody in a group anything either, and still lets an account in it be deleted", async () => {
      const { tenant, a, b } = await setup();
      const group = await createGroup(ctx, tenant.slug, a, { name: "Quiet room" });
      await groupsApi(ctx, tenant.slug, b).join(group.id);
      await ctx.db.update(tenants).set({ status: "SUSPENDED" }).where(eq(tenants.id, tenant.id));
      expect(await chatRecipients(ctx.db, group.id)).toEqual([]);
      expect((await deleteAccount(a)).status).toBeLessThan(300);
      expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: b.membership.id, memberCount: 1 });
    });
  });

  describe("mentorship", () => {
    const mentorshipRow = async (id: string) => (await ctx.db.select().from(mentorships).where(eq(mentorships.id, id)))[0]!;

    it("on deletion, withdraws their waiting requests and declines those waiting for them, telling nobody, and their mentor profile goes", async () => {
      const { tenant, a, b } = await setup();
      const c = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, a);
      await offerToMentor(ctx, tenant.slug, c);
      const toThem = await askMentor(ctx, tenant.slug, b, a.membership.id);
      const theirs = await askMentor(ctx, tenant.slug, a, c.membership.id);
      await ctx.db.delete(notifications);
      expect((await deleteAccount(a)).status).toBeLessThan(300);

      expect(await mentorshipRow(toThem.id)).toMatchObject({ status: "DECLINED", mentorMembershipId: null, menteeMembershipId: b.membership.id });
      expect(await mentorshipRow(theirs.id)).toMatchObject({ status: "ENDED", menteeMembershipId: null, acceptedAt: null });
      expect(await ctx.db.select().from(mentorProfiles).where(eq(mentorProfiles.tenantId, tenant.id))).toHaveLength(1);
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await mentorshipApi(ctx, tenant.slug, b).requests("sent")).body.data).toEqual([expect.objectContaining({ id: toThem.id, status: "DECLINED", member: null, canWithdraw: false })]);
      expect((await mentorshipApi(ctx, tenant.slug, c).requests("received")).body).toMatchObject({ waiting: 0, data: [expect.objectContaining({ status: "ENDED", member: null })] });
      expect((await mentorshipApi(ctx, tenant.slug, c).mentors()).body.data).toEqual([]);
    });

    it("on deletion, ends their mentorships under way and leaves the chat read-only, with what they wrote from a deleted member", async () => {
      const { tenant, a, b, chat } = await setup();
      const dto = await acceptedMentorship(ctx, tenant.slug, a, b);
      await chat(a).send(dto.conversationId!, "Glad to help");
      await ctx.db.delete(notifications);
      expect((await deleteAccount(a)).status).toBeLessThan(300);

      expect(await mentorshipRow(dto.id)).toMatchObject({ status: "ENDED", mentorMembershipId: null, endedByMembershipId: null });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await mentorshipApi(ctx, tenant.slug, b).requests("sent")).body.data[0]).toMatchObject({ status: "ENDED", member: null, canEnd: false, conversationId: dto.conversationId });
      expect((await chat(b).get(dto.conversationId!)).body.data).toMatchObject({ peer: null, canSend: false });
      const messages = (await chat(b).messages(dto.conversationId!)).body.data as ChatMessageDto[];
      expect(messages.map((m) => [m.body, m.sender?.id ?? null])).toEqual([
        ["Glad to help", null],
        [NOTE, b.membership.id],
      ]);
    });

    it("on suspension, hides the mentor and makes them unavailable, while their mentees can still withdraw and end", async () => {
      const { tenant, a, b } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const d = await memberSession(ctx, tenant.id);
      const underWay = await acceptedMentorship(ctx, tenant.slug, a, c);
      const waiting = await askMentor(ctx, tenant.slug, b, a.membership.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, a.membership.id));

      expect((await mentorshipApi(ctx, tenant.slug, d).mentors()).body.data).toEqual([]);
      expect((await mentorshipApi(ctx, tenant.slug, d).mentor(a.membership.id)).status).toBe(404);
      const refused = await mentorshipApi(ctx, tenant.slug, d).request(a.membership.id);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect((await mentorshipApi(ctx, tenant.slug, a).requests("received")).body.error.code).toBe("MEMBERSHIP_SUSPENDED");
      expect((await mentorshipApi(ctx, tenant.slug, b).withdraw(waiting.id)).status).toBe(200);
      expect((await mentorshipApi(ctx, tenant.slug, c).end(underWay.id)).status).toBe(200);

      // Reinstated, they're back in the list with their profile as it was.
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, a.membership.id));
      expect((await mentorshipApi(ctx, tenant.slug, d).mentors()).body.data.map((r: { member: { id: string } }) => r.member.id)).toEqual([a.membership.id]);
    });
  });

  describe("referrals", () => {
    const referralRow = async (id: string) => (await ctx.db.select().from(referralRequests).where(eq(referralRequests.id, id)))[0]!;

    it("on deletion, withdraws their waiting requests and closes those waiting for them, telling nobody, as their jobs go", async () => {
      const { tenant, a, b } = await setup();
      const c = await memberSession(ctx, tenant.id);
      const aJob = await postReferralJob(ctx, tenant.slug, a);
      const cJob = await postReferralJob(ctx, tenant.slug, c);
      const toThem = await askForReferral(ctx, tenant.slug, b, aJob.id);
      const theirs = await askForReferral(ctx, tenant.slug, a, cJob.id);
      await ctx.db.delete(notifications);
      expect((await deleteAccount(a)).status).toBeLessThan(300);

      expect(await referralRow(toThem.id)).toMatchObject({ status: "CLOSED", closedAt: expect.any(Date), posterMembershipId: null, jobId: null, requesterMembershipId: b.membership.id, jobTitle: "Backend Engineer" });
      expect(await referralRow(theirs.id)).toMatchObject({ status: "WITHDRAWN", requesterMembershipId: null, acceptedAt: null });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await referralsApi(ctx, tenant.slug, b).mine("sent")).body.data).toEqual([expect.objectContaining({ id: toThem.id, status: "CLOSED", member: null, canWithdraw: false, job: { id: null, title: "Backend Engineer", companyName: "Acme", available: false } })]);
      expect((await referralsApi(ctx, tenant.slug, c).mine("received")).body).toMatchObject({ waiting: 0, data: [expect.objectContaining({ status: "WITHDRAWN", member: null })] });
    });

    it("on deletion, keeps an accepted referral and leaves its chat read-only, with what they wrote from a deleted member", async () => {
      const { tenant, a, b, chat } = await setup();
      const { referral } = await acceptedReferral(ctx, tenant.slug, a, b);
      await chat(a).send(referral.conversationId!, "I've passed your CV on");
      await ctx.db.delete(notifications);
      expect((await deleteAccount(a)).status).toBeLessThan(300);

      expect(await referralRow(referral.id)).toMatchObject({ status: "ACCEPTED", posterMembershipId: null, jobId: null });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await referralsApi(ctx, tenant.slug, b).mine("sent")).body.data[0]).toMatchObject({ status: "ACCEPTED", member: null, conversationId: referral.conversationId });
      expect((await chat(b).get(referral.conversationId!)).body.data).toMatchObject({ peer: null, canSend: false });
      const messages = (await chat(b).messages(referral.conversationId!)).body.data as ChatMessageDto[];
      expect(messages.map((m) => [m.body, m.sender?.id ?? null])).toEqual([
        ["I've passed your CV on", null],
        [REFERRAL_NOTE, b.membership.id],
      ]);
    });

    it("on suspension, hides the poster's job and leaves what waits for it, which its sender can still withdraw", async () => {
      const { tenant, a, b } = await setup();
      const job = await postReferralJob(ctx, tenant.slug, a);
      const waiting = await askForReferral(ctx, tenant.slug, b, job.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, a.membership.id));

      expect((await referralsApi(ctx, tenant.slug, b).job(job.id)).status).toBe(404);
      expect((await referralsApi(ctx, tenant.slug, a).mine("received")).body.error.code).toBe("MEMBERSHIP_SUSPENDED");
      expect((await referralsApi(ctx, tenant.slug, b).mine("sent")).body.data[0]).toMatchObject({ status: "REQUESTED", canWithdraw: true, job: { id: job.id, available: false } });
      expect((await referralsApi(ctx, tenant.slug, b).withdraw(waiting.id)).status).toBe(200);
      // Reinstated, their job is back as it was, still taking requests.
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, a.membership.id));
      expect((await referralsApi(ctx, tenant.slug, b).job(job.id)).body.data).toMatchObject({ canRefer: true, myReferral: { id: waiting.id, status: "WITHDRAWN" } });
    });

    it("on suspension of the one asking, hides what they asked from the poster, refuses accepting it, and hands it back when reinstated", async () => {
      const { tenant, a, b } = await setup();
      const job = await postReferralJob(ctx, tenant.slug, a);
      const waiting = await askForReferral(ctx, tenant.slug, b, job.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, b.membership.id));
      expect((await referralsApi(ctx, tenant.slug, a).forJob(job.id)).body).toMatchObject({ data: [], waiting: 0 });
      expect((await referralsApi(ctx, tenant.slug, a).accept(waiting.id)).body.error.code).toBe("CONTACT_UNAVAILABLE");
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, b.membership.id));
      expect((await referralsApi(ctx, tenant.slug, a).forJob(job.id)).body.waiting).toBe(1);
      expect((await referralsApi(ctx, tenant.slug, a).accept(waiting.id)).status).toBe(200);
    });
  });

  describe("groups", () => {
    /** A group's thread as this member reads it, oldest first. */
    const thread = async (slug: string, m: Session, id: string) => [...((await chatApi(ctx, slug, m).messages(id)).body.data as ChatMessageDto[])].reverse();

    describe("deleting an account", () => {
      it("passes on the groups they owned to whoever has been in longest, fixes the count, and keeps what they wrote from Deleted member", async () => {
        const { tenant, a, b, chat } = await setup();
        const c = await memberSession(ctx, tenant.id);
        const group = await createGroup(ctx, tenant.slug, a, { name: "Handed on" });
        await groupsApi(ctx, tenant.slug, b).join(group.id);
        await groupsApi(ctx, tenant.slug, c).join(group.id);
        await chat(a).send(group.id, "Written before I went");
        expect((await deleteAccount(a)).status).toBeLessThan(300);

        expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: b.membership.id, memberCount: 2, archivedAt: null });
        const owners = await ctx.db.select().from(chatParticipants).where(and(eq(chatParticipants.conversationId, group.id), eq(chatParticipants.role, "OWNER")));
        expect(owners.map((p) => p.membershipId)).toEqual([b.membership.id]);
        const seen = await thread(tenant.slug, c, group.id);
        expect(seen.find((m) => m.body === "Written before I went")).toMatchObject({ sender: null });
        expect(seen.slice(-2).map((m) => [m.kind, m.sender?.id ?? null, m.meta])).toEqual([
          ["SYSTEM", null, { event: "LEFT" }],
          ["SYSTEM", b.membership.id, { event: "OWNER_CHANGED" }],
        ]);
        expect((await groupsApi(ctx, tenant.slug, b).get(group.id)).body.data).toMatchObject({ isOwner: true, memberCount: 2, canEdit: true });
      });

      it("archives a group nobody is left in, and leaves the groups they were only a member of with the right count", async () => {
        const { tenant, a, b } = await setup();
        const alone = await createGroup(ctx, tenant.slug, a, { name: "Just me" });
        const theirs = await createGroup(ctx, tenant.slug, b, { name: "Someone else's" });
        await groupsApi(ctx, tenant.slug, a).join(theirs.id);
        expect((await groupRow(theirs.id)).memberCount).toBe(2);
        await deleteAccount(a);
        expect(await groupRow(alone.id)).toMatchObject({ ownerMembershipId: null, memberCount: 0, archivedAt: expect.any(Date) });
        expect(await groupRow(theirs.id)).toMatchObject({ ownerMembershipId: b.membership.id, memberCount: 1, archivedAt: null });
        expect((await groupsApi(ctx, tenant.slug, b).members(theirs.id)).body.data.map((m: { member: { id: string } }) => m.member.id)).toEqual([b.membership.id]);
      });

      it("drops their invitations both ways: those they sent stop showing, and those they had go with them", async () => {
        const { tenant, a, b, chat } = await setup();
        const c = await memberSession(ctx, tenant.id);
        const open = await createGroup(ctx, tenant.slug, c, { name: "Open room" });
        await groupsApi(ctx, tenant.slug, a).join(open.id);
        await groupsApi(ctx, tenant.slug, a).invite(open.id, [b.membership.id]);
        const closed = await createGroup(ctx, tenant.slug, c, { name: "Closed room", visibility: "INVITE_ONLY" });
        await groupsApi(ctx, tenant.slug, c).invite(closed.id, [a.membership.id]);
        expect((await chat(b).badge()).body.data.invites).toBe(1);

        const realtime = new CapturingRealtime();
        const previous = ctx.realtime;
        ctx.realtime = realtime;
        try {
          await deleteAccount(a);
        } finally {
          ctx.realtime = previous;
        }
        // B's Invitations and badge catch up at once.
        expect(realtime.to(b.user.id, "chat:changed").map((e) => e.payload)).toEqual([{ tenantSlug: tenant.slug, conversationId: open.id }]);
        expect(realtime.to(b.user.id, "chat:unread").map((e) => e.payload)).toEqual([expect.objectContaining({ invites: 0 })]);
        expect((await groupsApi(ctx, tenant.slug, b).invites()).body.data).toEqual([]);
        expect((await chat(b).badge()).body.data.invites).toBe(0);
        expect(await ctx.db.select().from(chatParticipants).where(eq(chatParticipants.conversationId, closed.id))).toHaveLength(1);
        // Another member can still invite them, and that one shows.
        await groupsApi(ctx, tenant.slug, c).invite(open.id, [b.membership.id]);
        expect((await groupsApi(ctx, tenant.slug, b).invites()).body.data).toHaveLength(1);
      });
    });

    describe("suspending a member", () => {
      const suspendVia = (slug: string, admin: Session, m: Session) => request(ctx.app).post(`/api/v1/t/${slug}/admin/members/${m.membership.id}/suspend`).set(admin.headers).send({ reason: "Testing" });

      it("hands the groups they owned to whoever has been in longest, keeps them in it, and archives a group nobody else could take", async () => {
        const { tenant, a, b } = await setup();
        const c = await memberSession(ctx, tenant.id);
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const shared = await createGroup(ctx, tenant.slug, a, { name: "Shared" });
        await groupsApi(ctx, tenant.slug, b).join(shared.id);
        const alone = await createGroup(ctx, tenant.slug, a, { name: "Alone" });
        expect((await suspendVia(tenant.slug, admin, a)).status).toBeLessThan(300);

        expect(await groupRow(shared.id)).toMatchObject({ ownerMembershipId: b.membership.id, memberCount: 2, archivedAt: null });
        expect(await participantOf(shared.id, a.membership.id)).toMatchObject({ state: "ACTIVE", role: "MEMBER" });
        expect((await thread(tenant.slug, b, shared.id)).at(-1)).toMatchObject({ kind: "SYSTEM", sender: { id: b.membership.id }, meta: { event: "OWNER_CHANGED" } });
        // Left as it was, it would carry on in Discover with nobody able to run it.
        expect(await groupRow(alone.id)).toMatchObject({ ownerMembershipId: null, archivedAt: expect.any(Date) });
        const discover = (await groupsApi(ctx, tenant.slug, c).list()).body.data as Array<{ id: string }>;
        expect(discover.map((g) => g.id)).toEqual([shared.id]);
        expect((await groupsApi(ctx, tenant.slug, c).join(alone.id)).status).toBe(404);
      });

      it("leaves a group members can't see anyway as the suspended owner's, for when they're reinstated", async () => {
        const { tenant, a, b } = await setup();
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const group = await createGroup(ctx, tenant.slug, a, { name: "Removed room" });
        await groupsApi(ctx, tenant.slug, b).join(group.id);
        await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${group.id}/remove`).set(admin.headers).send({ note: "Off topic" }).expect(200);
        expect((await suspendVia(tenant.slug, admin, a)).status).toBeLessThan(300);
        expect(await groupRow(group.id)).toMatchObject({ ownerMembershipId: a.membership.id, moderationStatus: "REMOVED", moderationNote: "Off topic", archivedAt: null });
        expect(await participantOf(group.id, b.membership.id)).toMatchObject({ role: "MEMBER" });
        // Restored while they're suspended, it stays out of Discover, where nobody could run it.
        await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/moderation/GROUP/${group.id}/restore`).set(admin.headers).send({}).expect(200);
        const c = await memberSession(ctx, tenant.id);
        expect((await groupsApi(ctx, tenant.slug, c).list()).body.data).toEqual([]);
      });

      it("leaves them out of delivery while what they wrote stays, with their name", async () => {
        const { tenant, a, b, chat } = await setup();
        const group = await createGroup(ctx, tenant.slug, b, { name: "Still readable" });
        await groupsApi(ctx, tenant.slug, a).join(group.id);
        await chat(a).send(group.id, "Before my suspension");
        await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, a.membership.id));
        expect((await chatRecipients(ctx.db, group.id)).map((r) => r.membershipId)).toEqual([b.membership.id]);
        expect((await thread(tenant.slug, b, group.id)).find((m) => m.body === "Before my suspension")).toMatchObject({ sender: { id: a.membership.id } });
        expect((await chat(b).send(group.id, "Still going")).status).toBe(201);
      });
    });

    async function participantOf(conversationId: string, membershipId: string) {
      const [row] = await ctx.db.select().from(chatParticipants).where(and(eq(chatParticipants.conversationId, conversationId), eq(chatParticipants.membershipId, membershipId)));
      return row;
    }
  });

  const groupRow = async (id: string) => (await ctx.db.select().from(chatGroups).where(eq(chatGroups.conversationId, id)))[0]!;
});
