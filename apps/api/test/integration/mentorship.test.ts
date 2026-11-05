import { MENTORSHIP_MAX_OPEN_PER_MENTEE, notificationTarget, type AdminChatReportViewDto, type ChatMessageDto, type MentorCardDto, type MentorshipDto } from "@illuminize/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatConversations, chatMessages, chatReports, memberships, mentorProfiles, mentorships, notifications, tenantSettings, users } from "../../src/db/schema";
import { seedConnections, seedCore, seedMembers } from "../../src/db/seed";
import { seedDemoHistory } from "../../src/db/seedDemoHistory";
import { keys } from "../../src/redis/keys";
import { acceptedThread, chatApi, conversationRow, type Session } from "../helpers/chat";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { acceptedMentorship, askMentor, comparableMentorship, mentorshipApi, MENTOR_PROFILE, NOTE, offerToMentor } from "../helpers/mentorship";
import { acceptedReferral } from "../helpers/referrals";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("mentorship", () => {
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
    const mentor = await memberSession(ctx, tenant.id, { fullName: "Mira Mentor" });
    const mentee = await memberSession(ctx, tenant.id, { fullName: "Manu Mentee" });
    const m = (s: Session) => mentorshipApi(ctx, tenant.slug, s);
    return { tenant, mentor, mentee, m };
  }
  const audits = (action: string) => ctx.db.select().from(auditLog).where(eq(auditLog.action, action));
  const noticesTo = (s: Session, type?: string) =>
    ctx.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.recipientMembershipId, s.membership.id), type ? sql`${notifications.type} = ${type}` : undefined));
  /** Ids and times put aside, so two members' copies of the same thing can be compared whole. */
  const withoutIdsOrTimes = (value: unknown): unknown =>
    JSON.parse(
      JSON.stringify(value)
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
        .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<time>"),
    );
  /** Everything a member has been told, in the bell and live, once what was queued has gone out, ids and times aside. */
  const toldTo = async (s: Session) => {
    await ctx.jobs.drain();
    return withoutIdsOrTimes({ notifications: await noticesTo(s), live: realtime.to(s.user.id).map(({ event, payload }) => ({ event, payload })) });
  };
  const row = async (id: string) => (await ctx.db.select().from(mentorships).where(eq(mentorships.id, id)))[0]!;
  const names =(res: { body: { data: MentorCardDto[] } }) => res.body.data.map((c) => c.member.fullName);
  /** Until another connection to this database is waiting for a lock, which is how a test knows a request has reached one. */
  const waitForLockWait = async () => {
    for (let i = 0; i < 250; i++) {
      const { rows } = await ctx.pool.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
      if (rows[0]!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Nothing waited for a lock");
  };
  const withLimits = async (run: () => Promise<void>) => {
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      await run();
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  };

  describe("being a mentor", () => {
    it("opts in, edits and opts out, keeping the profile for next time, with ids-only audit rows for joining and leaving", async () => {
      const { mentor, m } = await setup();
      expect((await m(mentor).me()).body.data).toBeNull();
      const saved = await m(mentor).save();
      expect(saved.status).toBe(200);
      expect(saved.body.data).toMatchObject({ areas: ["CAREER_ADVICE", "SOFTWARE_IT"], availability: "MONTHLY", availabilityNote: "Weekday evenings", note: MENTOR_PROFILE.note, isActive: true });
      expect((await m(mentor).save({ ...MENTOR_PROFILE, availability: "WEEKLY" })).body.data.availability).toBe("WEEKLY");
      expect(await audits("mentor.optin")).toHaveLength(1);

      expect((await m(mentor).stop()).status).toBe(204);
      expect((await m(mentor).me()).body.data).toMatchObject({ isActive: false, availability: "WEEKLY", note: MENTOR_PROFILE.note });
      expect((await m(mentor).stop()).status).toBe(204);
      expect(await audits("mentor.optout")).toHaveLength(1);
      expect((await m(mentor).save()).body.data.isActive).toBe(true);
      const rows = [...(await audits("mentor.optin")), ...(await audits("mentor.optout"))];
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toMatchObject({ targetType: "membership", targetId: mentor.membership.id, actorMembershipId: mentor.membership.id, metadata: {} });
    });

    it("stopping declines what's waiting, telling each sender, and leaves a mentorship under way and its chat as they are", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const waitingMentee = await memberSession(ctx, tenant.id);
      const underWay = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      const waiting = await askMentor(ctx, tenant.slug, waitingMentee, mentor.membership.id);
      await ctx.db.delete(notifications);
      realtime.clear();

      expect((await m(mentor).stop()).status).toBe(204);
      expect(await row(waiting.id)).toMatchObject({ status: "DECLINED" });
      expect(await noticesTo(waitingMentee, "MENTORSHIP_DECLINED")).toHaveLength(1);
      expect(await row(underWay.id)).toMatchObject({ status: "ACCEPTED", endedAt: null });
      expect(await noticesTo(mentee)).toEqual([]);
      expect(await conversationRow(ctx, underWay.conversationId!)).toMatchObject({ directState: "ACCEPTED" });
      expect((await chatApi(ctx, tenant.slug, mentee).send(underWay.conversationId!, "Still on for Thursday?")).status).toBe(201);
      expect((await m(mentee).requests("sent")).body.data[0]).toMatchObject({ id: underWay.id, status: "ACCEPTED", canEnd: true });
      // The mentor and the sender whose request it declined hear that their lists changed; the mentee under way doesn't need to.
      expect(realtime.to(mentor.user.id, "mentorship:changed")).toHaveLength(1);
      expect(realtime.to(waitingMentee.user.id, "mentorship:changed")).toHaveLength(1);
      expect(realtime.to(mentee.user.id, "mentorship:changed")).toEqual([]);
    });

    it("says whether a member is listed and what they have open, even with mentorship off, for the way back in", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      expect((await m(mentee).summary()).body.data).toEqual({ listed: false, open: 0 });
      const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      const other = await memberSession(ctx, tenant.id);
      await askMentor(ctx, tenant.slug, other, mentor.membership.id);
      await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/admin/settings`).set((await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" })).headers).send({ features: { mentorship: false } }).expect(200);
      expect((await m(mentor).mentors()).status).toBe(403);
      const summary = await m(mentor).summary();
      expect(summary.status).toBe(200);
      expect(summary.headers["cache-control"]).toBe("no-store");
      expect(summary.body.data).toEqual({ listed: true, open: 2 });
      expect((await m(mentee).summary()).body.data).toEqual({ listed: false, open: 1 });
      await m(mentee).end(dto.id);
      expect((await m(mentee).summary()).body.data).toEqual({ listed: false, open: 0 });
    });

    it("takes one to five areas from the list, once each, and notes of bounded length, which empty ones clear", async () => {
      const { mentor, m } = await setup();
      for (const areas of [[], ["CAREER_ADVICE", "SOFTWARE_IT", "FINANCE", "LAW", "HEALTHCARE", "CONSULTING"], ["ASTROLOGY"]]) {
        expect((await m(mentor).save({ ...MENTOR_PROFILE, areas })).status, JSON.stringify(areas)).toBe(400);
      }
      expect((await m(mentor).save({ ...MENTOR_PROFILE, availability: "DAILY" })).status).toBe(400);
      expect((await m(mentor).save({ ...MENTOR_PROFILE, note: "x".repeat(501) })).status).toBe(400);
      expect((await m(mentor).save({ ...MENTOR_PROFILE, availabilityNote: "x".repeat(201) })).status).toBe(400);
      const ok = await m(mentor).save({ areas: ["LAW", "LAW", "FINANCE"], availability: "ONE_OFF", availabilityNote: "   ", note: " ​ " });
      expect(ok.body.data).toMatchObject({ areas: ["LAW", "FINANCE"], availabilityNote: null, note: null });
      expect((await m(mentor).save({ ...MENTOR_PROFILE, note: "x".repeat(500) })).status).toBe(200);
    });
  });

  describe("the Mentors list", () => {
    it("shows active, approved mentors other than the viewer, by name, filtered by name, area and availability, and paged", async () => {
      const { tenant, mentee: viewer, m } = await setup();
      const make = async (fullName: string, profile: Record<string, unknown>, status?: "SUSPENDED" | "PENDING") => {
        const s = await memberSession(ctx, tenant.id, { fullName });
        await offerToMentor(ctx, tenant.slug, s, { ...MENTOR_PROFILE, ...profile });
        if (status) await ctx.db.update(memberships).set({ status }).where(eq(memberships.id, s.membership.id));
        return s;
      };
      await make("Chitra Rao", { areas: ["CAREER_ADVICE", "SOFTWARE_IT"], availability: "MONTHLY" });
      await make("Alice Bose", { areas: ["CAREER_ADVICE"], availability: "WEEKLY" });
      await make("Bob Iyer", { areas: ["SOFTWARE_IT"], availability: "MONTHLY" });
      const quit = await make("Dev Stopped", {});
      await m(quit).stop();
      await make("Esha Suspended", {}, "SUSPENDED");
      await make("Farid Pending", {}, "PENDING");
      await offerToMentor(ctx, tenant.slug, viewer);

      expect(names(await m(viewer).mentors())).toEqual(["Alice Bose", "Bob Iyer", "Chitra Rao"]);
      expect(names(await m(viewer).mentors({ q: "iye" }))).toEqual(["Bob Iyer"]);
      expect(names(await m(viewer).mentors({ area: "SOFTWARE_IT" }))).toEqual(["Bob Iyer", "Chitra Rao"]);
      expect(names(await m(viewer).mentors({ availability: "WEEKLY" }))).toEqual(["Alice Bose"]);
      expect(names(await m(viewer).mentors({ area: "CAREER_ADVICE", availability: "MONTHLY" }))).toEqual(["Chitra Rao"]);
      expect((await m(viewer).mentors({ area: "ASTROLOGY" })).status).toBe(400);

      const first = await m(viewer).mentors({ limit: 2 });
      expect(names(first)).toEqual(["Alice Bose", "Bob Iyer"]);
      const second = await m(viewer).mentors({ limit: 2, cursor: first.body.nextCursor });
      expect(names(second)).toEqual(["Chitra Rao"]);
      expect(second.body.nextCursor).toBeNull();
      expect(first.body.data[0]).toEqual({ member: expect.objectContaining({ fullName: "Alice Bose" }), areas: ["CAREER_ADVICE"], availability: "WEEKLY" });
      expect(first.headers["cache-control"]).toBe("no-store");
    });

    it("leaves out a mentor the viewer blocked, on the list and their page, but not one who blocked the viewer", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const other = await memberSession(ctx, tenant.id, { fullName: "Zara Other" });
      await offerToMentor(ctx, tenant.slug, mentor);
      await offerToMentor(ctx, tenant.slug, other);
      await chatApi(ctx, tenant.slug, mentee).block(mentor.membership.id);
      await chatApi(ctx, tenant.slug, other).block(mentee.membership.id);
      expect(names(await m(mentee).mentors())).toEqual(["Zara Other"]);
      expect((await m(mentee).mentor(mentor.membership.id)).status).toBe(404);
      expect((await m(mentee).mentor(other.membership.id)).status).toBe(200);
      const refused = await m(mentee).request(mentor.membership.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
    });

    it("shows a mentor's own page with both notes and the viewer's open request, and 404s anyone the list leaves out", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const page = (await m(mentee).mentor(mentor.membership.id)).body.data;
      expect(page).toMatchObject({ availabilityNote: "Weekday evenings", note: MENTOR_PROFILE.note, isMe: false, myRequest: null });
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      expect((await m(mentee).mentor(mentor.membership.id)).body.data.myRequest).toEqual({ id: asked.id, status: "REQUESTED", conversationId: null });
      expect((await m(mentor).mentor(mentor.membership.id)).body.data).toMatchObject({ isMe: true, myRequest: null });
      expect((await m(mentor).mentor(mentee.membership.id)).status).toBe(404);
      await m(mentor).stop();
      expect((await m(mentee).mentor(mentor.membership.id)).status).toBe(404);
    });
  });

  describe("asking a mentor", () => {
    it("shows the mentor the note, tells them without naming anyone, and audits ids only", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await m(mentee).request(mentor.membership.id);
      expect(asked.status).toBe(201);
      expect(asked.body.data).toMatchObject({ box: "sent", status: "REQUESTED", note: NOTE, conversationId: null, member: { id: mentor.membership.id }, canWithdraw: true, canAccept: false, canEnd: false });
      const received = await m(mentor).requests("received");
      expect(received.body).toMatchObject({ waiting: 1, nextCursor: null });
      expect(received.body.data).toEqual([expect.objectContaining({ id: asked.body.data.id, box: "received", note: NOTE, member: expect.objectContaining({ id: mentee.membership.id }), canAccept: true, canDecline: true, canReport: true, canWithdraw: false })]);
      expect(received.headers["cache-control"]).toBe("no-store");
      expect((await m(mentee).requests("sent")).body.waiting).toBe(1);

      const [notice] = await noticesTo(mentor, "MENTORSHIP_REQUESTED");
      expect(notice).toMatchObject({ title: "New mentorship request", body: null, data: { mentorshipId: asked.body.data.id, box: "received" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "mentorship", box: "received" });
      const [audit] = await audits("mentorship.request");
      expect(audit).toMatchObject({ targetType: "mentorship", targetId: asked.body.data.id, actorMembershipId: mentee.membership.id, metadata: {} });
    });

    it("refuses themselves, a member elsewhere, and anyone who isn't an available mentor", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      expect((await m(mentee).request(mentee.membership.id)).status).toBe(400);
      expect((await m(mentee).request("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81")).status).toBe(404);
      const unavailable = async () => {
        const res = await m(mentee).request(mentor.membership.id);
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
      };
      await unavailable();
      await offerToMentor(ctx, tenant.slug, mentor);
      await m(mentor).stop();
      await unavailable();
      await offerToMentor(ctx, tenant.slug, mentor);
      for (const status of ["SUSPENDED", "PENDING", "REJECTED"] as const) {
        await ctx.db.update(memberships).set({ status }).where(eq(memberships.id, mentor.membership.id));
        await unavailable();
      }
      expect(await ctx.db.select().from(mentorships)).toEqual([]);
    });

    it("takes a note of 10 to 500 characters once trimmed, cleaned like a message", async () => {
      const { tenant, mentor, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      for (const note of ["Too short", "     too short    ", "x".repeat(501), "​".repeat(12)]) {
        const mentee = await memberSession(ctx, tenant.id);
        expect((await m(mentee).request(mentor.membership.id, note)).status, JSON.stringify(note)).toBe(400);
      }
      const mentee = await memberSession(ctx, tenant.id);
      const asked = await m(mentee).request(mentor.membership.id, `  Ten chars\u0007!  `);
      expect(asked.status).toBe(201);
      expect(asked.body.data.note).toBe("Ten chars!");
      const longest = await memberSession(ctx, tenant.id);
      expect((await m(longest).request(mentor.membership.id, "y".repeat(500))).status).toBe(201);
    });

    it("allows one open request per mentor, and none while a mentorship with them is under way", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const first = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      expect((await m(mentee).request(mentor.membership.id)).status).toBe(409);
      await m(mentee).withdraw(first.id);
      const second = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      await m(mentor).accept(second.id);
      const again = await m(mentee).request(mentor.membership.id);
      expect(again.status).toBe(409);
      expect(again.body.error.message).toBe("They're already your mentor");
      // The other way round is a different mentorship.
      await offerToMentor(ctx, tenant.slug, mentee);
      expect((await m(mentor).request(mentee.membership.id)).status).toBe(201);
    });

    it("allows three requests to one mentor in thirty days, whatever became of them", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
        ids.push(asked.id);
        if (i === 0) await m(mentee).withdraw(asked.id);
        if (i === 1) await m(mentor).decline(asked.id);
        if (i === 2) {
          await m(mentor).accept(asked.id);
          await m(mentor).end(asked.id);
          // Long enough ago that the wait after a mentorship ends is over, so only the count is in play here.
          await ctx.db.execute(sql`update mentorships set ended_at = now() - interval '31 days' where id = ${asked.id}`);
        }
      }
      const refused = await m(mentee).request(mentor.membership.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/up to 3 times in 30 days/);
      await ctx.db.execute(sql`update mentorships set created_at = now() - interval '31 days' where id = ${ids[0]!}`);
      expect((await m(mentee).request(mentor.membership.id)).status).toBe(201);
    });

    it("refuses asking again for thirty days after a mentorship between the two ends, whichever way round, as its chat stays closed", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      await m(mentee).end(dto.id);
      for (const [asker, asked] of [
        [mentee, mentor],
        [mentor, mentee],
      ] as const) {
        await offerToMentor(ctx, tenant.slug, asked);
        const refused = await m(asker).request(asked.membership.id);
        expect(refused.status).toBe(409);
        expect(refused.body.error.message).toBe("Your mentorship with them ended recently. You can ask them again 30 days after it ended.");
      }
      expect(await conversationRow(ctx, dto.conversationId!)).toMatchObject({ directState: "CLOSED" });
      // A request that was withdrawn or declined, and never under way, doesn't start the wait.
      const other = await memberSession(ctx, tenant.id);
      await m(other).withdraw((await askMentor(ctx, tenant.slug, other, mentor.membership.id)).id);
      expect((await m(other).request(mentor.membership.id)).status).toBe(201);
      // Once it's over, asking works again, within the usual limits.
      await ctx.db.execute(sql`update mentorships set ended_at = now() - interval '31 days' where id = ${dto.id}`);
      expect((await m(mentee).request(mentor.membership.id)).status).toBe(201);
    });

    it(`allows ${MENTORSHIP_MAX_OPEN_PER_MENTEE} requests and mentorships open at once`, async () => {
      const { tenant, mentee, m } = await setup();
      const mentors = [];
      for (let i = 0; i <= MENTORSHIP_MAX_OPEN_PER_MENTEE; i++) {
        const s = await memberSession(ctx, tenant.id);
        await offerToMentor(ctx, tenant.slug, s);
        mentors.push(s);
      }
      const asked = [];
      for (const s of mentors.slice(0, MENTORSHIP_MAX_OPEN_PER_MENTEE)) asked.push(await askMentor(ctx, tenant.slug, mentee, s.membership.id));
      await m(mentors[0]!).accept(asked[0]!.id);
      const refused = await m(mentee).request(mentors.at(-1)!.membership.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/up to 5 requests and mentorships open/);
      await m(mentors[0]!).end(asked[0]!.id);
      expect((await m(mentee).request(mentors.at(-1)!.membership.id)).status).toBe(201);
    });

    it("counts requests against mentorship-request, 10 an hour, before anything else", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      await withLimits(async () => {
        await ctx.redis.set(keys.rateLimit("mentorship-request", mentee.membership.id), "10");
        const refused = await m(mentee).request(mentor.membership.id);
        expect(refused.status).toBe(429);
      });
      expect(await ctx.db.select().from(mentorships)).toEqual([]);
    });
  });

  describe("blocks stay invisible", () => {
    /** Everything a requester can read about one request, and what they get for asking again. */
    async function requesterView(api: ReturnType<typeof mentorshipApi>, mentorId: string, id: string) {
      const sent = (await api.requests("sent")).body;
      const page = (await api.mentor(mentorId)).body.data;
      const again = await api.request(mentorId);
      return {
        row: comparableMentorship((sent.data as MentorshipDto[]).find((r) => r.id === id)!),
        waiting: sent.waiting,
        myRequest: page.myRequest && { ...page.myRequest, id: "<id>" },
        again: { status: again.status, error: again.body.error },
      };
    }

    it("answers a request to a mentor who blocked the requester exactly as one who didn't, and tells and audits nothing", async () => {
      const { tenant, mentee, m } = await setup();
      const open = await memberSession(ctx, tenant.id, { fullName: "Open Mentor" });
      const blocker = await memberSession(ctx, tenant.id, { fullName: "Blocking Mentor" });
      for (const s of [open, blocker]) await offerToMentor(ctx, tenant.slug, s);
      await chatApi(ctx, tenant.slug, blocker).block(mentee.membership.id);
      realtime.clear();

      const real = await m(mentee).request(open.membership.id);
      const hidden = await m(mentee).request(blocker.membership.id);
      expect(hidden.status).toBe(real.status);
      expect(comparableMentorship(hidden.body.data)).toEqual(comparableMentorship(real.body.data));
      expect(await requesterView(m(mentee), blocker.membership.id, hidden.body.data.id)).toEqual(await requesterView(m(mentee), open.membership.id, real.body.data.id));
      expect((await row(hidden.body.data.id)).suppressed).toBe(true);

      // The mentor who blocked them never sees it, and can't act on it.
      expect((await m(blocker).requests("received")).body).toMatchObject({ data: [], waiting: 0 });
      for (const res of [await m(blocker).accept(hidden.body.data.id), await m(blocker).decline(hidden.body.data.id), await m(blocker).report(hidden.body.data.id)]) expect(res.status).toBe(404);
      expect(await noticesTo(blocker)).toEqual([]);
      expect((await noticesTo(open, "MENTORSHIP_REQUESTED")).length).toBe(1);
      expect((await audits("mentorship.request")).map((a) => a.targetId)).toEqual([real.body.data.id]);
      expect(realtime.to(blocker.user.id)).toEqual([]);
      expect(realtime.to(open.user.id, "mentorship:changed")).toHaveLength(1);
      expect(realtime.to(mentee.user.id, "mentorship:changed")).toHaveLength(2);

      // Withdrawing reads the same too, and audits only the one the mentor could see, and tells only them.
      const withdrawnReal = await m(mentee).withdraw(real.body.data.id);
      const withdrawnHidden = await m(mentee).withdraw(hidden.body.data.id);
      expect(comparableMentorship(withdrawnHidden.body.data)).toEqual(comparableMentorship(withdrawnReal.body.data));
      expect((await audits("mentorship.withdraw")).map((a) => a.targetId)).toEqual([real.body.data.id]);
      expect(realtime.to(blocker.user.id)).toEqual([]);
      expect(realtime.to(open.user.id, "mentorship:changed")).toHaveLength(2);
    });

    it("counts a suppressed request against every limit like any other", async () => {
      const { tenant, mentee, m } = await setup();
      const blocker = await memberSession(ctx, tenant.id);
      const another = await memberSession(ctx, tenant.id);
      for (const s of [blocker, another]) {
        await offerToMentor(ctx, tenant.slug, s);
        await chatApi(ctx, tenant.slug, s).block(mentee.membership.id);
      }
      // One open request per mentor.
      const first = await askMentor(ctx, tenant.slug, mentee, blocker.membership.id);
      expect((await m(mentee).request(blocker.membership.id)).body.error.message).toMatch(/already asked/);
      // Three to one mentor in thirty days.
      await m(mentee).withdraw(first.id);
      for (let i = 0; i < 2; i++) await m(mentee).withdraw((await askMentor(ctx, tenant.slug, mentee, blocker.membership.id)).id);
      expect((await m(mentee).request(blocker.membership.id)).body.error.message).toMatch(/up to 3 times in 30 days/);
      // And the open requests a mentee may have, all of which can be suppressed ones.
      await askMentor(ctx, tenant.slug, mentee, another.membership.id);
      for (let i = 0; i < MENTORSHIP_MAX_OPEN_PER_MENTEE - 1; i++) {
        const s = await memberSession(ctx, tenant.id);
        await offerToMentor(ctx, tenant.slug, s);
        await askMentor(ctx, tenant.slug, mentee, s.membership.id);
      }
      const last = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, last);
      expect((await m(mentee).request(last.membership.id)).body.error.message).toMatch(/up to 5 requests and mentorships open/);
      expect((await m(mentee).requests("sent")).body.waiting).toBe(MENTORSHIP_MAX_OPEN_PER_MENTEE);
    });

    it("blocking withdraws your own waiting requests to them and suppresses theirs to you, silently, and leaves mentorships under way", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const third = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      await offerToMentor(ctx, tenant.slug, mentee);
      const theirs = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      const mine = await askMentor(ctx, tenant.slug, mentor, mentee.membership.id);
      const underWay = await acceptedMentorship(ctx, tenant.slug, third, mentor);
      const before = (await m(mentee).requests("sent")).body.data.map(comparableMentorship);
      await ctx.db.delete(notifications);
      realtime.clear();

      expect((await chatApi(ctx, tenant.slug, mentor).block(mentee.membership.id)).status).toBe(201);
      // The blocker's lists refresh, and so do the blocked member's, as for a request withdrawn by hand, and nobody else's.
      expect(realtime.to(mentor.user.id, "mentorship:changed")).toHaveLength(1);
      expect(realtime.to(mentee.user.id, "mentorship:changed")).toHaveLength(1);
      expect(realtime.to(third.user.id, "mentorship:changed")).toEqual([]);
      expect(await row(theirs.id)).toMatchObject({ status: "REQUESTED", suppressed: true });
      expect(await row(mine.id)).toMatchObject({ status: "ENDED", endedByMembershipId: mentor.membership.id, acceptedAt: null });
      expect(await row(underWay.id)).toMatchObject({ status: "ACCEPTED" });
      // The member who was blocked sees their request as it was, and the other one as withdrawn, as if by hand.
      expect((await m(mentee).requests("sent")).body.data.map(comparableMentorship)).toEqual(before);
      expect((await m(mentee).requests("received")).body.data.find((r: MentorshipDto) => r.id === mine.id)).toMatchObject({ status: "ENDED", acceptedAt: null, endedByMe: false });
      expect((await m(mentor).requests("received")).body.data).toEqual([]);
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await m(mentor).accept(theirs.id)).status).toBe(404);
      // Unblocking brings nothing back: their request stays out of sight, as a declined message request stays declined.
      await chatApi(ctx, tenant.slug, mentor).unblock(mentee.membership.id);
      expect((await m(mentor).requests("received")).body.waiting).toBe(0);
    });

    it("blocking a mentor who blocked you first tells them nothing of your request they never saw", async () => {
      const { tenant, mentor, mentee } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      await chatApi(ctx, tenant.slug, mentor).block(mentee.membership.id);
      const hidden = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      realtime.clear();

      expect((await chatApi(ctx, tenant.slug, mentee).block(mentor.membership.id)).status).toBe(201);
      expect(await row(hidden.id)).toMatchObject({ status: "ENDED", suppressed: true });
      // Withdrawn as it would be by hand, which wouldn't tell the mentor either: only the blocker's own lists refresh.
      expect(realtime.to(mentor.user.id)).toEqual([]);
      expect(realtime.to(mentee.user.id, "mentorship:changed")).toHaveLength(1);
      expect(await noticesTo(mentor)).toEqual([]);
    });

    for (const how of ["stopping mentoring", "an admin taking the mentor off the list"] as const) {
      it(`${how} declines a suppressed request exactly as a real one, telling both senders alike and the mentor nothing of it`, async () => {
        const { tenant, mentor, mentee, m } = await setup();
        const other = await memberSession(ctx, tenant.id);
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        await offerToMentor(ctx, tenant.slug, mentor);
        await chatApi(ctx, tenant.slug, mentor).block(mentee.membership.id);
        const hidden = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
        const real = await askMentor(ctx, tenant.slug, other, mentor.membership.id);
        await ctx.jobs.drain();
        realtime.clear();
        const mentorNotices = await noticesTo(mentor);

        const done = how === "stopping mentoring" ? await m(mentor).stop() : await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/mentors/${mentor.membership.id}/remove`).set(admin.headers).send();
        expect(done.status).toBeLessThan(300);
        const view = async (s: Session, id: string) => comparableMentorship(((await m(s).requests("sent")).body.data as MentorshipDto[]).find((r) => r.id === id)!);
        expect(await view(mentee, hidden.id)).toEqual(await view(other, real.id));
        expect((await view(other, real.id)).status).toBe("DECLINED");
        // The bell and the live events read the same for both, the one the mentor never saw included: theirs changed as the other's did.
        expect(await toldTo(mentee)).toEqual(await toldTo(other));
        expect(realtime.to(mentee.user.id).map((e) => e.event)).toEqual(["mentorship:changed", "notification:new"]);
        const [declined] = await noticesTo(other, "MENTORSHIP_DECLINED");
        expect(declined).toMatchObject({
          ...(how === "stopping mentoring" ? { title: "Mira Mentor declined your mentorship request", body: null } : { title: "Your mentorship request was closed", body: "Mira Mentor isn't taking mentorship requests any more." }),
          data: { mentorshipId: real.id, box: "sent" },
        });
        // Nothing about it reaches the mentor: no notification, no audit row, and no live event but the one their own lists get anyway.
        expect(await noticesTo(mentor)).toEqual(mentorNotices);
        expect(await ctx.db.select().from(auditLog).where(eq(auditLog.targetId, hidden.id))).toEqual([]);
        expect(realtime.to(mentor.user.id).map((e) => e.event)).toEqual(["mentorship:changed"]);
      });
    }
  });

  describe("accepting", () => {
    it("opens a chat whose first message is the note, from the mentee, and tells the mentee with a link into it", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      ctx.jobs.clear();
      const accepted = await m(mentor).accept(asked.id);
      expect(accepted.status).toBe(200);
      const dto = accepted.body.data as MentorshipDto;
      expect(dto).toMatchObject({ status: "ACCEPTED", box: "received", canEnd: true, canAccept: false, conversationId: expect.any(String) });
      expect(dto.acceptedAt).toBe(dto.respondedAt);
      expect(await conversationRow(ctx, dto.conversationId!)).toMatchObject({ origin: "MENTORSHIP", originId: asked.id, directState: "ACCEPTED", lastSeq: 1 });
      const messages = (await chatApi(ctx, tenant.slug, mentor).messages(dto.conversationId!)).body.data as ChatMessageDto[];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ body: NOTE, sender: { id: mentee.membership.id }, kind: "TEXT" });
      expect(realtime.to(mentee.user.id, "chat:message").length + realtime.to(mentee.user.id, "chat:changed").length).toBeGreaterThan(0);

      const [notice] = await noticesTo(mentee, "MENTORSHIP_ACCEPTED");
      expect(notice).toMatchObject({ title: "Mira Mentor accepted your mentorship request", body: null, data: { mentorshipId: asked.id, conversationId: dto.conversationId, box: "sent" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "chat", conversationId: dto.conversationId });
      // Its own notification says so, so the chat opening doesn't push a second time.
      expect(ctx.jobs.peek("chat.pushEvent")).toEqual([]);
      expect(ctx.jobs.peek("chat.pushConversation")).toEqual([]);
      expect((await m(mentee).requests("sent")).body.data[0]).toMatchObject({ status: "ACCEPTED", conversationId: dto.conversationId, canEnd: true, canWithdraw: false });
      expect((await chatApi(ctx, tenant.slug, mentee).send(dto.conversationId!, "Thank you!")).status).toBe(201);
      expect((await audits("mentorship.accept")).map((a) => a.targetId)).toEqual([asked.id]);
    });

    it("reuses the accepted chat they already had, keeping what started it, with the note as its latest message and no push of it", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const existing = await acceptedThread(ctx, tenant.slug, mentee, mentor);
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      ctx.jobs.clear();
      const dto = (await m(mentor).accept(asked.id)).body.data as MentorshipDto;
      expect(dto.conversationId).toBe(existing);
      expect(await conversationRow(ctx, existing)).toMatchObject({ origin: "MESSAGE_REQUEST", originId: null, directState: "ACCEPTED", lastSeq: 2 });
      const [latest] = (await chatApi(ctx, tenant.slug, mentor).messages(existing)).body.data as ChatMessageDto[];
      expect(latest).toMatchObject({ body: NOTE, sender: { id: mentee.membership.id } });
      // The chat was open already, so only the quiet flag keeps the note from being pushed on top of MENTORSHIP_ACCEPTED.
      expect(ctx.jobs.peek("chat.pushConversation")).toEqual([]);
      expect(ctx.jobs.peek("chat.pushEvent")).toEqual([]);
    });

    it("can't be done once the mentor has stopped, even for a request left waiting", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      // As a request that committed just after stopping would be left, had it got past the lock that stops it.
      await ctx.db.update(mentorProfiles).set({ isActive: false }).where(eq(mentorProfiles.membershipId, mentor.membership.id));
      const refused = await m(mentor).accept(asked.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      expect(await row(asked.id)).toMatchObject({ status: "REQUESTED", conversationId: null });
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
    });

    it("can't be asked of a mentor whose stopping is committing at that moment: the request waits for it, then sees them gone", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const stopping = await ctx.pool.connect();
      try {
        // Stopping, part way: the profile is going inactive, and the transaction hasn't committed.
        await stopping.query("begin");
        await stopping.query("update mentor_profiles set is_active = false where membership_id = $1", [mentor.membership.id]);
        const asking = Promise.resolve(m(mentee).request(mentor.membership.id));
        await waitForLockWait();
        await stopping.query("commit");
        const refused = await asking;
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      } finally {
        await stopping.query("rollback").catch(() => undefined);
        stopping.release();
      }
      expect(await ctx.db.select().from(mentorships)).toEqual([]);
    });

    it("closes a request that commits while its mentor's account is being deleted, along with the account's own", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const sending = await ctx.pool.connect();
      let id = "";
      try {
        // A request part way through: inserted and not yet committed, so its foreign key holds the mentor's membership.
        await sending.query("begin");
        const inserted = await sending.query<{ id: string }>("insert into mentorships (tenant_id, mentor_membership_id, mentee_membership_id, note) values ($1, $2, $3, $4) returning id", [tenant.id, mentor.membership.id, mentee.membership.id, NOTE]);
        id = inserted.rows[0]!.id;
        const deleting = Promise.resolve(request(ctx.app).post("/api/v1/me/delete").set(mentor.headers).send({ confirm: true }));
        await waitForLockWait();
        await sending.query("commit");
        expect((await deleting).status).toBeLessThan(300);
      } finally {
        await sending.query("rollback").catch(() => undefined);
        sending.release();
      }
      expect(await row(id)).toMatchObject({ status: "DECLINED", mentorMembershipId: null, respondedAt: expect.any(Date) });
      expect((await m(mentee).summary()).body.data).toEqual({ listed: false, open: 0 });
      expect(await noticesTo(mentee)).toEqual([]);
    });

    it("reads both members and the institution again now, and leaves nothing behind when it refuses", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, mentee.membership.id));
      const unavailable = await m(mentor).accept(asked.id);
      expect(unavailable.status).toBe(409);
      expect(unavailable.body.error.code).toBe("CONTACT_UNAVAILABLE");
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, mentee.membership.id));
      // The request's cached copy of the institution still says on. Mentorship alone, because opening the chat checks messaging itself.
      for (const features of [{ messaging: true, mentorship: false }, { messaging: false }]) {
        await ctx.db.update(tenantSettings).set({ features }).where(eq(tenantSettings.tenantId, tenant.id));
        const off = await m(mentor).accept(asked.id);
        expect(off.status, JSON.stringify(features)).toBe(403);
        expect(off.body.error.code).toBe("FEATURE_DISABLED");
      }
      expect(await row(asked.id)).toMatchObject({ status: "REQUESTED", conversationId: null });
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
      expect(await noticesTo(mentee, "MENTORSHIP_ACCEPTED")).toEqual([]);
    });

    it("is the mentor's alone, once: anyone else gets a 404 or a 409, and two at once open one chat", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const stranger = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      expect((await m(stranger).accept(asked.id)).status).toBe(404);
      expect((await m(stranger).decline(asked.id)).status).toBe(404);
      expect((await m(mentee).accept(asked.id)).status).toBe(409);
      const results = await Promise.all([m(mentor).accept(asked.id), m(mentor).accept(asked.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await ctx.db.select().from(chatConversations)).toHaveLength(1);
      expect(await ctx.db.select().from(chatMessages)).toHaveLength(1);
      expect((await m(mentor).decline(asked.id)).status).toBe(409);
    });
  });

  describe("declining and withdrawing", () => {
    it("declining tells the mentee by the mentor's name, opens no chat, and audits ids only", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      const declined = await m(mentor).decline(asked.id);
      // Its note can still be reported: it never became a mentorship.
      expect(declined.body.data).toMatchObject({ status: "DECLINED", respondedAt: expect.any(String), canAccept: false, canDecline: false, canReport: true });
      expect((await m(mentee).requests("sent")).body.data[0]).toMatchObject({ status: "DECLINED", canWithdraw: false });
      const [notice] = await noticesTo(mentee, "MENTORSHIP_DECLINED");
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "mentorship", box: "sent" });
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
      expect((await audits("mentorship.decline"))[0]).toMatchObject({ targetId: asked.id, metadata: {} });
    });

    it("withdrawing is the mentee's, tells the mentor nothing, and reads as withdrawn on both lists", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      await ctx.db.delete(notifications);
      expect((await m(mentor).withdraw(asked.id)).status).toBe(409);
      const withdrawn = await m(mentee).withdraw(asked.id);
      expect(withdrawn.body.data).toMatchObject({ status: "ENDED", acceptedAt: null, endedByMe: true, canWithdraw: false });
      expect((await m(mentor).requests("received")).body).toMatchObject({ waiting: 0, data: [expect.objectContaining({ status: "ENDED", acceptedAt: null, endedByMe: false })] });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await m(mentee).withdraw(asked.id)).status).toBe(409);
    });
  });

  describe("ending", () => {
    it("is open to either side, closes the chat the mentorship opened, read-only, and tells the other side", async () => {
      for (const ender of ["mentor", "mentee"] as const) {
        const { tenant, mentor, mentee, m } = await setup();
        const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
        const by = ender === "mentor" ? mentor : mentee;
        const other = ender === "mentor" ? mentee : mentor;
        const theirBox = ender === "mentor" ? "sent" : "received";
        const ended = await m(by).end(dto.id);
        expect(ended.status).toBe(200);
        expect(ended.body.data).toMatchObject({ status: "ENDED", endedByMe: true, canEnd: false, conversationId: dto.conversationId });
        expect(await conversationRow(ctx, dto.conversationId!)).toMatchObject({ directState: "CLOSED" });
        const refused = await chatApi(ctx, tenant.slug, other).send(dto.conversationId!, "Still there?");
        expect(refused.status).toBe(409);
        const [notice] = await noticesTo(other, "MENTORSHIP_ENDED");
        expect(notice).toMatchObject({ title: `${ender === "mentor" ? "Mira Mentor" : "Manu Mentee"} ended your mentorship`, data: { mentorshipId: dto.id, box: theirBox } });
        expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "mentorship", box: theirBox });
        expect(await noticesTo(by, "MENTORSHIP_ENDED")).toEqual([]);
        expect((await m(by).end(dto.id)).status).toBe(409);
      }
    });

    it("leaves a chat the mentorship didn't open as it was", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const existing = await acceptedThread(ctx, tenant.slug, mentee, mentor);
      const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      await m(mentee).end(dto.id);
      expect(await conversationRow(ctx, existing)).toMatchObject({ directState: "ACCEPTED", origin: "MESSAGE_REQUEST" });
      expect((await chatApi(ctx, tenant.slug, mentor).send(existing, "Still talking")).status).toBe(201);
    });

    it("keeps the chat open while another mentorship connects the pair, whichever way round, and closes it with the last", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const first = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      const second = await acceptedMentorship(ctx, tenant.slug, mentee, mentor, "And I can help you with design, if you like?");
      expect(second.conversationId).toBe(first.conversationId);
      await m(mentor).end(first.id);
      expect(await conversationRow(ctx, first.conversationId!)).toMatchObject({ directState: "ACCEPTED" });
      await m(mentor).end(second.id);
      expect(await conversationRow(ctx, first.conversationId!)).toMatchObject({ directState: "CLOSED" });
    });

    it("keeps the chat open while a referral one of them accepted for the other connects the pair, whichever way round", async () => {
      for (const order of ["referral first", "mentorship first"] as const) {
        const { tenant, mentor, mentee, m } = await setup();
        // The referral goes the other way: the mentee posted a job and the mentor asked.
        const opened = order === "referral first" ? (await acceptedReferral(ctx, tenant.slug, mentee, mentor)).referral.conversationId : null;
        const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
        if (order === "mentorship first") await acceptedReferral(ctx, tenant.slug, mentee, mentor);
        const conversationId = dto.conversationId!;
        if (opened) expect(conversationId).toBe(opened);
        expect(await conversationRow(ctx, conversationId)).toMatchObject({ origin: order === "referral first" ? "REFERRAL" : "MENTORSHIP", directState: "ACCEPTED" });
        await m(mentee).end(dto.id);
        expect(await conversationRow(ctx, conversationId), order).toMatchObject({ directState: "ACCEPTED" });
        expect((await chatApi(ctx, tenant.slug, mentor).send(conversationId, "Still here for the referral")).status).toBe(201);
      }
    });
  });

  describe("the ways out", () => {
    for (const off of [{ messaging: false }, { mentorship: false }]) {
      it(`work with ${Object.keys(off)[0]} off, while starting anything is refused, and nothing is deleted`, async () => {
        const { tenant, mentor, mentee, m } = await setup();
        const waitingMentee = await memberSession(ctx, tenant.id);
        const reportedMentee = await memberSession(ctx, tenant.id);
        const underWay = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
        const waiting = await askMentor(ctx, tenant.slug, waitingMentee, mentor.membership.id);
        const reported = await askMentor(ctx, tenant.slug, reportedMentee, mentor.membership.id);
        await request(ctx.app).patch(`/api/v1/t/${tenant.slug}/admin/settings`).set((await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" })).headers).send({ features: off }).expect(200);

        for (const res of [await m(mentee).mentors(), await m(mentee).mentor(mentor.membership.id), await m(mentee).request(mentor.membership.id), await m(mentor).accept(waiting.id), await m(mentor).decline(waiting.id), await m(mentor).save()]) {
          expect(res.status, res.request.url).toBe(403);
          expect(res.body.error.code, res.request.url).toBe("FEATURE_DISABLED");
        }
        expect((await m(mentor).requests("received")).body.data).toHaveLength(3);
        expect((await m(mentor).me()).body.data.isActive).toBe(true);
        expect((await m(waitingMentee).withdraw(waiting.id)).status).toBe(200);
        expect((await m(mentor).report(reported.id)).status).toBe(200);
        expect((await m(mentee).end(underWay.id)).status).toBe(200);
        expect((await m(mentor).stop()).status).toBe(204);
        expect(await ctx.db.select().from(mentorships)).toHaveLength(3);
        expect(await ctx.db.select().from(mentorProfiles)).toHaveLength(1);
      });
    }
  });

  describe("reporting a request", () => {
    it("declines it, telling the mentee exactly as a decline would, and files a report that holds only the note for an eligible admin", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const declinedMentee = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      const declined = await askMentor(ctx, tenant.slug, declinedMentee, mentor.membership.id);
      await ctx.jobs.drain();
      realtime.clear();
      const reported = await m(mentor).report(asked.id, { reason: "INAPPROPRIATE", details: "Not a mentorship request" });
      expect(reported.status).toBe(200);
      expect(reported.body.data).toMatchObject({ status: "DECLINED", canReport: false });
      expect((await m(mentee).requests("sent")).body.data[0]).toMatchObject({ status: "DECLINED" });
      // Its sender hears of it in the bell and live exactly as of the mentor declining it, so nothing tells them it was reported.
      expect((await m(mentor).decline(declined.id)).status).toBe(200);
      expect(await toldTo(mentee)).toEqual(await toldTo(declinedMentee));
      expect(realtime.to(mentee.user.id).map((e) => e.event)).toEqual(["mentorship:changed", "notification:new"]);
      expect(await noticesTo(mentee)).toEqual([
        expect.objectContaining({ type: "MENTORSHIP_DECLINED", title: "Mira Mentor declined your mentorship request", body: null, data: { mentorshipId: asked.id, box: "sent" }, dedupeKey: `mentorship-declined-${asked.id}` }),
      ]);

      const [report] = await ctx.db.select().from(chatReports);
      expect(report).toMatchObject({ targetKind: "MENTORSHIP_NOTE", targetId: asked.id, conversationId: null, reporterMembershipId: mentor.membership.id, reportedMembershipId: mentee.membership.id, noteSnapshot: NOTE, reason: "INAPPROPRIATE", contextMessageIds: [] });
      const [filed] = await audits("chat_report.file");
      expect(filed).toMatchObject({ actorUserId: null, actorMembershipId: null, targetId: report!.id, metadata: { reason: "INAPPROPRIATE", targetKind: "MENTORSHIP_NOTE" } });
      // A decline audited by the reporter at the same moment would name them: only the one declined by hand is.
      expect((await audits("mentorship.decline")).map((a) => a.targetId)).toEqual([declined.id]);
      const told = await noticesTo(admin, "CHAT_REPORT_FILED");
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ title: "A mentorship request was reported", body: null, data: { chatReportId: report!.id } });

      const view = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/chat-reports/${report!.id}/view`).set(admin.headers).send();
      expect(view.body.data as AdminChatReportViewDto).toMatchObject({ targetKind: "MENTORSHIP_NOTE", noteSnapshot: NOTE, messages: [] });
    });

    it("is the mentor's, once per request", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      expect((await m(mentee).report(asked.id)).status).toBe(400);
      expect((await m(mentor).report(asked.id, { reason: "LOUD" })).status).toBe(400);
      expect((await m(mentor).report(asked.id)).status).toBe(200);
      expect((await m(mentor).report(asked.id)).status).toBe(409);
      expect(await ctx.db.select().from(chatReports)).toHaveLength(1);
      expect((await m(mentor).requests("received")).body.data[0]).toMatchObject({ id: asked.id, canReport: false });
    });

    it("reaches a note its sender withdrew, which the mentor can still read, changing nothing and telling nobody", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      await offerToMentor(ctx, tenant.slug, mentor);
      const SECRET = "An abusive note sent and withdrawn at once 7Q2X";
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id, SECRET);
      await m(mentee).withdraw(asked.id);
      const [before] = (await m(mentor).requests("received")).body.data as MentorshipDto[];
      expect(before).toMatchObject({ id: asked.id, status: "ENDED", acceptedAt: null, note: SECRET, canReport: true });
      const menteeView = (await m(mentee).requests("sent")).body.data;
      await ctx.db.delete(notifications);
      realtime.clear();

      const reported = await m(mentor).report(asked.id, { reason: "HARASSMENT" });
      expect(reported.status).toBe(200);
      expect(reported.body.data).toMatchObject({ status: "ENDED", canReport: false });
      expect(await row(asked.id)).toMatchObject({ status: "ENDED", respondedAt: null });
      expect((await m(mentee).requests("sent")).body.data).toEqual(menteeView);
      expect(await noticesTo(mentee)).toEqual([]);
      expect(realtime.to(mentee.user.id)).toEqual([]);
      const [report] = await ctx.db.select().from(chatReports);
      expect(report).toMatchObject({ targetKind: "MENTORSHIP_NOTE", targetId: asked.id, reportedMembershipId: mentee.membership.id, noteSnapshot: SECRET });
      expect(await noticesTo(admin, "CHAT_REPORT_FILED")).toHaveLength(1);
      const view = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/chat-reports/${report!.id}/view`).set(admin.headers).send();
      expect(view.body.data).toMatchObject({ targetKind: "MENTORSHIP_NOTE", noteSnapshot: SECRET, messages: [] });
      expect((await m(mentor).report(asked.id)).status).toBe(409);
    });

    it("reaches a note the mentor declined, but not one that became a mentorship, whose note is in the chat", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const other = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      const declined = await askMentor(ctx, tenant.slug, other, mentor.membership.id);
      await m(mentor).decline(declined.id);
      const toldBefore = await toldTo(other);
      expect((await m(mentor).report(declined.id)).status).toBe(200);
      expect(await row(declined.id)).toMatchObject({ status: "DECLINED" });
      // Its sender heard of the decline, and hears nothing more.
      expect(await toldTo(other)).toEqual(toldBefore);

      const underWay = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      expect(underWay.canReport).toBe(false);
      expect((await m(mentor).report(underWay.id)).status).toBe(409);
      await m(mentor).end(underWay.id);
      const ended = ((await m(mentor).requests("received")).body.data as MentorshipDto[]).find((r) => r.id === underWay.id);
      expect(ended).toMatchObject({ status: "ENDED", canReport: false });
      expect((await m(mentor).report(underWay.id)).status).toBe(409);
      expect(await ctx.db.select().from(chatReports)).toHaveLength(1);
    });

    it("escalates a report about a tenant admin's request, which that admin hears nothing of", async () => {
      const { tenant, mentor, m } = await setup();
      const adminMentee = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, adminMentee, mentor.membership.id);
      await m(mentor).report(asked.id);
      expect(await noticesTo(adminMentee, "CHAT_REPORT_FILED")).toEqual([]);
      const staff = auth((await loginAs(ctx, "+919999999999")).accessToken);
      const escalated = await request(ctx.app).get("/api/v1/platform/chat-reports").set(staff);
      expect(escalated.body.total).toBe(1);
    });

    it("counts against chat-report, 30 an hour", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      await offerToMentor(ctx, tenant.slug, mentor);
      const asked = await askMentor(ctx, tenant.slug, mentee, mentor.membership.id);
      await withLimits(async () => {
        await ctx.redis.set(keys.rateLimit("chat-report", mentor.membership.id), "30");
        expect((await m(mentor).report(asked.id)).status).toBe(429);
      });
      expect((await row(asked.id)).status).toBe("REQUESTED");
    });
  });

  describe("rate limits", () => {
    const BUCKETS = [
      { bucket: "mentor-profile", limit: 30, hit: (m: ReturnType<typeof mentorshipApi>) => m.save() },
      { bucket: "mentor-profile", limit: 30, hit: (m: ReturnType<typeof mentorshipApi>) => m.stop() },
      { bucket: "connection-action", limit: 60, hit: (m: ReturnType<typeof mentorshipApi>) => m.end("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81") },
      { bucket: "connection-action", limit: 60, hit: (m: ReturnType<typeof mentorshipApi>) => m.withdraw("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81") },
      { bucket: "connection-action", limit: 60, hit: (m: ReturnType<typeof mentorshipApi>) => m.accept("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81") },
      { bucket: "connection-action", limit: 60, hit: (m: ReturnType<typeof mentorshipApi>) => m.decline("4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81") },
    ];
    for (const { bucket, limit, hit } of BUCKETS) {
      it(`${bucket} allows ${limit} an hour`, async () => {
        const { mentor, m } = await setup();
        await withLimits(async () => {
          const key = keys.rateLimit(bucket, mentor.membership.id);
          // The window starts with the first one counted.
          expect((await hit(m(mentor))).status).not.toBe(429);
          expect(await ctx.redis.ttl(key)).toBeGreaterThan(3600 - 5);
          await ctx.redis.set(key, String(limit - 1));
          expect((await hit(m(mentor))).status).not.toBe(429);
          expect((await hit(m(mentor))).status).toBe(429);
        });
      });
    }
  });

  describe("admins", () => {
    it("see a member's mentor profile, and can take them out of the list, declining what waits and leaving what's under way, audited with ids only", async () => {
      const { tenant, mentor, mentee, m } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const waitingMentee = await memberSession(ctx, tenant.id);
      const underWay = await acceptedMentorship(ctx, tenant.slug, mentor, mentee);
      const waiting = await askMentor(ctx, tenant.slug, waitingMentee, mentor.membership.id);
      const base = `/api/v1/t/${tenant.slug}/admin`;
      const detail = await request(ctx.app).get(`${base}/members/${mentor.membership.id}`).set(admin.headers);
      expect(detail.body.data.mentorProfile).toMatchObject({ note: MENTOR_PROFILE.note, availabilityNote: "Weekday evenings", isActive: true });
      expect((await request(ctx.app).get(`${base}/members/${mentee.membership.id}`).set(admin.headers)).body.data.mentorProfile).toBeNull();

      expect((await request(ctx.app).post(`${base}/mentors/${mentor.membership.id}/remove`).set(mentee.headers).send()).status).toBe(403);
      expect((await request(ctx.app).post(`${base}/mentors/${mentee.membership.id}/remove`).set(admin.headers).send()).status).toBe(404);
      const removed = await request(ctx.app).post(`${base}/mentors/${mentor.membership.id}/remove`).set(admin.headers).send();
      expect(removed.status).toBe(200);
      expect(removed.body.data.isActive).toBe(false);
      expect(names(await m(waitingMentee).mentors())).toEqual([]);
      expect(await row(waiting.id)).toMatchObject({ status: "DECLINED" });
      // Told it's closed, without being told the mentor declined it, which they didn't, or that an admin was involved.
      const closed = await noticesTo(waitingMentee, "MENTORSHIP_DECLINED");
      expect(closed).toHaveLength(1);
      expect(closed[0]).toMatchObject({ title: "Your mentorship request was closed", body: "Mira Mentor isn't taking mentorship requests any more.", data: { mentorshipId: waiting.id, box: "sent" } });
      expect(await row(underWay.id)).toMatchObject({ status: "ACCEPTED" });
      const [audit] = await audits("mentor.admin_remove");
      expect(audit).toMatchObject({ actorMembershipId: admin.membership.id, targetType: "membership", targetId: mentor.membership.id, metadata: {} });
      // Again changes nothing, and audits nothing new.
      expect((await request(ctx.app).post(`${base}/mentors/${mentor.membership.id}/remove`).set(admin.headers).send()).status).toBe(200);
      expect(await audits("mentor.admin_remove")).toHaveLength(1);
    });

    it("can't be done by an admin an open report names, such as one whose own request a mentor reported, and the attempt is kept", async () => {
      const { tenant, mentor, m } = await setup();
      const adminMentee = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const otherMentor = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      await offerToMentor(ctx, tenant.slug, otherMentor);
      await m(mentor).report((await askMentor(ctx, tenant.slug, adminMentee, mentor.membership.id)).id);
      const base = `/api/v1/t/${tenant.slug}/admin`;
      // The same answer whoever is targeted, so it doesn't point at the reporter.
      for (const target of [mentor, otherMentor]) {
        const refused = await request(ctx.app).post(`${base}/mentors/${target.membership.id}/remove`).set(adminMentee.headers).send();
        expect(refused.status).toBe(403);
        expect(refused.body.error).toMatchObject({ code: "NEEDS_ANOTHER_ADMIN", message: "This needs another admin or Illuminize staff" });
      }
      expect(await ctx.db.select().from(mentorProfiles).where(eq(mentorProfiles.isActive, false))).toEqual([]);
      expect(await audits("mentor.admin_remove")).toEqual([]);
      expect((await audits("membership.action_refused")).map((a) => a.metadata)).toEqual([{ attempted: "mentor.admin_remove" }, { attempted: "mentor.admin_remove" }]);
      // Another admin can.
      const other = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      expect((await request(ctx.app).post(`${base}/mentors/${mentor.membership.id}/remove`).set(other.headers).send()).status).toBe(200);
    });
  });

  describe("a note's words", () => {
    it("never reach a notification, an audit row or a job's payload", async () => {
      const SECRET = "A note only the mentor and the chat may hold 9K2Q";
      const { tenant, mentor, mentee, m } = await setup();
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const dto = await acceptedMentorship(ctx, tenant.slug, mentor, mentee, SECRET);
      await m(mentor).end(dto.id);
      const another = await memberSession(ctx, tenant.id);
      await m(mentor).report((await askMentor(ctx, tenant.slug, another, mentor.membership.id, SECRET)).id);
      const declined = await memberSession(ctx, tenant.id);
      await offerToMentor(ctx, tenant.slug, mentor);
      await m(mentor).decline((await askMentor(ctx, tenant.slug, declined, mentor.membership.id, SECRET)).id);
      await ctx.jobs.drain();
      const everywhere = JSON.stringify([await ctx.db.select().from(notifications), await ctx.db.select().from(auditLog), ctx.jobs.history]);
      expect(everywhere).not.toContain(SECRET);
      expect(everywhere).toContain(dto.id);
      expect(admin.membership.id).toBeTruthy();
    });
  });

  describe("demo data", () => {
    it("seeds mentors in the university and the Samaj only, requests waiting and a mentorship under way with the chat it opened, and none of the e2e members", async () => {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const membershipIds = await seedMembers(ctx.db, tenantIds);
      await seedDemoHistory(ctx.db, tenantIds, membershipIds);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      const count = async () => [await ctx.db.select().from(mentorProfiles), await ctx.db.select().from(mentorships), await ctx.db.select().from(chatConversations)].map((r) => r.length);
      const before = await count();
      await seedConnections(ctx.db, tenantIds, membershipIds);
      expect(await count()).toEqual(before);
      const uni = tenantIds["demo-university"]!;
      const samaj = tenantIds["shri-gujarati-samaj"]!;
      const where = <T extends { tenantId: string }>(rows: T[], tenantId: string) => rows.filter((r) => r.tenantId === tenantId);

      const profiles = await ctx.db.select().from(mentorProfiles);
      expect(profiles.every((p) => [uni, samaj].includes(p.tenantId) && p.isActive && p.areas.length >= 1 && p.areas.length <= 5)).toBe(true);
      expect(where(profiles, uni).length).toBeGreaterThanOrEqual(3);
      expect(new Set(where(profiles, uni).flatMap((p) => p.areas)).size).toBeGreaterThanOrEqual(5);
      expect(where(profiles, samaj)).toHaveLength(2);
      const all = await ctx.db.select().from(mentorships);
      expect(where(all, uni).map((r) => r.status).sort()).toEqual(["ACCEPTED", "REQUESTED"]);
      expect(where(all, samaj).map((r) => r.status).sort()).toEqual(["ACCEPTED", "REQUESTED", "REQUESTED"]);
      expect(all.every((r) => !r.suppressed && r.note.length >= 10 && r.note.length <= 500)).toBe(true);
      expect(all.every((r) => profiles.some((p) => p.membershipId === r.mentorMembershipId && p.tenantId === r.tenantId))).toBe(true);

      for (const accepted of all.filter((r) => r.status === "ACCEPTED")) {
        expect(await conversationRow(ctx, accepted.conversationId!)).toMatchObject({ origin: "MENTORSHIP", originId: accepted.id, directState: "ACCEPTED", requesterMembershipId: null });
        const thread = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, accepted.conversationId!));
        const first = thread.find((t) => t.seq === 1)!;
        expect(first).toMatchObject({ body: accepted.note, senderMembershipId: accepted.menteeMembershipId, clientKey: `origin-${accepted.id}` });
        expect(thread.map((t) => t.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: thread.length }, (_, i) => i + 1));
      }

      // Nobody an e2e journey signs in as mentors, asks or is asked, so what those journeys see stays as it was.
      const e2ePhones = ["+919100000003", "+919100000004", "+919100000005", "+919100000006", "+919000000001", "+91931000006", "+91931000007", "+91931000012", "+91931000013"];
      const e2e = await ctx.db
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, uni), inArray(users.phoneE164, e2ePhones)));
      expect(e2e.length).toBe(e2ePhones.length);
      const touched = new Set([...profiles.map((p) => p.membershipId), ...all.flatMap((r) => [r.mentorMembershipId, r.menteeMembershipId])]);
      for (const { id } of e2e) expect(touched.has(id), id).toBe(false);
      // Nor a notification, so their unread counts hold.
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });
  });
});
