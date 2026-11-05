import type { MembershipStatus, NotificationDto } from "@illuminize/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import pg from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatReports, memberships, notifications } from "../../src/db/schema";
import { markUnreadReadByData } from "../../src/repositories/notifications.repo";
import { notify } from "../../src/services/notifications/notification.service";
import { acceptedThread, chatApi } from "../helpers/chat";
import { refusingAudit, untilSomeoneSleeps, untilSomeoneWaitsFor, withTrigger } from "../helpers/db";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

/** An advisory lock key the test holds to stop a request inside a trigger until it lets go. */
const GATE = 424243;
const REASON = "Batch could not be verified";
/** Only a change of status: a request's activity stamp updates the member's row too, outside any transaction. */
const onStatusChange = (body: string) => `if new.status is distinct from old.status then ${body} end if; return new;`;

type Headers = { headers: Record<string, string> };
type Who = Headers & { user: { id: string }; membership: { id: string } };

describe.skipIf(!dbAvailable)("requests to join, as admins see and handle them", () => {
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

  const api = () => request(ctx.app);

  /** An institution whose admins approve new members: two of its own admins, and a member of staff holding the role there too. */
  async function institution() {
    const { tenant } = await createTenant(ctx, { memberApprovalMode: "ADMIN_APPROVAL" });
    const first = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const second = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const staffUser = await createUser(ctx, { isPlatformAdmin: true });
    const staffMembership = await createMembership(ctx, tenant.id, staffUser.id, { role: "TENANT_ADMIN" });
    const staff: Who = { user: staffUser, membership: staffMembership, headers: auth((await loginAs(ctx, staffUser.phoneE164)).accessToken) };
    return { tenant, base: `/api/v1/t/${tenant.slug}`, first, second, staff, admins: [first, second, staff] as Who[] };
  }

  /** Someone asking to join through the app, which tells every admin. */
  async function applicant(slug: string) {
    const user = await createUser(ctx);
    const headers = auth((await loginAs(ctx, user.phoneE164)).accessToken);
    const res = await api().post(`/api/v1/t/${slug}/memberships`).set(headers).send(PROFILE);
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING");
    return { headers, id: res.body.data.id as string };
  }

  /** With `expectedStatus`, as a new-member notice sends it; without, as the members list does. */
  const act = (base: string, who: Headers, id: string, action: "approve" | "reject", expectedStatus?: MembershipStatus) =>
    api()
      .post(`${base}/admin/members/${id}/${action}`)
      .set(who.headers)
      .send({ ...(action === "reject" ? { reason: REASON } : {}), ...(expectedStatus ? { expectedStatus } : {}) })
      .then((res) => res);

  /** The new-member notices `who` holds about this membership, oldest first, as their list shows them. */
  async function noticesAbout(base: string, who: Headers, id: string): Promise<NotificationDto[]> {
    const res = await api().get(`${base}/notifications`).set(who.headers);
    expect(res.status).toBe(200);
    return (res.body.data as NotificationDto[]).filter((n) => n.type === "NEW_MEMBER_PENDING" && n.data.membershipId === id).reverse();
  }

  async function unreadAbout(who: Pick<Who, "membership">, id: string): Promise<number> {
    const rows = await ctx.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientMembershipId, who.membership.id),
          eq(notifications.type, "NEW_MEMBER_PENDING"),
          isNull(notifications.readAt),
          sql`${notifications.data} ->> 'membershipId' = ${id}`,
        ),
      );
    return rows.length;
  }

  const unreadCount = async (base: string, who: Headers) => (await api().get(`${base}/notifications/unread-count`).set(who.headers)).body.data.count as number;
  const unreadEvents = (who: Pick<Who, "user">) => realtime.to(who.user.id, "notification:unread").map((e) => e.payload);
  const allUnreadEvents = () => realtime.events.filter((e) => e.event === "notification:unread");
  const auditRows = (action: string, targetId: string) => ctx.db.select().from(auditLog).where(and(eq(auditLog.action, action), eq(auditLog.targetId, targetId)));
  const toldMember = (membershipId: string, type: "MEMBERSHIP_APPROVED" | "MEMBERSHIP_REJECTED") =>
    ctx.db.select().from(notifications).where(and(eq(notifications.recipientMembershipId, membershipId), eq(notifications.type, type)));
  const statusOf = async (id: string) => (await ctx.db.select().from(memberships).where(eq(memberships.id, id)))[0]?.status;

  /**
   * Runs `fn` with a trigger that stops whoever fires it until `open` is called (or `fn` ends), so a test can start a
   * second request while the first is known to be inside its transaction, holding its locks.
   */
  async function withGate<T>(when: string, body: (stop: string) => string, fn: (open: () => Promise<void>) => Promise<T>): Promise<T> {
    const gate = new pg.Client({ connectionString: ctx.config.DATABASE_URL });
    await gate.connect();
    let held = false;
    const open = async () => {
      if (!held) return;
      held = false;
      await gate.query(`select pg_advisory_unlock(${GATE})`);
    };
    try {
      await gate.query(`select pg_advisory_lock(${GATE})`);
      held = true;
      return await withTrigger(ctx, when, body(`perform pg_advisory_xact_lock(${GATE});`), async () => {
        try {
          return await fn(open);
        } finally {
          // Before the trigger is dropped, which waits for whoever is still inside it.
          await open();
        }
      });
    } finally {
      await gate.end();
    }
  }

  /**
   * Runs `fn` while a transaction that changes a member's status fails as it commits, after everything in it has run: what
   * it did inside must go with it, and nothing it left for after the commit may happen.
   */
  async function failingStatusCommits<T>(fn: () => Promise<T>): Promise<T> {
    await ctx.db.execute(sql.raw("create or replace function test_fail_commit() returns trigger as $$ begin raise exception 'refused at commit'; end $$ language plpgsql"));
    await ctx.db.execute(
      sql.raw(
        "create constraint trigger test_fail_commit after update on memberships deferrable initially deferred for each row when (new.status is distinct from old.status) execute function test_fail_commit()",
      ),
    );
    try {
      return await fn();
    } finally {
      await ctx.db.execute(sql.raw("drop trigger test_fail_commit on memberships"));
      await ctx.db.execute(sql.raw("drop function test_fail_commit()"));
    }
  }

  /** Waits until `n` connections at once wait for advisory locks. */
  async function untilWaitingForAdvisory(n: number): Promise<void> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const { rows } = await ctx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.datname = current_database() and l.locktype = 'advisory' and not l.granted`,
      );
      if ((rows[0]?.n ?? 0) >= n) return;
      if (Date.now() > deadline) throw new Error(`Never saw ${n} connections waiting for advisory locks`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** The promise's result, or null if it takes longer than `ms`. */
  async function within<T>(ms: number, promise: Promise<T>): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), ms);
    });
    try {
      return await Promise.race([promise, late]);
    } finally {
      clearTimeout(timer);
    }
  }

  describe("on a notification list", () => {
    it("shows admins, staff holding the role among them, each new-member notice's request as it is now, and nobody else", async () => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      for (const who of [s.first, s.staff]) {
        const [notice, ...more] = await noticesAbout(s.base, who, p.id);
        expect(more).toEqual([]);
        expect(notice).toMatchObject({ readAt: null, subject: { kind: "membership", membershipId: p.id, fullName: PROFILE.fullName, status: "PENDING" } });
      }

      // Someone who is no longer an admin keeps their old notices, without the request.
      expect((await api().patch(`${s.base}/admin/members/${s.second.membership.id}/role`).set(s.first.headers).send({ role: "MEMBER" })).status).toBe(200);
      const [demoted] = await noticesAbout(s.base, s.second, p.id);
      expect(demoted).toMatchObject({ data: { membershipId: p.id } });
      expect(demoted).not.toHaveProperty("subject");
      // As does a member holding one, however it got there.
      const member = await memberSession(ctx, s.tenant.id);
      await notify(ctx, { tenantId: s.tenant.id, recipientMembershipIds: [member.membership.id], type: "NEW_MEMBER_PENDING", title: "New member awaiting approval", data: { membershipId: p.id } });
      const [theirs] = await noticesAbout(s.base, member, p.id);
      expect(theirs).toMatchObject({ data: { membershipId: p.id } });
      expect(theirs).not.toHaveProperty("subject");

      // A notice whose id isn't one gets none, and leaves the rest of the list as it was.
      await notify(ctx, { tenantId: s.tenant.id, recipientMembershipIds: [s.first.membership.id], type: "NEW_MEMBER_PENDING", title: "New member awaiting approval", data: { membershipId: "not-an-id" } });
      const [odd] = await noticesAbout(s.base, s.first, "not-an-id");
      expect(odd).toMatchObject({ data: { membershipId: "not-an-id" } });
      expect(odd).not.toHaveProperty("subject");
      expect((await noticesAbout(s.base, s.first, p.id))[0]!.subject).toMatchObject({ status: "PENDING" });

      // Once the applicant has deleted their account there's nobody left to approve.
      expect((await api().post("/api/v1/me/delete").set(p.headers).send({ confirm: true })).status).toBe(204);
      const [gone] = await noticesAbout(s.base, s.first, p.id);
      expect(gone!.subject).toEqual({ kind: "membership", membershipId: p.id, fullName: null, status: null });
    });
  });

  describe("once one admin has dealt with a request", () => {
    it.each(["approve", "reject"] as const)("marks every admin's copy read with the change (%s), staff included, and tells their open apps once it commits", async (action) => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      const other = await applicant(s.tenant.slug);
      realtime.clear();

      // Nothing changes when the change can't be recorded...
      await refusingAudit(ctx, `membership.${action}`, async () => {
        expect((await act(s.base, s.first, p.id, action)).status).toBe(500);
      });
      expect(await statusOf(p.id)).toBe("PENDING");
      // ...nor when it fails as it commits, after every copy was marked: the marks go with it, and no open app hears of them.
      await failingStatusCommits(async () => {
        expect((await act(s.base, s.first, p.id, action)).status).toBe(500);
      });
      expect(await statusOf(p.id)).toBe("PENDING");
      expect(await auditRows(`membership.${action}`, p.id)).toEqual([]);
      expect(await toldMember(p.id, action === "approve" ? "MEMBERSHIP_APPROVED" : "MEMBERSHIP_REJECTED")).toEqual([]);
      for (const who of s.admins) expect(await unreadAbout(who, p.id)).toBe(1);
      expect(allUnreadEvents()).toEqual([]);

      expect((await act(s.base, s.first, p.id, action)).status).toBe(200);
      for (const who of s.admins) {
        expect(await unreadAbout(who, p.id)).toBe(0);
        // The other request still waits for them.
        expect(await unreadAbout(who, other.id)).toBe(1);
        expect(await unreadCount(s.base, who)).toBe(1);
        expect(unreadEvents(who)).toEqual([{ tenantSlug: s.tenant.slug, membershipId: who.membership.id, count: 1 }]);
        const [notice] = await noticesAbout(s.base, who, p.id);
        expect(notice).toMatchObject({ readAt: expect.any(String), subject: { status: action === "approve" ? "APPROVED" : "REJECTED" } });
      }
    });

    it("marks read both notices of someone who applied again, and shows each the outcome", async () => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      expect((await act(s.base, s.first, p.id, "reject")).status).toBe(200);
      const again = await api().post(`${s.base}/memberships`).set(p.headers).send(PROFILE);
      expect(again.body.data).toMatchObject({ id: p.id, status: "PENDING" });
      expect((await noticesAbout(s.base, s.second, p.id)).map((n) => [n.readAt === null, n.subject?.status])).toEqual([
        [false, "PENDING"],
        [true, "PENDING"],
      ]);
      // A copy left unread from before handled notices were cleared for everyone.
      await ctx.db.update(notifications).set({ readAt: null }).where(eq(notifications.recipientMembershipId, s.second.membership.id));
      expect(await unreadAbout(s.second, p.id)).toBe(2);

      realtime.clear();
      expect((await act(s.base, s.first, p.id, "approve")).status).toBe(200);
      expect(await unreadAbout(s.second, p.id)).toBe(0);
      expect((await noticesAbout(s.base, s.second, p.id)).map((n) => n.subject?.status)).toEqual(["APPROVED", "APPROVED"]);
      expect(unreadEvents(s.second)).toEqual([{ tenantSlug: s.tenant.slug, membershipId: s.second.membership.id, count: 0 }]);
    });
  });

  describe("when two admins act on the same request at once", () => {
    /**
     * The first admin's change, stopped as it writes the member's new status, then the second's, which must wait for it.
     * Both send `expectedStatus` if given, as the notice's buttons do.
     */
    async function race(first: "approve" | "reject", second: "approve" | "reject", expectedStatus?: MembershipStatus) {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      const [a, b] = await withGate("before update on memberships", onStatusChange, async (open) => {
        const a = act(s.base, s.first, p.id, first, expectedStatus);
        await untilSomeoneWaitsFor(ctx, "advisory");
        const b = act(s.base, s.second, p.id, second, expectedStatus);
        // The second waits for the member's row, which the first holds until it commits.
        await untilSomeoneWaitsFor(ctx, "transactionid");
        await open();
        return Promise.all([a, b]);
      });
      return { s, p, a, b };
    }

    it("lets the first approve and tells the second it already has been, with one record and one notice to the member", async () => {
      const { p, a, b } = await race("approve", "approve");
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(b.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This member has already been approved", details: { status: "APPROVED" } });
      expect(await statusOf(p.id)).toBe("APPROVED");
      expect(await auditRows("membership.approve", p.id)).toHaveLength(1);
      expect(await toldMember(p.id, "MEMBERSHIP_APPROVED")).toHaveLength(1);
    });

    it("refuses a rejection that comes second to an approval", async () => {
      const { p, a, b } = await race("approve", "reject");
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(b.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This member has already been approved", details: { status: "APPROVED" } });
      expect(await statusOf(p.id)).toBe("APPROVED");
      expect(await auditRows("membership.reject", p.id)).toEqual([]);
      expect(await toldMember(p.id, "MEMBERSHIP_REJECTED")).toEqual([]);
      expect(await toldMember(p.id, "MEMBERSHIP_APPROVED")).toHaveLength(1);
    });

    it("refuses an approval from the notice that comes second to a rejection, with one record and one notice to the member", async () => {
      const { p, a, b } = await race("reject", "approve", "PENDING");
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(b.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This request has already been rejected", details: { status: "REJECTED" } });
      expect(await statusOf(p.id)).toBe("REJECTED");
      expect(await auditRows("membership.reject", p.id)).toHaveLength(1);
      expect(await auditRows("membership.approve", p.id)).toEqual([]);
      expect(await toldMember(p.id, "MEMBERSHIP_REJECTED")).toHaveLength(1);
      expect(await toldMember(p.id, "MEMBERSHIP_APPROVED")).toEqual([]);
    });

    it("refuses a rejection from the notice that comes second to an approval", async () => {
      const { p, a, b } = await race("approve", "reject", "PENDING");
      expect(a.status).toBe(200);
      expect(b.status).toBe(409);
      expect(b.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This member has already been approved", details: { status: "APPROVED" } });
      expect(await auditRows("membership.reject", p.id)).toEqual([]);
      expect(await toldMember(p.id, "MEMBERSHIP_REJECTED")).toEqual([]);
    });

    it("lets an approval from the members list, which sends no status, see a rejection that came first and approve all the same", async () => {
      const { p, a, b } = await race("reject", "approve");
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(await statusOf(p.id)).toBe("APPROVED");
      expect((await auditRows("membership.approve", p.id)).map((r) => r.metadata)).toEqual([{ from: "REJECTED", to: "APPROVED", reason: null }]);
    });
  });

  describe("with the status the admin acted on", () => {
    it("acts while it still holds, and otherwise says what it is now", async () => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      const q = await applicant(s.tenant.slug);
      expect((await act(s.base, s.first, p.id, "approve", "PENDING")).status).toBe(200);
      expect((await act(s.base, s.first, q.id, "reject", "PENDING")).status).toBe(200);
      const late = await act(s.base, s.second, q.id, "approve", "PENDING");
      expect(late.status).toBe(409);
      expect(late.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This request has already been rejected", details: { status: "REJECTED" } });
      // Approving someone rejected on purpose, from a list that showed them so.
      expect((await act(s.base, s.second, q.id, "approve", "REJECTED")).status).toBe(200);
      expect((await act(s.base, s.second, q.id, "approve", "NOT_A_STATUS" as MembershipStatus)).status).toBe(400);
      expect(await statusOf(q.id)).toBe("APPROVED");
    });
  });

  describe("when someone applies again as an admin approves their rejected request", () => {
    it("waits for the approval and tells them they're in, rather than putting the request back", async () => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      expect((await act(s.base, s.first, p.id, "reject")).status).toBe(200);
      const [approved, again] = await withGate("before update on memberships", onStatusChange, async (open) => {
        const approving = act(s.base, s.first, p.id, "approve");
        await untilSomeoneWaitsFor(ctx, "advisory");
        const applying = api().post(`${s.base}/memberships`).set(p.headers).send(PROFILE).then((res) => res);
        // The application waits for the member's row, which the approval holds until it commits.
        await untilSomeoneWaitsFor(ctx, "transactionid");
        await open();
        return Promise.all([approving, applying]);
      });
      expect(approved.status).toBe(200);
      expect(again.status).toBe(409);
      expect(again.body.error).toMatchObject({ code: "CONFLICT", message: "You are already a member of this institution" });
      expect(await statusOf(p.id)).toBe("APPROVED");
      expect(await auditRows("membership.reapply", p.id)).toEqual([]);
      expect(await unreadAbout(s.second, p.id)).toBe(0);
    });
  });

  describe("approving everyone waiting", () => {
    it("marks every admin's copies read with it, and undoes both when it can't be recorded or commit", async () => {
      const s = await institution();
      const waiting = [await applicant(s.tenant.slug), await applicant(s.tenant.slug), await applicant(s.tenant.slug)];
      const approveAll = () => api().post(`${s.base}/admin/members/approve-all-pending`).set(s.first.headers);
      realtime.clear();

      await refusingAudit(ctx, "membership.approve_all", async () => {
        expect((await approveAll()).status).toBe(500);
      });
      for (const p of waiting) expect(await statusOf(p.id)).toBe("PENDING");
      // Failing as it commits, after the marks: they go with it.
      await failingStatusCommits(async () => {
        expect((await approveAll()).status).toBe(500);
      });
      expect(await ctx.db.select().from(auditLog).where(eq(auditLog.action, "membership.approve_all"))).toEqual([]);
      for (const p of waiting) {
        expect(await statusOf(p.id)).toBe("PENDING");
        expect(await toldMember(p.id, "MEMBERSHIP_APPROVED")).toEqual([]);
        for (const who of s.admins) expect(await unreadAbout(who, p.id)).toBe(1);
      }
      expect(allUnreadEvents()).toEqual([]);

      const res = await approveAll();
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ approved: 3 });
      for (const p of waiting) {
        expect(await statusOf(p.id)).toBe("APPROVED");
        expect(await toldMember(p.id, "MEMBERSHIP_APPROVED")).toHaveLength(1);
        for (const who of s.admins) expect(await unreadAbout(who, p.id)).toBe(0);
      }
      for (const who of s.admins) {
        expect(await unreadCount(s.base, who)).toBe(0);
        expect(unreadEvents(who)).toEqual([{ tenantSlug: s.tenant.slug, membershipId: who.membership.id, count: 0 }]);
      }
      const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.action, "membership.approve_all"));
      expect(audits.map((a) => a.metadata)).toEqual([{ count: 3, membershipIds: expect.arrayContaining(waiting.map((p) => p.id)) }]);
    });

    it("marks them in one statement however many there are", async () => {
      const s = await institution();
      const p = await applicant(s.tenant.slug);
      // More than one statement can take as separate parameters (65,535).
      const ids = [...Array.from({ length: 70_000 }, (_, i) => `waiting-${i}`), p.id];
      const adminIds = s.admins.map((a) => a.membership.id);
      expect((await markUnreadReadByData(ctx.db, adminIds, "NEW_MEMBER_PENDING", "membershipId", ids)).sort()).toEqual([...adminIds].sort());
      for (const who of s.admins) expect(await unreadAbout(who, p.id)).toBe(0);
    });
  });

  // An admin's change takes the lock that holds back reports about them, then the member's row: never the other way round.
  describe("with a chat report about the acting admin", () => {
    async function reported() {
      const s = await institution();
      const reporter = await memberSession(ctx, s.tenant.id);
      const conversationId = await acceptedThread(ctx, s.tenant.slug, reporter, s.first);
      const sent = await chatApi(ctx, s.tenant.slug, s.first).send(conversationId, "Something to report");
      expect(sent.status).toBeLessThan(300);
      const p = await applicant(s.tenant.slug);
      const reportsHere = () => ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, s.tenant.id));
      return { ...s, p, reportsHere, report: () => chatApi(ctx, s.tenant.slug, reporter).report(sent.body.data.id).then((res) => res) };
    }

    it("files one made during their approval once the approval commits, and both stand", async () => {
      const s = await reported();
      await withTrigger(ctx, "before update on memberships", onStatusChange("perform pg_sleep(1);"), async () => {
        const approving = act(s.base, s.first, s.p.id, "approve");
        await untilSomeoneSleeps(ctx);
        const filing = s.report();
        // The report waits for the hold the approval took on its admin.
        await untilSomeoneWaitsFor(ctx, "advisory");
        const [approved, filed] = await Promise.all([approving, filing]);
        expect(approved.status).toBe(200);
        expect(filed.status).toBe(201);
      });
      expect(await statusOf(s.p.id)).toBe("APPROVED");
      expect(await s.reportsHere()).toEqual([expect.objectContaining({ status: "OPEN", reportedMembershipId: s.first.membership.id })]);
    });

    it("waits for one being filed before taking the member's row, so another admin can deal with the request meanwhile", async () => {
      const s = await reported();
      const { filed, late, meanwhile } = await withGate("before insert on chat_reports", (stop) => `${stop} return new;`, async (open) => {
        const filing = s.report();
        // The report stops as it's written, holding its share of the lock on the admin it's about.
        await untilWaitingForAdvisory(1);
        const late = act(s.base, s.first, s.p.id, "approve");
        await untilWaitingForAdvisory(2);
        // Had the approval taken the member's row first, this would wait behind it, and so behind the report.
        const meanwhile = await within(3000, act(s.base, s.second, s.p.id, "approve"));
        await open();
        return { filed: await filing, late: await late, meanwhile };
      });
      expect(meanwhile?.status).toBe(200);
      expect(filed.status).toBe(201);
      expect(late.status).toBe(409);
      expect(late.body.error).toEqual({ code: "INVALID_TRANSITION", message: "This member has already been approved", details: { status: "APPROVED" } });
      expect((await auditRows("membership.approve", s.p.id)).map((r) => r.actorMembershipId)).toEqual([s.second.membership.id]);
      expect(await s.reportsHere()).toEqual([expect.objectContaining({ status: "OPEN", reportedMembershipId: s.first.membership.id })]);
    });
  });
});
