import { REFERRAL_MAX_OPEN_PER_REQUESTER, REFERRAL_MAX_WAITING_PER_JOB, notificationTarget, type AdminChatReportViewDto, type ChatMessageDto, type JobDetailDto, type ReferralDto } from "@illuminize/shared";
import { and, eq, inArray, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatConversations, chatMessages, chatReports, jobs, memberships, notifications, referralRequests, tenantSettings, users } from "../../src/db/schema";
import { seedConnections, seedContent, seedCore, seedMembers } from "../../src/db/seed";
import { seedDemoHistory } from "../../src/db/seedDemoHistory";
import { keys } from "../../src/redis/keys";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { acceptedThread, bareMember, chatApi, conversationRow, type Session } from "../helpers/chat";
import { createTenant, memberSession } from "../helpers/factories";
import { acceptedReferral, askForReferral, comparableReferral, postReferralJob, REFERRAL_NOTE, referralsApi } from "../helpers/referrals";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const UNKNOWN = "4f0f7c1e-2b7a-4d7a-9a3e-2f4d5c6b7a81";

describe.skipIf(!dbAvailable)("referrals", () => {
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

  async function setup(opts: Parameters<typeof createTenant>[1] = {}) {
    const { tenant } = await createTenant(ctx, opts);
    const poster = await memberSession(ctx, tenant.id, { fullName: "Pia Poster" });
    const requester = await memberSession(ctx, tenant.id, { fullName: "Ravi Requester" });
    const r = (s: Session) => referralsApi(ctx, tenant.slug, s);
    const job = await postReferralJob(ctx, tenant.slug, poster);
    return { tenant, poster, requester, r, job };
  }
  const admin = async (tenantId: string) => memberSession(ctx, tenantId, { role: "TENANT_ADMIN" });
  const setFeatures = async (slug: string, tenantId: string, features: Record<string, boolean>) =>
    request(ctx.app).patch(`/api/v1/t/${slug}/admin/settings`).set((await admin(tenantId)).headers).send({ features }).expect(200);
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
  const row = async (id: string) => (await ctx.db.select().from(referralRequests).where(eq(referralRequests.id, id)))[0]!;
  const allRows = () => ctx.db.select().from(referralRequests);
  const withLimits = async (run: () => Promise<void>) => {
    process.env.RATE_LIMIT_IN_TESTS = "1";
    try {
      await run();
    } finally {
      delete process.env.RATE_LIMIT_IN_TESTS;
    }
  };
  /** Until another connection to this database is waiting for a lock, which is how a test knows a request has reached one. */
  const waitForLockWait = async () => {
    for (let i = 0; i < 250; i++) {
      const { rows } = await ctx.pool.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'");
      if (rows[0]!.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Nothing waited for a lock");
  };
  /** Waiting requests put straight in, from members who exist only for them, for limits that would take dozens of sign-ins to reach. */
  const fillWaiting = async (tenantId: string, job: JobDetailDto, posterId: string, count: number, extra: Partial<typeof referralRequests.$inferInsert> = {}) => {
    for (let i = 0; i < count; i++) {
      const m = await bareMember(ctx, tenantId);
      await ctx.db.insert(referralRequests).values({ tenantId, jobId: job.id, jobTitle: job.title, jobCompany: job.companyName, posterMembershipId: posterId, requesterMembershipId: m.id, note: REFERRAL_NOTE, ...extra });
    }
  };

  describe("offering referrals", () => {
    it("shows a job its poster can refer for, on the card, the page and the Can refer filter, and unticking it takes that away", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const plain = await postReferralJob(ctx, tenant.slug, poster, { title: "Designer", canRefer: false });
      expect(job.canRefer).toBe(true);
      expect(plain.canRefer).toBe(false);
      expect((await r(requester).job(job.id)).body.data).toMatchObject({ canRefer: true, myReferral: null, referralAskRefusal: null, pendingReferralCount: null });
      expect((await r(poster).job(job.id)).body.data).toMatchObject({ canRefer: true, myReferral: null, referralAskRefusal: null, pendingReferralCount: 0 });
      const ids = (res: { body: { data: Array<{ id: string }> } }) => res.body.data.map((j) => j.id);
      expect(ids(await r(requester).jobs({ canRefer: true }))).toEqual([job.id]);
      expect(ids(await r(requester).jobs({ canRefer: false }))).toEqual([plain.id]);
      expect(ids(await r(requester).jobs())).toEqual([plain.id, job.id]);

      const unticked = await r(poster).editJob(job.id, { canRefer: false });
      expect(unticked.body.data.canRefer).toBe(false);
      expect(ids(await r(requester).jobs({ canRefer: true }))).toEqual([]);
      expect((await r(poster).editJob(job.id, { canRefer: true })).body.data.canRefer).toBe(true);
      // Leaving it out of an edit leaves it as it was.
      expect((await r(poster).editJob(job.id, { title: "Senior Backend Engineer" })).body.data.canRefer).toBe(true);
    });
  });

  describe("asking", () => {
    it("shows the poster the note, tells them without naming anyone, and audits ids only", async () => {
      const { poster, requester, r, job } = await setup();
      const asked = await r(requester).request(job.id);
      expect(asked.status).toBe(201);
      expect(asked.headers["cache-control"]).toBe("no-store");
      expect(asked.body.data).toMatchObject({
        box: "sent",
        status: "REQUESTED",
        note: REFERRAL_NOTE,
        job: { id: job.id, title: "Backend Engineer", companyName: "Acme", available: true },
        member: { id: poster.membership.id },
        conversationId: null,
        canWithdraw: true,
        canAccept: false,
        canReport: false,
      });
      const id = asked.body.data.id as string;

      const received = await r(poster).mine("received");
      expect(received.headers["cache-control"]).toBe("no-store");
      expect(received.body).toMatchObject({ waiting: 1, nextCursor: null });
      expect(received.body.data).toEqual([expect.objectContaining({ id, box: "received", note: REFERRAL_NOTE, member: expect.objectContaining({ id: requester.membership.id }), canAccept: true, canDecline: true, canReport: true, canWithdraw: false })]);
      expect((await r(poster).forJob(job.id)).body).toMatchObject({ waiting: 1, data: [expect.objectContaining({ id })] });
      expect((await r(poster).summary()).body.data).toEqual({ received: 1, sent: 0 });
      expect((await r(requester).summary()).body.data).toEqual({ received: 0, sent: 1 });
      expect((await r(requester).mine("sent")).body.waiting).toBe(1);
      expect((await r(poster).job(job.id)).body.data.pendingReferralCount).toBe(1);
      expect((await r(requester).job(job.id)).body.data.myReferral).toEqual({ id, status: "REQUESTED", createdAt: expect.any(String), conversationId: null });

      const [notice] = await noticesTo(poster, "REFERRAL_REQUESTED");
      expect(notice).toMatchObject({ title: "New referral request", body: "For Backend Engineer at Acme", data: { referralId: id, jobId: job.id, box: "received" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "referral", box: "received" });
      const [audit] = await audits("referral.request");
      expect(audit).toMatchObject({ targetType: "referral", targetId: id, actorMembershipId: requester.membership.id });
      // Exactly nothing: a subset match would let any metadata through, the note included.
      expect(audit!.metadata).toStrictEqual({});
      expect(realtime.to(poster.user.id, "referral:changed")).toHaveLength(1);
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(1);
    });

    it("shows requesters nothing of anyone else's request, and only the poster the job's list", async () => {
      const { tenant, requester, r, job } = await setup();
      const other = await memberSession(ctx, tenant.id);
      await askForReferral(ctx, tenant.slug, other, job.id);
      expect((await r(requester).job(job.id)).body.data).toMatchObject({ myReferral: null, pendingReferralCount: null });
      const refused = await r(requester).forJob(job.id);
      expect(refused.status).toBe(403);
      expect((await r(requester).mine("received")).body).toMatchObject({ data: [], waiting: 0 });
      expect((await r(requester).forJob(UNKNOWN)).status).toBe(404);
    });

    it("refuses the poster, a job that doesn't take requests, and a poster who can't be reached", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      expect((await r(poster).request(job.id)).status).toBe(400);
      expect((await r(requester).request(UNKNOWN)).status).toBe(404);
      const unavailable = async (jobId: string) => {
        const res = await r(requester).request(jobId);
        expect(res.status, JSON.stringify(res.body)).toBe(409);
        expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
      };
      await unavailable((await postReferralJob(ctx, tenant.slug, poster, { canRefer: false })).id);
      const closed = await postReferralJob(ctx, tenant.slug, poster);
      await r(poster).closeJob(closed.id);
      await unavailable(closed.id);
      const expired = await postReferralJob(ctx, tenant.slug, poster);
      await ctx.db.update(jobs).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(jobs.id, expired.id));
      await unavailable(expired.id);
      // An admin can see a job other members can't, so these reach the job's own rules rather than a 404.
      const staff = await admin(tenant.id);
      await ctx.db.update(jobs).set({ moderationStatus: "PENDING" }).where(eq(jobs.id, expired.id));
      expect((await r(requester).request(expired.id)).status).toBe(404);
      expect((await r(staff).request(expired.id)).body.error.code).toBe("CONTACT_UNAVAILABLE");
      for (const status of ["SUSPENDED", "PENDING", "REJECTED"] as const) {
        await ctx.db.update(memberships).set({ status }).where(eq(memberships.id, poster.membership.id));
        const res = await r(staff).request(job.id);
        expect(res.status, status).toBe(409);
        expect(res.body.error.code).toBe("CONTACT_UNAVAILABLE");
      }
      // A suspended poster's job is hidden from members, as their other content is.
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, poster.membership.id));
      expect((await r(requester).request(job.id)).status).toBe(404);
      expect(await allRows()).toEqual([]);
    });

    it("takes a note of 10 to 500 characters once trimmed, cleaned like a message", async () => {
      const { tenant, r, job } = await setup();
      const requester = await memberSession(ctx, tenant.id);
      for (const note of ["Too short", "     too short    ", "x".repeat(501), "​".repeat(12)]) expect((await r(requester).request(job.id, note)).status, JSON.stringify(note)).toBe(400);
      const asked = await r(requester).request(job.id, `  Ten chars\u0007!  `);
      expect(asked.status).toBe(201);
      expect(asked.body.data.note).toBe("Ten chars!");
      const longest = await memberSession(ctx, tenant.id);
      expect((await r(longest).request(job.id, "y".repeat(500))).status).toBe(201);
    });

    it("allows one standing request per job: again after withdrawing, never after a decline, and not once accepted", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const first = await askForReferral(ctx, tenant.slug, requester, job.id);
      const again = await r(requester).request(job.id);
      expect(again.status).toBe(409);
      expect(again.body.error.message).toMatch(/already asked/);
      await r(requester).withdraw(first.id);
      const second = await askForReferral(ctx, tenant.slug, requester, job.id);
      await r(poster).decline(second.id);
      const afterDecline = await r(requester).request(job.id);
      expect(afterDecline.status).toBe(409);
      expect(afterDecline.body.error.message).toMatch(/declined/);

      const other = await memberSession(ctx, tenant.id);
      const accepted = await askForReferral(ctx, tenant.slug, other, job.id);
      await r(poster).accept(accepted.id);
      expect((await r(other).request(job.id)).body.error.message).toMatch(/already accepted/);
      // Another job is another matter.
      const another = await postReferralJob(ctx, tenant.slug, poster, { title: "Frontend Engineer" });
      expect((await r(requester).request(another.id)).status).toBe(201);
    });

    it("allows three requests per job, whatever became of them", async () => {
      const { tenant, requester, r, job } = await setup();
      for (let i = 0; i < 3; i++) await r(requester).withdraw((await askForReferral(ctx, tenant.slug, requester, job.id)).id);
      const refused = await r(requester).request(job.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/up to 3 times/);
      expect(await allRows()).toHaveLength(3);
      // The job's page says so before another note is written, to this member alone.
      expect((await r(requester).job(job.id)).body.data).toMatchObject({ myReferral: { status: "WITHDRAWN" }, referralAskRefusal: "LIMIT" });
      expect((await r(await memberSession(ctx, tenant.id)).job(job.id)).body.data.referralAskRefusal).toBeNull();
    });

    it(`allows ${REFERRAL_MAX_OPEN_PER_REQUESTER} requests waiting at once, and another once one is answered`, async () => {
      const { tenant, poster, requester, r } = await setup();
      const waiting = [];
      for (let i = 0; i < REFERRAL_MAX_OPEN_PER_REQUESTER; i++) waiting.push(await askForReferral(ctx, tenant.slug, requester, (await postReferralJob(ctx, tenant.slug, poster, { title: `Role ${i}` })).id));
      const next = await postReferralJob(ctx, tenant.slug, poster, { title: "One more" });
      const refused = await r(requester).request(next.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.message).toMatch(/up to 10 referral requests waiting/);
      await r(poster).decline(waiting[0]!.id);
      expect((await r(requester).request(next.id)).status).toBe(201);
    });

    it(`allows ${REFERRAL_MAX_WAITING_PER_JOB} requests waiting for one job, counting only those its poster can see, and refuses everyone alike once full`, async () => {
      const { tenant, poster, requester, r, job } = await setup();
      await fillWaiting(tenant.id, job, poster.membership.id, REFERRAL_MAX_WAITING_PER_JOB - 1);
      // Hidden from the poster: one they blocked, and one from a suspended member. Neither fills the job.
      await fillWaiting(tenant.id, job, poster.membership.id, 1, { suppressed: true });
      const suspended = await bareMember(ctx, tenant.id, { status: "SUSPENDED" });
      await ctx.db.insert(referralRequests).values({ tenantId: tenant.id, jobId: job.id, jobTitle: job.title, jobCompany: job.companyName, posterMembershipId: poster.membership.id, requesterMembershipId: suspended.id, note: REFERRAL_NOTE });
      expect((await r(poster).job(job.id)).body.data.pendingReferralCount).toBe(REFERRAL_MAX_WAITING_PER_JOB - 1);
      expect((await r(requester).request(job.id)).status).toBe(201);

      const late = await memberSession(ctx, tenant.id);
      const blocked = await memberSession(ctx, tenant.id);
      await chatApi(ctx, tenant.slug, poster).block(blocked.membership.id);
      const refusals = [await r(late).request(job.id), await r(blocked).request(job.id)];
      for (const res of refusals) {
        expect(res.status).toBe(409);
        expect(res.body.error.message).toMatch(/as many referral requests waiting/);
      }
      expect(refusals[1]!.body).toEqual(refusals[0]!.body);
    });

    it("holds every limit under concurrency", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      // Two at once from one member, about one job they have already asked twice about: one gets in.
      for (let i = 0; i < 2; i++) await r(requester).withdraw((await askForReferral(ctx, tenant.slug, requester, job.id)).id);
      const sameJob = await Promise.all([r(requester).request(job.id), r(requester).request(job.id)]);
      expect(sameJob.map((res) => res.status).sort()).toEqual([201, 409]);
      expect(await allRows()).toHaveLength(3);

      // Two at once to different jobs, from a member one short of their limit: one gets in.
      const busy = await memberSession(ctx, tenant.id);
      for (let i = 0; i < REFERRAL_MAX_OPEN_PER_REQUESTER - 1; i++) await askForReferral(ctx, tenant.slug, busy, (await postReferralJob(ctx, tenant.slug, poster, { title: `Role ${i}` })).id);
      const [a, b] = [await postReferralJob(ctx, tenant.slug, poster, { title: "Role A" }), await postReferralJob(ctx, tenant.slug, poster, { title: "Role B" })];
      const twoJobs = await Promise.all([r(busy).request(a.id), r(busy).request(b.id)]);
      expect(twoJobs.map((res) => res.status).sort()).toEqual([201, 409]);

      // Two members at once, for a job one short of full: one gets in.
      const full = await postReferralJob(ctx, tenant.slug, poster, { title: "Nearly full" });
      await fillWaiting(tenant.id, full, poster.membership.id, REFERRAL_MAX_WAITING_PER_JOB - 1);
      const [x, y] = [await memberSession(ctx, tenant.id), await memberSession(ctx, tenant.id)];
      const twoMembers = await Promise.all([r(x).request(full.id), r(y).request(full.id)]);
      expect(twoMembers.map((res) => res.status).sort()).toEqual([201, 409]);
    });

    it("can't slip in behind a close: a request waiting on the job's lock sees it closed", async () => {
      const { requester, r, job } = await setup();
      const closing = await ctx.pool.connect();
      try {
        await closing.query("begin");
        await closing.query("update jobs set is_closed = true where id = $1", [job.id]);
        const asking = Promise.resolve(r(requester).request(job.id));
        await waitForLockWait();
        await closing.query("commit");
        const refused = await asking;
        expect(refused.status).toBe(409);
        expect(refused.body.error.code).toBe("CONTACT_UNAVAILABLE");
      } finally {
        await closing.query("rollback").catch(() => undefined);
        closing.release();
      }
      expect(await allRows()).toEqual([]);
    });

    it("closes a request that commits while its poster's account is being deleted, along with their job", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const sending = await ctx.pool.connect();
      let id = "";
      try {
        // A request part way through: inserted and not yet committed, so its foreign keys hold the job and the poster.
        await sending.query("begin");
        const inserted = await sending.query<{ id: string }>(
          "insert into referral_requests (tenant_id, job_id, job_title, job_company, poster_membership_id, requester_membership_id, note) values ($1, $2, $3, $4, $5, $6, $7) returning id",
          [tenant.id, job.id, job.title, job.companyName, poster.membership.id, requester.membership.id, REFERRAL_NOTE],
        );
        id = inserted.rows[0]!.id;
        const deleting = Promise.resolve(request(ctx.app).post("/api/v1/me/delete").set(poster.headers).send({ confirm: true }));
        await waitForLockWait();
        await sending.query("commit");
        expect((await deleting).status).toBeLessThan(300);
      } finally {
        await sending.query("rollback").catch(() => undefined);
        sending.release();
      }
      expect(await row(id)).toMatchObject({ status: "CLOSED", posterMembershipId: null, jobId: null, closedAt: expect.any(Date) });
      expect((await r(requester).summary()).body.data).toEqual({ received: 0, sent: 0 });
      expect(await noticesTo(requester)).toEqual([]);
    });

    it("counts requests against referral-request, 10 an hour, before anything else", async () => {
      const { requester, r, job } = await setup();
      await withLimits(async () => {
        await ctx.redis.set(keys.rateLimit("referral-request", requester.membership.id), "10");
        expect((await r(requester).request(job.id)).status).toBe(429);
      });
      expect(await allRows()).toEqual([]);
    });
  });

  describe("blocks stay invisible", () => {
    /** Everything a requester can read about one request, and what they get for asking again. */
    async function requesterView(api: ReturnType<typeof referralsApi>, jobId: string, id: string) {
      const sent = (await api.mine("sent")).body;
      const job = (await api.job(jobId)).body.data as JobDetailDto;
      const again = await api.request(jobId);
      return {
        row: comparableReferral((sent.data as ReferralDto[]).find((x) => x.id === id)!),
        waiting: sent.waiting,
        summary: (await api.summary()).body.data,
        myReferral: job.myReferral && { ...job.myReferral, id: "<id>", createdAt: "<at>" },
        canRefer: job.canRefer,
        referralAskRefusal: job.referralAskRefusal,
        again: { status: again.status, error: again.body.error },
      };
    }

    it("answers a request to a poster who blocked the requester exactly as one who didn't, and tells and audits nothing", async () => {
      const { tenant, requester, r } = await setup();
      const open = await memberSession(ctx, tenant.id, { fullName: "Open Poster" });
      const blocker = await memberSession(ctx, tenant.id, { fullName: "Blocking Poster" });
      const openJob = await postReferralJob(ctx, tenant.slug, open);
      const blockerJob = await postReferralJob(ctx, tenant.slug, blocker);
      await chatApi(ctx, tenant.slug, blocker).block(requester.membership.id);
      realtime.clear();

      const real = await r(requester).request(openJob.id);
      const hidden = await r(requester).request(blockerJob.id);
      expect(hidden.status).toBe(real.status);
      expect(comparableReferral(hidden.body.data)).toEqual(comparableReferral(real.body.data));
      expect(await requesterView(r(requester), blockerJob.id, hidden.body.data.id)).toEqual(await requesterView(r(requester), openJob.id, real.body.data.id));
      expect((await row(hidden.body.data.id)).suppressed).toBe(true);

      // The poster who blocked them never sees it, and can't act on it.
      expect((await r(blocker).mine("received")).body).toMatchObject({ data: [], waiting: 0 });
      expect((await r(blocker).forJob(blockerJob.id)).body).toMatchObject({ data: [], waiting: 0 });
      expect((await r(blocker).summary()).body.data).toEqual({ received: 0, sent: 0 });
      expect((await r(blocker).job(blockerJob.id)).body.data.pendingReferralCount).toBe(0);
      for (const res of [await r(blocker).accept(hidden.body.data.id), await r(blocker).decline(hidden.body.data.id), await r(blocker).report(hidden.body.data.id)]) expect(res.status).toBe(404);
      expect(await noticesTo(blocker)).toEqual([]);
      expect((await noticesTo(open, "REFERRAL_REQUESTED")).length).toBe(1);
      expect((await audits("referral.request")).map((a) => a.targetId)).toEqual([real.body.data.id]);
      expect(realtime.to(blocker.user.id)).toEqual([]);
      expect(realtime.to(open.user.id, "referral:changed")).toHaveLength(1);
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(2);

      // Withdrawing reads the same too, and audits only the one the poster could see, and tells only them.
      const withdrawnReal = await r(requester).withdraw(real.body.data.id);
      const withdrawnHidden = await r(requester).withdraw(hidden.body.data.id);
      expect(comparableReferral(withdrawnHidden.body.data)).toEqual(comparableReferral(withdrawnReal.body.data));
      expect((await audits("referral.withdraw")).map((a) => a.targetId)).toEqual([real.body.data.id]);
      expect(realtime.to(blocker.user.id)).toEqual([]);
      expect(realtime.to(open.user.id, "referral:changed")).toHaveLength(2);
    });

    it("counts a suppressed request against the requester's own limits like any other", async () => {
      const { tenant, requester, r } = await setup();
      const blocker = await memberSession(ctx, tenant.id);
      await chatApi(ctx, tenant.slug, blocker).block(requester.membership.id);
      const job = await postReferralJob(ctx, tenant.slug, blocker);
      const first = await askForReferral(ctx, tenant.slug, requester, job.id);
      expect((await r(requester).request(job.id)).body.error.message).toMatch(/already asked/);
      await r(requester).withdraw(first.id);
      for (let i = 0; i < 2; i++) await r(requester).withdraw((await askForReferral(ctx, tenant.slug, requester, job.id)).id);
      expect((await r(requester).request(job.id)).body.error.message).toMatch(/up to 3 times/);
      expect((await r(requester).job(job.id)).body.data.referralAskRefusal).toBe("LIMIT");
      for (let i = 0; i < REFERRAL_MAX_OPEN_PER_REQUESTER; i++) await askForReferral(ctx, tenant.slug, requester, (await postReferralJob(ctx, tenant.slug, blocker, { title: `Role ${i}` })).id);
      const last = await postReferralJob(ctx, tenant.slug, blocker, { title: "Last" });
      expect((await r(requester).request(last.id)).body.error.message).toMatch(/up to 10 referral requests waiting/);
      expect((await r(requester).summary()).body.data.sent).toBe(REFERRAL_MAX_OPEN_PER_REQUESTER);
    });

    it("refuses a member who has blocked the poster, says so on the job's page, and tells the poster nothing", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      await chatApi(ctx, tenant.slug, requester).block(poster.membership.id);
      realtime.clear();

      // Said before a note is written, and only to the member who blocked.
      expect((await r(requester).job(job.id)).body.data).toMatchObject({ canRefer: true, myReferral: null, referralAskRefusal: "YOU_BLOCKED" });
      const refused = await r(requester).request(job.id);
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe("CHAT_BLOCKED_BY_YOU");
      expect(await allRows()).toEqual([]);
      expect(await noticesTo(poster)).toEqual([]);
      expect(await audits("referral.request")).toEqual([]);
      expect(realtime.to(poster.user.id)).toEqual([]);
      // The poster they blocked reads the job as ever.
      expect((await r(poster).job(job.id)).body.data).toMatchObject({ referralAskRefusal: null, pendingReferralCount: 0 });

      // Once unblocked, they can ask.
      await chatApi(ctx, tenant.slug, requester).unblock(poster.membership.id);
      expect((await r(requester).job(job.id)).body.data.referralAskRefusal).toBeNull();
      expect((await r(requester).request(job.id)).status).toBe(201);
    });

    it("blocking withdraws your own waiting requests to them and suppresses theirs to you, silently, and leaves accepted ones between you", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const third = await memberSession(ctx, tenant.id);
      const theirs = await askForReferral(ctx, tenant.slug, requester, job.id);
      const requesterJob = await postReferralJob(ctx, tenant.slug, requester, { title: "Analyst" });
      const mine = await askForReferral(ctx, tenant.slug, poster, requesterJob.id);
      // Accepted between the two, each way round, which the block must leave alone, and one with someone else.
      const acceptedTheirs = await acceptedReferral(ctx, tenant.slug, poster, requester);
      const acceptedMine = await acceptedReferral(ctx, tenant.slug, requester, poster);
      await acceptedReferral(ctx, tenant.slug, third, poster);
      const before = (await r(requester).mine("sent")).body.data.map(comparableReferral);
      await ctx.db.delete(notifications);
      realtime.clear();

      expect((await chatApi(ctx, tenant.slug, poster).block(requester.membership.id)).status).toBe(201);
      // The blocker's lists refresh, and so do the blocked member's, as for a request withdrawn by hand, and nobody else's.
      expect(realtime.to(poster.user.id, "referral:changed")).toHaveLength(1);
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(1);
      expect(realtime.to(third.user.id, "referral:changed")).toEqual([]);
      expect(await row(theirs.id)).toMatchObject({ status: "REQUESTED", suppressed: true });
      expect(await row(mine.id)).toMatchObject({ status: "WITHDRAWN", closedAt: expect.any(Date) });
      for (const accepted of [acceptedTheirs, acceptedMine]) expect(await row(accepted.referral.id)).toMatchObject({ status: "ACCEPTED", suppressed: false, closedAt: null });
      // The member who was blocked sees their requests as they were, and the blocker's waiting one as withdrawn, as if by hand.
      expect((await r(requester).mine("sent")).body.data.map(comparableReferral)).toEqual(before);
      const requesterReceived = (await r(requester).mine("received")).body.data as ReferralDto[];
      expect(requesterReceived.find((x) => x.id === mine.id)).toMatchObject({ status: "WITHDRAWN", canAccept: false });
      expect(requesterReceived.find((x) => x.id === acceptedMine.referral.id)).toMatchObject({ status: "ACCEPTED" });
      // The blocker no longer sees what waits from them, but still sees the referral they accepted.
      const posterReceived = ((await r(poster).mine("received")).body.data as ReferralDto[]).map((x) => x.id);
      expect(posterReceived).not.toContain(theirs.id);
      expect(posterReceived).toContain(acceptedTheirs.referral.id);
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await r(poster).accept(theirs.id)).status).toBe(404);
      // Unblocking brings nothing back.
      await chatApi(ctx, tenant.slug, poster).unblock(requester.membership.id);
      expect((await r(poster).forJob(job.id)).body.waiting).toBe(0);
    });

    it("blocking a poster who blocked you first tells them nothing of your request they never saw", async () => {
      const { tenant, poster, requester, job } = await setup();
      await chatApi(ctx, tenant.slug, poster).block(requester.membership.id);
      const hidden = await askForReferral(ctx, tenant.slug, requester, job.id);
      realtime.clear();

      expect((await chatApi(ctx, tenant.slug, requester).block(poster.membership.id)).status).toBe(201);
      expect(await row(hidden.id)).toMatchObject({ status: "WITHDRAWN", suppressed: true, closedAt: expect.any(Date) });
      // Withdrawn as it would be by hand, which wouldn't tell the poster either: only the blocker's own lists refresh.
      expect(realtime.to(poster.user.id)).toEqual([]);
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(1);
      expect(await noticesTo(poster)).toEqual([]);
    });

    it("closing the job closes a suppressed request exactly as a real one, telling both senders alike and the poster nothing of it", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const other = await memberSession(ctx, tenant.id);
      await chatApi(ctx, tenant.slug, poster).block(requester.membership.id);
      const hidden = await askForReferral(ctx, tenant.slug, requester, job.id);
      const real = await askForReferral(ctx, tenant.slug, other, job.id);
      realtime.clear();
      expect((await r(poster).closeJob(job.id)).status).toBe(200);
      const view = async (s: Session, id: string) => comparableReferral(((await r(s).mine("sent")).body.data as ReferralDto[]).find((x) => x.id === id)!);
      expect(await view(requester, hidden.id)).toEqual(await view(other, real.id));
      expect((await view(other, real.id)).status).toBe("CLOSED");
      // The bell reads the same for both, the one the poster never saw included: the notice goes to its sender alone.
      const told = async (s: Session) => (await noticesTo(s)).map((n) => ({ type: n.type, title: n.title, body: n.body, data: { ...(n.data as Record<string, unknown>), referralId: "<id>" } }));
      expect(await told(other)).toEqual([{ type: "REFERRAL_DECLINED", title: "Your referral request was closed", body: "Backend Engineer at Acme is no longer taking referral requests.", data: { referralId: "<id>", box: "sent" } }]);
      expect(await told(requester)).toEqual(await told(other));
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(1);
      expect(realtime.to(other.user.id, "referral:changed")).toHaveLength(1);

      // A job whose only waiting request is one its poster never saw closes without a word to them.
      const quiet = await postReferralJob(ctx, tenant.slug, poster, { title: "Quiet Role" });
      const alone = await askForReferral(ctx, tenant.slug, requester, quiet.id);
      const posterNotices = (await noticesTo(poster)).length;
      realtime.clear();
      expect((await r(poster).closeJob(quiet.id)).status).toBe(200);
      expect(await row(alone.id)).toMatchObject({ status: "CLOSED", suppressed: true });
      expect(realtime.to(poster.user.id, "referral:changed")).toEqual([]);
      expect(realtime.to(requester.user.id, "referral:changed")).toHaveLength(1);
      expect(await noticesTo(poster)).toHaveLength(posterNotices);
      expect((await noticesTo(requester, "REFERRAL_DECLINED")).map((n) => n.body)).toContain("Quiet Role at Acme is no longer taking referral requests.");
    });
  });

  describe("accepting", () => {
    it("opens a chat whose first message is the note, from the requester, and tells them with a link into it", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      ctx.jobs.clear();
      const accepted = await r(poster).accept(asked.id);
      expect(accepted.status).toBe(200);
      const dto = accepted.body.data as ReferralDto;
      expect(dto).toMatchObject({ status: "ACCEPTED", box: "received", canAccept: false, canDecline: false, canReport: false, conversationId: expect.any(String) });
      expect(dto.acceptedAt).toBe(dto.respondedAt);
      expect(await conversationRow(ctx, dto.conversationId!)).toMatchObject({ origin: "REFERRAL", originId: asked.id, directState: "ACCEPTED", lastSeq: 1 });
      const messages = (await chatApi(ctx, tenant.slug, poster).messages(dto.conversationId!)).body.data as ChatMessageDto[];
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ body: REFERRAL_NOTE, sender: { id: requester.membership.id }, kind: "TEXT" });

      const [notice] = await noticesTo(requester, "REFERRAL_ACCEPTED");
      expect(notice).toMatchObject({ title: "Pia Poster accepted your referral request", body: "For Backend Engineer at Acme", data: { referralId: asked.id, conversationId: dto.conversationId, box: "sent" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "chat", conversationId: dto.conversationId });
      // Its own notification says so, so the chat opening doesn't push a second time.
      expect(ctx.jobs.peek("chat.pushEvent")).toEqual([]);
      expect(ctx.jobs.peek("chat.pushConversation")).toEqual([]);
      expect((await r(requester).mine("sent")).body.data[0]).toMatchObject({ status: "ACCEPTED", conversationId: dto.conversationId, canWithdraw: false });
      expect((await r(requester).job(job.id)).body.data.myReferral).toMatchObject({ id: asked.id, status: "ACCEPTED", conversationId: dto.conversationId });
      expect((await chatApi(ctx, tenant.slug, requester).send(dto.conversationId!, "Thank you!")).status).toBe(201);
      expect((await audits("referral.accept")).map((a) => [a.targetId, a.metadata])).toEqual([[asked.id, {}]]);
      expect(realtime.to(requester.user.id, "referral:changed").length).toBeGreaterThan(0);
    });

    it("reuses the accepted chat they already had, keeping what started it, with the note as its latest message and no push of it", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const existing = await acceptedThread(ctx, tenant.slug, requester, poster);
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      ctx.jobs.clear();
      const dto = (await r(poster).accept(asked.id)).body.data as ReferralDto;
      expect(dto.conversationId).toBe(existing);
      expect(await conversationRow(ctx, existing)).toMatchObject({ origin: "MESSAGE_REQUEST", originId: null, directState: "ACCEPTED", lastSeq: 2 });
      const [latest] = (await chatApi(ctx, tenant.slug, poster).messages(existing)).body.data as ChatMessageDto[];
      expect(latest).toMatchObject({ body: REFERRAL_NOTE, sender: { id: requester.membership.id } });
      expect(ctx.jobs.peek("chat.pushConversation")).toEqual([]);
      expect(ctx.jobs.peek("chat.pushEvent")).toEqual([]);
    });

    it("reads both members and the institution again now, and leaves nothing behind when it refuses", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, requester.membership.id));
      const unavailable = await r(poster).accept(asked.id);
      expect(unavailable.status).toBe(409);
      expect(unavailable.body.error.code).toBe("CONTACT_UNAVAILABLE");
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, requester.membership.id));
      // The request's cached copy of the institution still says on, so only reading it again now can refuse.
      for (const features of [{ messaging: false }, { jobs: false }]) {
        await ctx.db.update(tenantSettings).set({ features }).where(eq(tenantSettings.tenantId, tenant.id));
        const off = await r(poster).accept(asked.id);
        expect(off.status, JSON.stringify(features)).toBe(403);
        expect(off.body.error.code).toBe("FEATURE_DISABLED");
      }
      expect(await row(asked.id)).toMatchObject({ status: "REQUESTED", conversationId: null });
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
      expect(await noticesTo(requester, "REFERRAL_ACCEPTED")).toEqual([]);
    });

    it("is the poster's alone, once: anyone else gets a 404 or a 409, and two at once open one chat", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const stranger = await memberSession(ctx, tenant.id);
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      expect((await r(stranger).accept(asked.id)).status).toBe(404);
      expect((await r(stranger).decline(asked.id)).status).toBe(404);
      expect((await r(stranger).withdraw(asked.id)).status).toBe(404);
      expect((await r(requester).accept(asked.id)).status).toBe(409);
      expect((await r(poster).withdraw(asked.id)).status).toBe(409);
      const results = await Promise.all([r(poster).accept(asked.id), r(poster).accept(asked.id)]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await ctx.db.select().from(chatConversations)).toHaveLength(1);
      expect(await ctx.db.select().from(chatMessages)).toHaveLength(1);
      expect((await r(poster).decline(asked.id)).status).toBe(409);
    });
  });

  describe("declining and withdrawing", () => {
    it("declining tells the requester by the poster's name, opens no chat, and audits ids only", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      const declined = await r(poster).decline(asked.id);
      expect(declined.body.data).toMatchObject({ status: "DECLINED", respondedAt: expect.any(String), canAccept: false, canDecline: false, canReport: true });
      expect((await r(requester).mine("sent")).body.data[0]).toMatchObject({ status: "DECLINED", canWithdraw: false });
      const [notice] = await noticesTo(requester, "REFERRAL_DECLINED");
      expect(notice).toMatchObject({ title: "Pia Poster declined your referral request", body: "For Backend Engineer at Acme", data: { referralId: asked.id, box: "sent" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "referral", box: "sent" });
      expect(await ctx.db.select().from(chatConversations)).toEqual([]);
      const [audit] = await audits("referral.decline");
      expect(audit).toMatchObject({ targetType: "referral", targetId: asked.id, actorMembershipId: poster.membership.id });
      expect(audit!.metadata).toStrictEqual({});
    });

    it("withdrawing is the requester's, tells the poster nothing, and reads as withdrawn on both lists", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      await ctx.db.delete(notifications);
      const withdrawn = await r(requester).withdraw(asked.id);
      expect(withdrawn.body.data).toMatchObject({ status: "WITHDRAWN", closedAt: expect.any(String), canWithdraw: false });
      expect((await r(poster).mine("received")).body).toMatchObject({ waiting: 0, data: [expect.objectContaining({ status: "WITHDRAWN", canAccept: false, canReport: true })] });
      expect(await ctx.db.select().from(notifications)).toEqual([]);
      expect((await r(requester).withdraw(asked.id)).status).toBe(409);
      const [audit] = await audits("referral.withdraw");
      expect(audit).toMatchObject({ targetType: "referral", targetId: asked.id, actorMembershipId: requester.membership.id });
      expect(audit!.metadata).toStrictEqual({});
    });
  });

  describe("the job's lifecycle", () => {
    /** A job with one request waiting and one accepted, by two different members. */
    async function jobWithRequests() {
      const s = await setup();
      const accepter = await memberSession(ctx, s.tenant.id, { fullName: "Accepted Asker" });
      const waiting = await askForReferral(ctx, s.tenant.slug, s.requester, s.job.id);
      const accepted = (await s.r(s.poster).accept((await askForReferral(ctx, s.tenant.slug, accepter, s.job.id)).id)).body.data as ReferralDto;
      await ctx.db.delete(notifications);
      realtime.clear();
      return { ...s, accepter, waiting, accepted };
    }
    async function expectClosed(s: Awaited<ReturnType<typeof jobWithRequests>>) {
      expect(await row(s.waiting.id)).toMatchObject({ status: "CLOSED", closedAt: expect.any(Date), jobTitle: "Backend Engineer", jobCompany: "Acme" });
      const [notice] = await noticesTo(s.requester, "REFERRAL_DECLINED");
      expect(notice).toMatchObject({ title: "Your referral request was closed", body: "Backend Engineer at Acme is no longer taking referral requests.", data: { referralId: s.waiting.id, box: "sent" } });
      expect(notificationTarget(notice!.type, notice!.data)).toEqual({ kind: "referral", box: "sent" });
      expect(await noticesTo(s.accepter, "REFERRAL_DECLINED")).toEqual([]);
      expect((await s.r(s.requester).mine("sent")).body.data[0]).toMatchObject({ status: "CLOSED", canWithdraw: false });
      expect(realtime.to(s.requester.user.id, "referral:changed")).toHaveLength(1);
      // The accepted referral and its chat carry on.
      expect(await row(s.accepted.id)).toMatchObject({ status: "ACCEPTED" });
      expect((await chatApi(ctx, s.tenant.slug, s.accepter).send(s.accepted.conversationId!, "Still on?")).status).toBe(201);
    }

    it("closing the job closes what waits, and tells each sender", async () => {
      const s = await jobWithRequests();
      expect((await s.r(s.poster).closeJob(s.job.id)).body.data).toMatchObject({ isClosed: true, pendingReferralCount: 0 });
      await expectClosed(s);
    });

    it("deleting the job closes what waits, keeping what the job was called", async () => {
      const s = await jobWithRequests();
      expect((await s.r(s.poster).deleteJob(s.job.id)).status).toBe(204);
      await expectClosed(s);
      const [mine] = (await s.r(s.requester).mine("sent")).body.data as ReferralDto[];
      expect(mine!.job).toEqual({ id: null, title: "Backend Engineer", companyName: "Acme", available: false });
      expect(((await s.r(s.poster).mine("received")).body.data as ReferralDto[]).every((x) => x.job.id === null)).toBe(true);
    });

    it("unticking I can refer closes what waits, and ticking it again revives nothing", async () => {
      const s = await jobWithRequests();
      await s.r(s.poster).editJob(s.job.id, { canRefer: false });
      await expectClosed(s);
      await s.r(s.poster).editJob(s.job.id, { canRefer: true });
      expect(await row(s.waiting.id)).toMatchObject({ status: "CLOSED" });
    });

    for (const action of ["reject", "remove"] as const) {
      it(`an admin's ${action} closes what waits, and restoring revives nothing`, async () => {
        const s = await jobWithRequests();
        const staff = await admin(s.tenant.id);
        if (action === "reject") await ctx.db.update(jobs).set({ moderationStatus: "PENDING" }).where(eq(jobs.id, s.job.id));
        const res = await request(ctx.app).post(`/api/v1/t/${s.tenant.slug}/admin/moderation/JOB/${s.job.id}/${action}`).set(staff.headers).send({ note: "Not a real job" });
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        await expectClosed(s);
        const [mine] = (await s.r(s.requester).mine("sent")).body.data as ReferralDto[];
        expect(mine!.job).toMatchObject({ id: s.job.id, available: false });
        if (action === "remove") {
          expect((await request(ctx.app).post(`/api/v1/t/${s.tenant.slug}/admin/moderation/JOB/${s.job.id}/restore`).set(staff.headers).send({})).status).toBe(200);
          expect(await row(s.waiting.id)).toMatchObject({ status: "CLOSED" });
        }
      });
    }

    it("an edit sent back for review keeps what waits and takes no new requests until it's approved", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const waiting = await askForReferral(ctx, tenant.slug, requester, job.id);
      await ctx.db.update(tenantSettings).set({ contentModerationMode: "ADMIN_APPROVAL" }).where(eq(tenantSettings.tenantId, tenant.id));
      await invalidateTenantCache(ctx, tenant.slug);
      expect((await r(poster).editJob(job.id, { title: "Backend Engineer II" })).body.data.moderationStatus).toBe("PENDING");
      expect(await row(waiting.id)).toMatchObject({ status: "REQUESTED" });
      const newcomer = await memberSession(ctx, tenant.id);
      expect((await r(newcomer).request(job.id)).status).toBe(404);
      expect((await r(poster).mine("received")).body.waiting).toBe(1);
      // Its sender can still see where it stands, and withdraw.
      expect((await r(requester).mine("sent")).body.data[0]).toMatchObject({ status: "REQUESTED", job: { available: false } });
      expect((await r(requester).withdraw(waiting.id)).status).toBe(200);
    });

    it("a suspended poster's job is hidden, and what waits for it stays, shown as unavailable, and can still be withdrawn", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const waiting = await askForReferral(ctx, tenant.slug, requester, job.id);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, poster.membership.id));
      expect((await r(requester).job(job.id)).status).toBe(404);
      expect(await row(waiting.id)).toMatchObject({ status: "REQUESTED" });
      expect((await r(requester).mine("sent")).body.data[0]).toMatchObject({ status: "REQUESTED", canWithdraw: true, job: { id: job.id, available: false } });
      expect((await r(requester).withdraw(waiting.id)).status).toBe(200);
    });
  });

  describe("reporting a request", () => {
    it("declines it, telling the requester exactly as a decline would, and files a report that holds only the note for an eligible admin", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const staff = await admin(tenant.id);
      const declinedRequester = await memberSession(ctx, tenant.id);
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      const declined = await askForReferral(ctx, tenant.slug, declinedRequester, job.id);
      await ctx.jobs.drain();
      await ctx.db.delete(notifications);
      realtime.clear();
      const reported = await r(poster).report(asked.id, { reason: "INAPPROPRIATE", details: "Not about the job" });
      expect(reported.status).toBe(200);
      expect(reported.body.data).toMatchObject({ status: "DECLINED", canReport: false });
      expect((await r(requester).mine("sent")).body.data[0]).toMatchObject({ status: "DECLINED" });
      // Its sender hears of it in the bell and live exactly as of the poster declining it, so nothing tells them it was reported.
      expect((await r(poster).decline(declined.id)).status).toBe(200);
      expect(await toldTo(requester)).toEqual(await toldTo(declinedRequester));
      expect(realtime.to(requester.user.id).map((e) => e.event)).toEqual(["referral:changed", "notification:new"]);
      expect(await noticesTo(requester)).toEqual([
        expect.objectContaining({
          type: "REFERRAL_DECLINED",
          title: "Pia Poster declined your referral request",
          body: "For Backend Engineer at Acme",
          data: { referralId: asked.id, box: "sent" },
          dedupeKey: `referral-declined-${asked.id}`,
        }),
      ]);

      const [report] = await ctx.db.select().from(chatReports);
      expect(report).toMatchObject({ targetKind: "REFERRAL_NOTE", targetId: asked.id, conversationId: null, reporterMembershipId: poster.membership.id, reportedMembershipId: requester.membership.id, noteSnapshot: REFERRAL_NOTE, reason: "INAPPROPRIATE", contextMessageIds: [] });
      const [filed] = await audits("chat_report.file");
      expect(filed).toMatchObject({ actorUserId: null, actorMembershipId: null, targetId: report!.id, metadata: { reason: "INAPPROPRIATE", targetKind: "REFERRAL_NOTE" } });
      // A decline audited by the reporter at the same moment would name them: only the one declined by hand is.
      expect((await audits("referral.decline")).map((a) => a.targetId)).toEqual([declined.id]);
      const told = await noticesTo(staff, "CHAT_REPORT_FILED");
      expect(told).toHaveLength(1);
      expect(told[0]).toMatchObject({ title: "A referral request was reported", body: null, data: { chatReportId: report!.id } });

      const view = await request(ctx.app).post(`/api/v1/t/${tenant.slug}/admin/chat-reports/${report!.id}/view`).set(staff.headers).send();
      expect(view.body.data as AdminChatReportViewDto).toMatchObject({ targetKind: "REFERRAL_NOTE", noteSnapshot: REFERRAL_NOTE, messages: [] });
    });

    it("reaches a note withdrawn, declined or closed with its job, changing nothing and telling nobody, but not one that was accepted", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const SECRET = "A note sent and withdrawn at once 4R8Z";
      const withdrawn = await askForReferral(ctx, tenant.slug, requester, job.id, SECRET);
      await r(requester).withdraw(withdrawn.id);
      const other = await memberSession(ctx, tenant.id);
      const closed = await askForReferral(ctx, tenant.slug, other, job.id);
      const decliner = await memberSession(ctx, tenant.id);
      const declined = await askForReferral(ctx, tenant.slug, decliner, job.id);
      await r(poster).decline(declined.id);
      const accepter = await memberSession(ctx, tenant.id);
      const accepted = (await r(poster).accept((await askForReferral(ctx, tenant.slug, accepter, job.id)).id)).body.data as ReferralDto;
      await r(poster).closeJob(job.id);
      const before = (await r(requester).mine("sent")).body.data;
      await ctx.jobs.drain();
      await ctx.db.delete(notifications);
      realtime.clear();

      expect((await r(poster).report(withdrawn.id)).body.data).toMatchObject({ status: "WITHDRAWN", canReport: false });
      expect((await r(poster).report(closed.id)).body.data).toMatchObject({ status: "CLOSED", canReport: false });
      expect((await r(poster).report(declined.id)).body.data).toMatchObject({ status: "DECLINED", canReport: false });
      expect((await r(requester).mine("sent")).body.data).toEqual(before);
      for (const s of [requester, other, decliner]) expect(await toldTo(s)).toEqual({ notifications: [], live: [] });
      expect(accepted.canReport).toBe(false);
      expect((await r(poster).report(accepted.id)).status).toBe(409);
      expect((await ctx.db.select().from(chatReports)).map((x) => x.noteSnapshot).sort()).toEqual([REFERRAL_NOTE, REFERRAL_NOTE, SECRET].sort());
    });

    it("is the poster's, once per request, and counts against chat-report, 30 an hour", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const asked = await askForReferral(ctx, tenant.slug, requester, job.id);
      expect((await r(requester).report(asked.id)).status).toBe(400);
      expect((await r(poster).report(asked.id, { reason: "LOUD" })).status).toBe(400);
      await withLimits(async () => {
        await ctx.redis.set(keys.rateLimit("chat-report", poster.membership.id), "30");
        expect((await r(poster).report(asked.id)).status).toBe(429);
      });
      expect((await row(asked.id)).status).toBe("REQUESTED");
      expect((await r(poster).report(asked.id)).status).toBe(200);
      expect((await r(poster).report(asked.id)).status).toBe(409);
      expect(await ctx.db.select().from(chatReports)).toHaveLength(1);
    });
  });

  describe("the ways out", () => {
    it("work with messaging off, while asking and accepting are refused, and nothing is deleted", async () => {
      const { tenant, poster, requester, r, job } = await setup();
      const reporter = await memberSession(ctx, tenant.id);
      const decliner = await memberSession(ctx, tenant.id);
      const waiting = await askForReferral(ctx, tenant.slug, requester, job.id);
      const toReport = await askForReferral(ctx, tenant.slug, reporter, job.id);
      const toDecline = await askForReferral(ctx, tenant.slug, decliner, job.id);
      await setFeatures(tenant.slug, tenant.id, { messaging: false });

      const newcomer = await memberSession(ctx, tenant.id);
      for (const res of [await r(newcomer).request(job.id), await r(poster).accept(toDecline.id)]) {
        expect(res.status, res.request.url).toBe(403);
        expect(res.body.error.code, res.request.url).toBe("FEATURE_DISABLED");
      }
      // Masked everywhere, though stored as it was.
      expect((await r(newcomer).job(job.id)).body.data.canRefer).toBe(false);
      expect((await r(newcomer).jobs({ canRefer: true })).body.data).toEqual([]);
      expect((await ctx.db.select().from(jobs).where(eq(jobs.id, job.id)))[0]!.canRefer).toBe(true);

      expect((await r(poster).mine("received")).body.data).toHaveLength(3);
      expect((await r(poster).forJob(job.id)).body.waiting).toBe(3);
      expect((await r(poster).summary()).body.data).toEqual({ received: 3, sent: 0 });
      expect((await r(requester).withdraw(waiting.id)).status).toBe(200);
      expect((await r(poster).decline(toDecline.id)).status).toBe(200);
      expect((await r(poster).report(toReport.id)).status).toBe(200);
      expect(await allRows()).toHaveLength(3);
      // The job can still be edited, its old setting kept, and closed.
      expect((await r(poster).editJob(job.id, { title: "Still hiring", canRefer: false })).status).toBe(200);
      expect((await ctx.db.select().from(jobs).where(eq(jobs.id, job.id)))[0]!.canRefer).toBe(true);
    });

    it("all close with jobs off, deleting nothing", async () => {
      const { tenant, requester, r, job } = await setup();
      const waiting = await askForReferral(ctx, tenant.slug, requester, job.id);
      await setFeatures(tenant.slug, tenant.id, { jobs: false });
      for (const res of [await r(requester).mine("sent"), await r(requester).summary(), await r(requester).withdraw(waiting.id), await r(requester).job(job.id)]) {
        expect(res.status, res.request.url).toBe(403);
        expect(res.body.error.code).toBe("FEATURE_DISABLED");
      }
      expect(await row(waiting.id)).toMatchObject({ status: "REQUESTED" });
    });
  });

  describe("rate limits", () => {
    const BUCKETS = [
      { bucket: "referral-request", limit: 10, via: "asking", hit: (r: ReturnType<typeof referralsApi>) => r.request(UNKNOWN) },
      { bucket: "connection-action", limit: 60, via: "accepting, shared with mentorship", hit: (r: ReturnType<typeof referralsApi>) => r.accept(UNKNOWN) },
      { bucket: "connection-action", limit: 60, via: "declining, shared with mentorship", hit: (r: ReturnType<typeof referralsApi>) => r.decline(UNKNOWN) },
      { bucket: "connection-action", limit: 60, via: "withdrawing, shared with mentorship", hit: (r: ReturnType<typeof referralsApi>) => r.withdraw(UNKNOWN) },
    ];
    for (const { bucket, limit, via, hit } of BUCKETS) {
      it(`${bucket} allows ${limit} an hour, counting ${via}`, async () => {
        const { requester, r } = await setup();
        await withLimits(async () => {
          const key = keys.rateLimit(bucket, requester.membership.id);
          expect((await hit(r(requester))).status).not.toBe(429);
          expect(await ctx.redis.ttl(key)).toBeGreaterThan(3600 - 5);
          await ctx.redis.set(key, String(limit - 1));
          expect((await hit(r(requester))).status).not.toBe(429);
          expect((await hit(r(requester))).status).toBe(429);
        });
      });
    }
  });

  describe("a note's words", () => {
    it("never reach a notification, an audit row, a job's payload, or the jobs list", async () => {
      const SECRET = "A note only the poster and the chat may hold 6T3W";
      const { tenant, poster, requester, r, job } = await setup();
      await admin(tenant.id);
      const accepted = await askForReferral(ctx, tenant.slug, requester, job.id, SECRET);
      await r(poster).accept(accepted.id);
      const declined = await memberSession(ctx, tenant.id);
      await r(poster).decline((await askForReferral(ctx, tenant.slug, declined, job.id, SECRET)).id);
      const reported = await memberSession(ctx, tenant.id);
      await r(poster).report((await askForReferral(ctx, tenant.slug, reported, job.id, SECRET)).id);
      const withdrawer = await memberSession(ctx, tenant.id);
      await r(withdrawer).withdraw((await askForReferral(ctx, tenant.slug, withdrawer, job.id, SECRET)).id);
      const closed = await memberSession(ctx, tenant.id);
      await askForReferral(ctx, tenant.slug, closed, job.id, SECRET);
      await r(poster).closeJob(job.id);
      await ctx.jobs.drain();
      const everywhere = JSON.stringify([
        await ctx.db.select().from(notifications),
        await ctx.db.select().from(auditLog),
        ctx.jobs.history,
        (await r(poster).job(job.id)).body,
        (await r(requester).job(job.id)).body,
        (await r(requester).jobs({ includeClosed: true })).body,
      ]);
      expect(everywhere).not.toContain(SECRET);
      expect(everywhere).toContain(accepted.id);
      // Every member action was audited, so the sweep above read each one's row.
      for (const action of ["referral.request", "referral.accept", "referral.decline", "referral.withdraw", "chat_report.file"]) expect((await audits(action)).length, action).toBeGreaterThan(0);
    });
  });

  describe("demo data", () => {
    it("seeds two jobs that take requests in the university only, one waiting and one accepted with its chat, and none of the e2e members", async () => {
      const { tenantIds } = await seedCore(ctx.db, ["+919999999999"]);
      const membershipIds = await seedMembers(ctx.db, tenantIds);
      await seedContent(ctx.db, tenantIds, membershipIds);
      await seedDemoHistory(ctx.db, tenantIds, membershipIds);
      await seedConnections(ctx.db, tenantIds, membershipIds);
      const count = async () => [await allRows(), await ctx.db.select().from(chatConversations), await ctx.db.select().from(jobs).where(eq(jobs.canRefer, true))].map((x) => x.length);
      const before = await count();
      await seedConnections(ctx.db, tenantIds, membershipIds);
      expect(await count()).toEqual(before);
      const uni = tenantIds["demo-university"]!;

      const offering = await ctx.db.select().from(jobs).where(eq(jobs.canRefer, true));
      expect(offering.map((j) => [j.tenantId, j.title]).sort()).toEqual([
        [uni, "Associate Product Manager"],
        [uni, "Backend Engineer (Node.js)"],
      ]);
      const all = await allRows();
      expect(all.map((x) => x.status).sort()).toEqual(["ACCEPTED", "REQUESTED"]);
      expect(all.every((x) => x.tenantId === uni && !x.suppressed && x.note.length >= 10 && x.note.length <= 500)).toBe(true);
      for (const x of all) expect(offering.find((j) => j.id === x.jobId)).toMatchObject({ authorMembershipId: x.posterMembershipId, title: x.jobTitle, companyName: x.jobCompany });

      const accepted = all.find((x) => x.status === "ACCEPTED")!;
      expect(await conversationRow(ctx, accepted.conversationId!)).toMatchObject({ origin: "REFERRAL", originId: accepted.id, directState: "ACCEPTED", requesterMembershipId: null });
      const thread = await ctx.db.select().from(chatMessages).where(eq(chatMessages.conversationId, accepted.conversationId!));
      expect(thread.find((t) => t.seq === 1)).toMatchObject({ body: accepted.note, senderMembershipId: accepted.requesterMembershipId, clientKey: `origin-${accepted.id}` });
      expect(thread.map((t) => t.seq).sort((x, y) => x - y)).toEqual(Array.from({ length: thread.length }, (_, i) => i + 1));

      // Nobody an e2e journey signs in as asks or is asked, so what those journeys see stays as it was.
      const e2ePhones = ["+919100000003", "+919100000004", "+919100000005", "+919100000006", "+919000000001", "+91931000006", "+91931000007", "+91931000012", "+91931000013"];
      const e2e = await ctx.db
        .select({ id: memberships.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.tenantId, uni), inArray(users.phoneE164, e2ePhones)));
      expect(e2e.length).toBe(e2ePhones.length);
      const touched = new Set(all.flatMap((x) => [x.posterMembershipId, x.requesterMembershipId]));
      for (const { id } of e2e) expect(touched.has(id), id).toBe(false);
      expect(await ctx.db.select().from(notifications)).toEqual([]);
    });
  });
});
