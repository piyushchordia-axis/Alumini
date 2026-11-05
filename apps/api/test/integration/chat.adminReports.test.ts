import { randomUUID } from "node:crypto";
import { defaultFeaturesFor, NEEDS_OTHER_STAFF_TEXT, type AdminChatReportViewDto, type AuditDto, type ChatConversationDto, type ChatMessageDto } from "@illuminize/shared";
import { and, eq, inArray } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { auditLog, chatMessages, chatReports, memberships, notifications, tenantSettings } from "../../src/db/schema";
import { keys } from "../../src/redis/keys";
import { chatReportContext } from "../../src/repositories/chatReports.repo";
import { invalidateTenantCache } from "../../src/services/tenant.service";
import { capturingLogger } from "../helpers/capturingLogger";
import { acceptedThread, bareMember, chatApi, type Session } from "../helpers/chat";
import { refusingAuditWhere as refuseAuditWhere, untilSomeoneSleeps, untilSomeoneWaitsFor, withTrigger } from "../helpers/db";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { askMentor, mentorshipApi, offerToMentor } from "../helpers/mentorship";
import { askForReferral, postReferralJob, referralsApi } from "../helpers/referrals";
import { CapturingRealtime } from "../helpers/realtimeHarness";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const SECRET = "A sentence that only an audited view may show 7Q4X";
const DETAILS = "The reporter's words, which may quote the sentence";
const NOTE = "Please keep it civil";

type Headers = Pick<Session, "headers">;
type MemberOptions = Parameters<typeof memberSession>[2];

describe.skipIf(!dbAvailable)("admin chat reports", () => {
  let ctx: TestContext;
  let realtime: CapturingRealtime;
  let staff: { headers: ReturnType<typeof auth>; userId: string };
  // Every scenario gets its own institution, so nothing here needs a reset between tests.
  beforeAll(async () => {
    realtime = new CapturingRealtime();
    ctx = await createTestContext({}, { realtime });
    await ctx.truncateAll();
  });
  // Redis alone, for the sign-in limits every test here runs into. It holds sessions too, so staff sign in again.
  beforeEach(async () => {
    realtime.clear();
    await ctx.redis.flushall();
    const session = await loginAs(ctx, "+919999999999");
    staff = { headers: auth(session.accessToken), userId: session.user.id };
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const api = () => request(ctx.app);

  /** The routes one person gets, under one institution's slug. */
  function adminOf(slug: string, who: Headers) {
    const base = `/api/v1/t/${slug}/admin`;
    const reports = `${base}/chat-reports`;
    return {
      list: (query: Record<string, unknown> = {}) => api().get(reports).query(query).set(who.headers),
      view: (id: string) => api().post(`${reports}/${id}/view`).set(who.headers).send(),
      resolve: (id: string, body: Record<string, unknown> = { action: "NONE" }) => api().post(`${reports}/${id}/resolve`).set(who.headers).send(body),
      dismiss: (id: string, body: Record<string, unknown> = {}) => api().post(`${reports}/${id}/dismiss`).set(who.headers).send(body),
      dashboard: () => api().get(`${base}/dashboard`).set(who.headers),
      audit: (query: Record<string, unknown> = {}) => api().get(`${base}/audit`).query(query).set(who.headers),
      member: (id: string) => api().get(`${base}/members/${id}`).set(who.headers),
      suspend: (id: string) => api().post(`${base}/members/${id}/suspend`).set(who.headers).send({ reason: "Being tested" }),
      reinstate: (id: string) => api().post(`${base}/members/${id}/reinstate`).set(who.headers).send(),
      approve: (id: string) => api().post(`${base}/members/${id}/approve`).set(who.headers).send(),
      setRole: (id: string, role: string) => api().patch(`${base}/members/${id}/role`).set(who.headers).send({ role }),
      profile: (id: string, body: Record<string, unknown>) => api().patch(`${base}/members/${id}/profile`).set(who.headers).send(body),
    };
  }
  const platformList = (who: Headers = staff, query: Record<string, unknown> = {}) => api().get("/api/v1/platform/chat-reports").query(query).set(who.headers);
  const platformAudit = (who: Headers, query: Record<string, unknown> = {}) => api().get("/api/v1/platform/audit").query(query).set(who.headers);

  /** A reported message: `reported` sent it in an accepted thread and `reporter` filed the report. */
  async function scenario(opts: { reporter?: MemberOptions; reported?: MemberOptions; noNeutralAdmin?: boolean } = {}) {
    const { tenant } = await createTenant(ctx);
    const reporter = await memberSession(ctx, tenant.id, { fullName: "Reporter Rao", ...opts.reporter });
    const reported = await memberSession(ctx, tenant.id, { fullName: "Reported Roy", ...opts.reported });
    const neutral = opts.noNeutralAdmin ? null : await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", fullName: "Neutral Nair" });
    const conversationId = await acceptedThread(ctx, tenant.slug, reporter, reported);
    const sent = await chatApi(ctx, tenant.slug, reported).send(conversationId, SECRET);
    const filed = await chatApi(ctx, tenant.slug, reporter).report(sent.body.data.id, { reason: "HARASSMENT", details: DETAILS });
    expect(filed.status).toBe(201);
    return { tenant, reporter, reported, neutral: neutral!, conversationId, messageId: sent.body.data.id as string, reportId: filed.body.data.id as string, as: (who: Headers) => adminOf(tenant.slug, who) };
  }

  const auditRows = (tenantId: string, action: string) => ctx.db.select().from(auditLog).where(and(eq(auditLog.tenantId, tenantId), eq(auditLog.action, action)));
  const reportRow = async (id: string) => (await ctx.db.select().from(chatReports).where(eq(chatReports.id, id)))[0]!;
  const messageRow = async (id: string) => (await ctx.db.select().from(chatMessages).where(eq(chatMessages.id, id)))[0]!;
  const removedNotices = (tenantId: string) => ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.type, "CHAT_MESSAGE_REMOVED")));
  const expectNoWords = (value: unknown, ...words: string[]) => {
    const text = JSON.stringify(value);
    for (const word of words) expect(text).not.toContain(word);
  };
  const refusingAuditWhere = (check: string, fn: () => Promise<void>) => refuseAuditWhere(ctx, check, fn);
  const refusingAudit = (action: string, fn: () => Promise<void>) => refusingAuditWhere(`action <> '${action}'`, fn);
  /** Someone with the staff flag and a membership here, which is the case a staff-only session can't show. */
  async function staffMember(tenantId: string, membership: MemberOptions = {}) {
    const user = await createUser(ctx, { isPlatformAdmin: true });
    const row = await createMembership(ctx, tenantId, user.id, membership);
    return { headers: auth((await loginAs(ctx, user.phoneE164)).accessToken), user, membership: row, token: "" } as Session;
  }

  describe("the queue", () => {
    it("carries the reason, status, kind, time and names, and nothing anyone wrote", async () => {
      const s = await scenario();
      const res = await s.as(s.neutral).list();
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body).toMatchObject({ page: 1, total: 1 });
      expect(res.body.data).toEqual([
        {
          id: s.reportId,
          targetKind: "MESSAGE",
          reason: "HARASSMENT",
          status: "OPEN",
          reporter: expect.objectContaining({ id: s.reporter.membership.id, fullName: "Reporter Rao" }),
          reported: expect.objectContaining({ id: s.reported.membership.id, fullName: "Reported Roy" }),
          resolutionAction: null,
          resolvedAt: null,
          createdAt: expect.any(String),
        },
      ]);
      expectNoWords(res.body, SECRET, DETAILS, "Hello there");

      // Even once it has been closed with a note, and from the staff list too.
      await s.as(s.neutral).resolve(s.reportId, { action: "NONE", note: NOTE });
      const closed = await s.as(s.neutral).list({ status: "RESOLVED" });
      expect(closed.body.data).toEqual([expect.objectContaining({ id: s.reportId, status: "RESOLVED", resolutionAction: "NONE", resolvedAt: expect.any(String) })]);
      expectNoWords(closed.body, SECRET, DETAILS, NOTE);
    });

    it("filters by status and pages, and counts only what the status shows", async () => {
      const s = await scenario();
      const chat = chatApi(ctx, s.tenant.slug, s.reported);
      const fileAnother = async (body: string) => {
        const { body: sent } = await chat.send(s.conversationId, body);
        const filed = await chatApi(ctx, s.tenant.slug, s.reporter).report(sent.data.id);
        return filed.body.data.id as string;
      };
      const second = await fileAnother("Second");
      const third = await fileAnother("Third");
      await s.as(s.neutral).dismiss(second);

      const open = await s.as(s.neutral).list({ pageSize: 1 });
      expect(open.body).toMatchObject({ total: 2, pageSize: 1 });
      expect(open.body.data.map((r: { id: string }) => r.id)).toEqual([third]);
      const next = await s.as(s.neutral).list({ pageSize: 1, page: 2 });
      expect(next.body.data.map((r: { id: string }) => r.id)).toEqual([s.reportId]);
      expect((await s.as(s.neutral).list({ status: "DISMISSED" })).body.data.map((r: { id: string }) => r.id)).toEqual([second]);
      expect((await s.as(s.neutral).list({ status: "NONSENSE" })).status).toBe(400);
      expect((await s.as(s.neutral).dashboard()).body.data.openChatReports).toBe(2);
    });

    it("reports a deleted member as null, in the queue and the view", async () => {
      const s = await scenario();
      expect((await api().post("/api/v1/me/delete").set(s.reported.headers).send({ confirm: true })).status).toBeLessThan(300);
      const list = await s.as(s.neutral).list();
      expect(list.body.data[0]).toMatchObject({ id: s.reportId, reported: null, reporter: expect.objectContaining({ fullName: "Reporter Rao" }) });
      const view = (await s.as(s.neutral).view(s.reportId)).body.data as AdminChatReportViewDto;
      expect(view.reported).toBeNull();
      const target = view.messages.find((m) => m.isTarget)!;
      expect(target).toMatchObject({ body: SECRET, sender: null });
    });

    it("is refused to anyone who isn't an admin", async () => {
      const s = await scenario();
      for (const res of [await s.as(s.reporter).list(), await s.as(s.reporter).view(s.reportId), await s.as(s.reporter).resolve(s.reportId), await s.as(s.reporter).dismiss(s.reportId)]) expect(res.status).toBe(403);
    });
  });

  describe("viewing a report", () => {
    it("returns the messages in order with the reported one marked, uncached, and writes one audit row per view", async () => {
      const s = await scenario();
      const first = await s.as(s.neutral).view(s.reportId);
      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-store");
      const view = first.body.data as AdminChatReportViewDto;
      expect(view).toMatchObject({ id: s.reportId, details: DETAILS, noteSnapshot: null, resolutionNote: null });
      expect(view.messages.map((m) => [m.body, m.isTarget, m.removed])).toEqual([
        ["Hello there", false, false],
        [SECRET, true, false],
      ]);
      expect(view.messages.map((m) => m.sender?.fullName)).toEqual(["Reporter Rao", "Reported Roy"]);
      // Nothing about the row beyond what's shown. A seq would give away the thread's length, and its gaps what was withheld.
      expect(Object.keys(view.messages[0]!).sort()).toEqual(["body", "createdAt", "id", "isTarget", "kind", "removed", "sender"]);

      await s.as(s.neutral).view(s.reportId);
      const rows = await auditRows(s.tenant.id, "chat_report.view");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ actorUserId: s.neutral.user.id, actorMembershipId: s.neutral.membership.id, targetType: "chat_report", targetId: s.reportId });
      expect(rows[0]!.metadata).toEqual({ access: "tenant_admin", targetKind: "MESSAGE", conversationId: s.conversationId, messageIds: view.messages.map((m) => m.id), messageCount: 2 });
      expectNoWords(rows, SECRET, DETAILS);
    });

    it("fails closed: if the audit row can't be written, the answer is an error with no text, and nothing is logged of it", async () => {
      const s = await scenario();
      const { logger, text } = capturingLogger();
      const app = createApp({ ...ctx, logger });
      await refusingAudit("chat_report.view", async () => {
        const res = await request(app).post(`/api/v1/t/${s.tenant.slug}/admin/chat-reports/${s.reportId}/view`).set(s.neutral.headers).send();
        expect(res.status).toBe(500);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.body.error).toEqual({ code: "INTERNAL", message: "Something went wrong" });
        expectNoWords(res.body, SECRET, DETAILS);
      });
      expect(await auditRows(s.tenant.id, "chat_report.view")).toEqual([]);
      const logged = text();
      expect(logged).toContain("Unhandled error");
      expect(logged).not.toContain(SECRET);
      expect(logged).not.toContain(DETAILS);
      // The same admin gets it once the audit log works again.
      expect((await s.as(s.neutral).view(s.reportId)).status).toBe(200);
    });

    describe("chatReportContext", () => {
      async function longThread() {
        const s = await scenario();
        const chat = chatApi(ctx, s.tenant.slug, s.reported);
        const ids = [(await chat.send(s.conversationId, "One")).body.data.id as string, (await chat.send(s.conversationId, "Two")).body.data.id as string, (await chat.send(s.conversationId, "Three")).body.data.id as string];
        return { ...s, ids, chat };
      }
      const bodiesFor = async (id: string) => (await chatReportContext(ctx.db, await reportRow(id))).map((r) => r.message.body);

      it("reads only the frozen ids, whatever else the thread holds", async () => {
        const s = await longThread();
        // These came after it was filed, so they were never frozen.
        expect(await bodiesFor(s.reportId)).toEqual(["Hello there", SECRET]);
        // Sitting between two frozen ids isn't enough to be shown either, which a range of seq would get wrong.
        await ctx.db.update(chatReports).set({ contextMessageIds: [s.messageId, s.ids[1]!] }).where(eq(chatReports.id, s.reportId));
        expect(await bodiesFor(s.reportId)).toEqual([SECRET, "Two"]);
      });

      it("always includes the target, and skips anything else removed", async () => {
        const s = await longThread();
        await ctx.db.update(chatReports).set({ contextMessageIds: [s.ids[0]!, s.messageId, s.ids[1]!] }).where(eq(chatReports.id, s.reportId));
        await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, s.ids[0]!));
        expect(await bodiesFor(s.reportId)).toEqual([SECRET, "Two"]);

        // A removed target stays readable here, and the target needn't be in the list to be read.
        await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, s.messageId));
        await ctx.db.update(chatReports).set({ contextMessageIds: [s.ids[1]!] }).where(eq(chatReports.id, s.reportId));
        expect(await bodiesFor(s.reportId)).toEqual([SECRET, "Two"]);
      });

      it("stays inside the institution and never shows a withheld message, even if its id is on the list", async () => {
        const s = await longThread();
        const other = await scenario();
        await ctx.db.update(chatMessages).set({ withheld: true }).where(eq(chatMessages.id, s.ids[0]!));
        await ctx.db.update(chatReports).set({ contextMessageIds: [other.messageId, s.ids[0]!, s.messageId] }).where(eq(chatReports.id, s.reportId));
        expect(await bodiesFor(s.reportId)).toEqual([SECRET]);
      });
    });

    it("is limited to 120 an hour per user, and the limit leaves the other actions alone", async () => {
      const s = await scenario();
      const other = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN" });
      await ctx.redis.set(keys.rateLimit("chat-report-view", s.neutral.user.id), "119", "EX", 3600);
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        expect((await s.as(s.neutral).view(s.reportId)).status).toBe(200);
        const over = await s.as(s.neutral).view(s.reportId);
        expect(over.status).toBe(429);
        expect(over.body.error.code).toBe("RATE_LIMITED");
        expectNoWords(over.body, SECRET);
        expect(await auditRows(s.tenant.id, "chat_report.view")).toHaveLength(1);
        expect((await s.as(other).view(s.reportId)).status).toBe(200);
        expect((await s.as(s.neutral).resolve(s.reportId)).status).toBe(200);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });
  });

  describe("an admin the report names", () => {
    const named = () => scenario({ reporter: { role: "TENANT_ADMIN" }, reported: { role: "TENANT_ADMIN" } });

    it.each(["reporter", "reported"] as const)("as its %s, finds it doesn't exist: 404 on every action, the same as a made-up id", async (who) => {
      const s = await named();
      const admin = s.as(s[who]);
      const madeUp = randomUUID();
      for (const [got, nothing] of [
        [await admin.view(s.reportId), await admin.view(madeUp)],
        [await admin.resolve(s.reportId), await admin.resolve(madeUp)],
        [await admin.dismiss(s.reportId), await admin.dismiss(madeUp)],
      ]) {
        expect(got!.status).toBe(404);
        expect(got!.body).toEqual(nothing!.body);
      }
      expect((await reportRow(s.reportId)).status).toBe("OPEN");
      expect(await auditRows(s.tenant.id, "chat_report.view")).toEqual([]);
    });

    it.each(["reporter", "reported"] as const)("as its %s, sees nothing of it in the list, the tile or the counts", async (who) => {
      const s = await named();
      const admin = s.as(s[who]);
      expect((await admin.list()).body).toMatchObject({ data: [], total: 0 });
      expect((await admin.dashboard()).body.data.openChatReports).toBe(0);
      expect((await s.as(s.neutral).list()).body.total).toBe(1);
      expect((await s.as(s.neutral).dashboard()).body.data.openChatReports).toBe(1);
    });

    it("loses nothing else: they still see a report that doesn't name them", async () => {
      const s = await named();
      const other = await memberSession(ctx, s.tenant.id, { fullName: "Other Member" });
      const id = await acceptedThread(ctx, s.tenant.slug, other, s.neutral);
      const { body } = await chatApi(ctx, s.tenant.slug, other).send(id, "Someone else's report");
      const filed = await chatApi(ctx, s.tenant.slug, s.neutral).report(body.data.id);
      expect((await s.as(s.reporter).list()).body.data.map((r: { id: string }) => r.id)).toEqual([filed.body.data.id]);
      expect((await s.as(s.reported).view(filed.body.data.id)).status).toBe(200);
    });

    describe("and the audit log", () => {
      /** Everything that can be written about a report, and three plain rows older than all of it. */
      async function audited() {
        const s = await named();
        await ctx.db.insert(auditLog).values([1, 2, 3].map((i) => ({ tenantId: s.tenant.id, action: "test.plain", createdAt: new Date(Date.now() - 60_000 - i) })));
        await s.as(s.neutral).view(s.reportId);
        await s.as(s.neutral).dismiss(s.reportId);
        return s;
      }
      const actions = (res: { body: { data: AuditDto[] } }) => res.body.data.map((a) => a.action);

      it("hides its rows from an admin it names on /admin/audit, in SQL, so pages stay full and totals right", async () => {
        const s = await audited();
        const everything = await s.as(s.neutral).audit({ pageSize: 50 });
        expect(actions(everything).filter((a) => a.startsWith("chat_report.")).sort()).toEqual(["chat_report.dismiss", "chat_report.file", "chat_report.view"]);
        expect(everything.body.total).toBe(6);

        for (const who of [s.reporter, s.reported]) {
          const firstPage = await s.as(who).audit({ pageSize: 2 });
          expect(actions(firstPage)).toEqual(["test.plain", "test.plain"]);
          expect(firstPage.body.total).toBe(3);
          expect(actions(await s.as(who).audit({ pageSize: 2, page: 2 }))).toEqual(["test.plain"]);
          expect((await s.as(who).audit({ action: "chat_report." })).body).toMatchObject({ data: [], total: 0 });
        }
      });

      it("hides them on the member page, which lists rows by actor", async () => {
        const s = await audited();
        const page = (who: Headers) => s.as(who).member(s.neutral.membership.id);
        expect(((await page(s.neutral)).body.data.audit as AuditDto[]).map((a) => a.action).sort()).toEqual(["chat_report.dismiss", "chat_report.view"]);
        expect((await page(s.reporter)).body.data.audit).toEqual([]);
        expect((await page(s.reported)).body.data.audit).toEqual([]);
      });

      it("hides them from staff the report names on /platform/audit, and shows other staff everything", async () => {
        const { tenant } = await createTenant(ctx);
        const namedStaff = await staffMember(tenant.id, { fullName: "Staff Reporter" });
        const reported = await memberSession(ctx, tenant.id);
        const neutral = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const id = await acceptedThread(ctx, tenant.slug, namedStaff, reported);
        const { body } = await chatApi(ctx, tenant.slug, reported).send(id, SECRET);
        const filed = await chatApi(ctx, tenant.slug, namedStaff).report(body.data.id);
        expect(filed.status).toBe(201);
        await adminOf(tenant.slug, neutral).view(filed.body.data.id);

        const query = { tenantId: tenant.id, action: "chat_report." };
        expect((await platformAudit(staff, query)).body.total).toBe(2);
        expect((await platformAudit(namedStaff, query)).body).toMatchObject({ data: [], total: 0 });
        expect((await adminOf(tenant.slug, namedStaff).audit({ action: "chat_report." })).body.total).toBe(0);
      });

      it("never names the reporter as an actor, and carries no words anyone wrote", async () => {
        const s = await scenario();
        await s.as(s.neutral).view(s.reportId);
        await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });
        const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.tenantId, s.tenant.id));
        expect(rows.map((r) => r.action).sort()).toEqual(["chat_report.file", "chat_report.resolve", "chat_report.view"]);
        for (const row of rows) {
          expect(row.actorUserId).not.toBe(s.reporter.user.id);
          expect(row.actorMembershipId).not.toBe(s.reporter.membership.id);
        }
        expectNoWords(rows, SECRET, DETAILS, NOTE, s.reporter.membership.id);
      });
    });
  });

  describe("Illuminize staff", () => {
    it("get 403 on a report the institution's admins can handle, and don't see it listed", async () => {
      const s = await scenario();
      const as = s.as(staff);
      expect((await as.view(s.reportId)).status).toBe(403);
      expect((await as.resolve(s.reportId)).status).toBe(403);
      expect((await as.dismiss(s.reportId)).status).toBe(403);
      expect((await as.list()).body).toMatchObject({ data: [], total: 0 });
      expect((await as.dashboard()).body.data.openChatReports).toBe(0);
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).not.toContain(s.reportId);
      expect(await auditRows(s.tenant.id, "chat_report.view")).toEqual([]);
    });

    it("reach a report about an admin, with their view on record and no membership on the row", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const as = s.as(staff);
      expect((await as.list()).body.data.map((r: { id: string }) => r.id)).toEqual([s.reportId]);
      expect((await as.dashboard()).body.data.openChatReports).toBe(1);
      const view = await as.view(s.reportId);
      expect(view.status).toBe(200);
      expect(view.body.data.messages.find((m: { isTarget: boolean }) => m.isTarget).body).toBe(SECRET);
      const [row] = await auditRows(s.tenant.id, "chat_report.view");
      expect(row).toMatchObject({ actorUserId: staff.userId, actorMembershipId: null });
      expect(row!.metadata).toMatchObject({ access: "staff_reported_admin" });
      // A tenant admin can see that staff looked.
      expect((await s.as(s.neutral).audit({ action: "chat_report.view" })).body.total).toBe(1);
      expect((await as.resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE })).status).toBe(200);
      expect((await messageRow(s.messageId)).removedByUserId).toBe(staff.userId);
    });

    it("reach a report with no eligible admin, which follows who's an admin at the moment of asking", async () => {
      // The only admin filed it, so nobody else can handle it.
      const s = await scenario({ reporter: { role: "TENANT_ADMIN" }, noNeutralAdmin: true });
      const as = s.as(staff);
      expect((await as.list()).body.total).toBe(1);
      expect((await as.view(s.reportId)).status).toBe(200);
      expect((await auditRows(s.tenant.id, "chat_report.view"))[0]!.metadata).toMatchObject({ access: "staff_no_eligible_admin" });
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).toContain(s.reportId);

      // A suspended admin can't handle it either.
      const later = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN", status: "SUSPENDED" });
      expect((await as.view(s.reportId)).status).toBe(200);

      // Reinstated, they can, so staff no longer reach it.
      await ctx.db.update(memberships).set({ status: "APPROVED" }).where(eq(memberships.id, later.membership.id));
      expect((await as.view(s.reportId)).status).toBe(403);
      expect((await as.list()).body.total).toBe(0);
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).not.toContain(s.reportId);
      expect((await s.as(later).view(s.reportId)).status).toBe(200);
    });

    it("reach a report in an institution with no admin at all, or whose only other admin was reported", async () => {
      const none = await scenario({ noNeutralAdmin: true });
      expect((await none.as(staff).view(none.reportId)).status).toBe(200);
      const onlyReported = await scenario({ reported: { role: "TENANT_ADMIN" }, noNeutralAdmin: true });
      expect((await onlyReported.as(staff).view(onlyReported.reportId)).status).toBe(200);
    });

    it("don't get a report just because its reporter is an admin, if another admin can handle it", async () => {
      const s = await scenario({ reporter: { role: "TENANT_ADMIN" } });
      expect((await s.as(staff).view(s.reportId)).status).toBe(403);
      expect((await s.as(s.neutral).view(s.reportId)).status).toBe(200);
    });

    it("don't get a report about an admin who has since been suspended, if another admin can handle it", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);
      await ctx.db.update(memberships).set({ status: "SUSPENDED" }).where(eq(memberships.id, s.reported.membership.id));
      expect((await s.as(staff).view(s.reportId)).status).toBe(403);
      expect((await s.as(staff).list()).body.total).toBe(0);
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).not.toContain(s.reportId);
      expect((await s.as(s.neutral).view(s.reportId)).status).toBe(200);
    });

    it.each([
      ["a plain membership", {}],
      ["a suspended admin membership", { role: "TENANT_ADMIN", status: "SUSPENDED" }],
      ["an admin membership", { role: "TENANT_ADMIN" }],
    ] as Array<[string, MemberOptions]>)("stay held to what's escalated when they hold %s the report doesn't name", async (_, membership) => {
      const s = await scenario();
      const as = s.as(await staffMember(s.tenant.id, membership));
      expect((await as.view(s.reportId)).status).toBe(403);
      expect((await as.resolve(s.reportId)).status).toBe(403);
      expect((await as.dismiss(s.reportId)).status).toBe(403);
      expect((await as.list()).body).toMatchObject({ data: [], total: 0 });
      expect((await as.dashboard()).body.data.openChatReports).toBe(0);
      expect(await auditRows(s.tenant.id, "chat_report.view")).toEqual([]);
      expect((await reportRow(s.reportId)).status).toBe("OPEN");
    });

    it("can't read a report by making themselves an admin of the institution", async () => {
      const s = await scenario();
      expect((await s.as(staff).view(s.reportId)).status).toBe(403);
      const assigned = await api().post(`/api/v1/platform/tenants/${s.tenant.id}/admins`).set(staff.headers).send({ phone: "+919999999999", fullName: "Illuminize Staff" });
      expect(assigned.status).toBe(201);
      expect((await s.as(staff).view(s.reportId)).status).toBe(403);
      expect((await s.as(staff).list()).body.total).toBe(0);
      expect((await s.as(staff).dashboard()).body.data.openChatReports).toBe(0);
    });

    it("all reach a report when the only other admin is staff, which would otherwise reach nobody, until the institution has an admin of its own", async () => {
      const s = await scenario({ noNeutralAdmin: true });
      const staffAdmin = await staffMember(s.tenant.id, { role: "TENANT_ADMIN" });
      expect((await s.as(staffAdmin).view(s.reportId)).status).toBe(200);
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);
      expect((await auditRows(s.tenant.id, "chat_report.view"))[0]!.metadata).toMatchObject({ access: "staff_no_eligible_admin" });
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).toContain(s.reportId);

      const ownAdmin = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN" });
      expect((await s.as(staffAdmin).view(s.reportId)).status).toBe(403);
      expect((await s.as(staff).view(s.reportId)).status).toBe(403);
      expect((await s.as(ownAdmin).view(s.reportId)).status).toBe(200);
    });

    it("get a metadata-only list across institutions, with the slug to find each by", async () => {
      const a = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const b = await scenario({ noNeutralAdmin: true });
      const res = await platformList(staff, { pageSize: 100 });
      expect(res.status).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const rows = res.body.data as Array<{ id: string; tenant: { slug: string } }>;
      expect(rows.find((r) => r.id === a.reportId)).toMatchObject({ reason: "HARASSMENT", status: "OPEN", targetKind: "MESSAGE", tenant: { slug: a.tenant.slug, name: a.tenant.name } });
      expect(rows.find((r) => r.id === b.reportId)!.tenant.slug).toBe(b.tenant.slug);
      expectNoWords(res.body, SECRET, DETAILS, "Hello there");
      expect(await auditRows(a.tenant.id, "chat_report.view")).toEqual([]);
      // Closed reports move to their own tab, and only staff get this list at all.
      await a.as(staff).dismiss(a.reportId, { note: NOTE });
      const dismissed = await platformList(staff, { status: "DISMISSED", pageSize: 100 });
      expect(dismissed.body.data.map((r: { id: string }) => r.id)).toContain(a.reportId);
      expectNoWords(dismissed.body, NOTE);
      expect((await platformList(a.neutral)).status).toBe(403);
    });

    it("count what's open in the list's total, which a page of one row reads, and say why each is theirs as things stand", async () => {
      const openCount = async () => {
        const res = await platformList(staff, { status: "OPEN", page: 1, pageSize: 1 });
        expect(res.body.data.length).toBeLessThanOrEqual(1);
        return res.body.total as number;
      };
      const basisOf = async (id: string) => ((await platformList(staff, { pageSize: 100 })).body.data as Array<{ id: string; basis: string }>).find((r) => r.id === id)?.basis;
      const before = await openCount();
      const aboutAdmin = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const noOther = await scenario({ noNeutralAdmin: true });
      const both = await scenario({ reported: { role: "TENANT_ADMIN" }, noNeutralAdmin: true });
      await scenario();
      expect(await openCount()).toBe(before + 3);
      expect(await basisOf(aboutAdmin.reportId)).toBe("REPORTED_ADMIN");
      expect(await basisOf(noOther.reportId)).toBe("NO_ELIGIBLE_ADMIN");
      // About an admin, and with no other: the admin it's about is the reason given.
      expect(await basisOf(both.reportId)).toBe("REPORTED_ADMIN");
      // No longer an admin, but with nobody else to handle it, it stays staff's for the other reason.
      await ctx.db.update(memberships).set({ role: "MEMBER" }).where(eq(memberships.id, both.reported.membership.id));
      expect(await basisOf(both.reportId)).toBe("NO_ELIGIBLE_ADMIN");
      expect((await noOther.as(staff).dismiss(noOther.reportId)).status).toBe(200);
      expect(await openCount()).toBe(before + 2);
    });

    it("are excluded like anyone else when they hold a membership the report names", async () => {
      const { tenant } = await createTenant(ctx);
      const session = await staffMember(tenant.id, { fullName: "Staff Reported" });
      const reporter = await memberSession(ctx, tenant.id);
      // Escalated, since the institution has no admin, so only the naming can keep them out.
      const id = await acceptedThread(ctx, tenant.slug, reporter, session);
      const { body } = await chatApi(ctx, tenant.slug, session).send(id, SECRET);
      const filed = await chatApi(ctx, tenant.slug, reporter).report(body.data.id);
      const reportId = filed.body.data.id as string;

      const as = adminOf(tenant.slug, session);
      expect((await as.view(reportId)).status).toBe(404);
      expect((await as.resolve(reportId)).status).toBe(404);
      expect((await as.dismiss(reportId)).status).toBe(404);
      expect((await as.list()).body.total).toBe(0);
      expect((await as.dashboard()).body.data.openChatReports).toBe(0);
      expect((await platformList(session, { pageSize: 100 })).body.data.map((r: { id: string }) => r.id)).not.toContain(reportId);
      // Other staff do reach it.
      expect((await adminOf(tenant.slug, staff).view(reportId)).status).toBe(200);
    });
  });

  describe("a member of staff who changed the institution's admins after a report was filed", () => {
    type Scenario = Awaited<ReturnType<typeof scenario>>;
    /** A second member of staff, with no membership anywhere. */
    async function otherStaff() {
      const user = await createUser(ctx, { isPlatformAdmin: true });
      return { headers: auth((await loginAs(ctx, user.phoneE164)).accessToken) };
    }
    const platformRow = async (who: Headers, id: string, status = "OPEN") => ((await platformList(who, { status, pageSize: 100 })).body.data as Array<{ id: string; needsOtherStaff: boolean }>).find((r) => r.id === id);
    const removeAdmin = (s: Scenario, membershipId: string) => api().delete(`/api/v1/platform/tenants/${s.tenant.id}/admins/${membershipId}`).set(staff.headers);
    const assignAdmin = async (s: Scenario, phone?: string) => api().post(`/api/v1/platform/tenants/${s.tenant.id}/admins`).set(staff.headers).send({ phone: phone ?? (await createUser(ctx)).phoneE164, fullName: "Added Admin" });
    const setStaffFlag = (userId: string, enabled: boolean) => api().post(`/api/v1/platform/users/${userId}/platform-admin`).set(staff.headers).send({ enabled });
    /** An admin the apps never leave waiting, which only data from elsewhere could hold. */
    const waitingAdmin = (s: Scenario) => bareMember(ctx, s.tenant.id, { role: "TENANT_ADMIN", status: "PENDING" });

    it.each([
      ["remove its only other admin", {}, (s) => removeAdmin(s, s.neutral.membership.id)],
      ["take that admin's role in its console", {}, (s) => s.as(staff).setRole(s.neutral.membership.id, "MEMBER")],
      ["suspend that admin", {}, (s) => s.as(staff).suspend(s.neutral.membership.id)],
      ["give that admin the staff flag, so they don't count as one", {}, (s) => setStaffFlag(s.neutral.user.id, true)],
      ["add an admin while it's about one", { role: "TENANT_ADMIN" }, (s) => assignAdmin(s)],
      ["make the member it's about an admin", {}, (s) => assignAdmin(s, s.reported.user.phoneE164)],
      ["give the member it's about the admin role in its console", {}, (s) => s.as(staff).setRole(s.reported.membership.id, "TENANT_ADMIN")],
      [
        "reinstate the admin it's about, whom another admin suspended",
        { role: "TENANT_ADMIN" },
        async (s) => {
          expect((await s.as(s.neutral).suspend(s.reported.membership.id)).status).toBe(200);
          return s.as(staff).reinstate(s.reported.membership.id);
        },
      ],
      ["approve an admin left waiting", { role: "TENANT_ADMIN" }, async (s) => s.as(staff).approve((await waitingAdmin(s)).id)],
      [
        "approve everyone waiting, an admin among them",
        { role: "TENANT_ADMIN" },
        async (s) => {
          await waitingAdmin(s);
          return api().post(`/api/v1/t/${s.tenant.slug}/admin/members/approve-all-pending`).set(staff.headers).send();
        },
      ],
      ["take the staff flag from one of its admins while it's about another", { role: "TENANT_ADMIN" }, async (s) => setStaffFlag((await staffMember(s.tenant.id, { role: "TENANT_ADMIN" })).user.id, false)],
    ] as Array<[string, MemberOptions, (s: Scenario) => Promise<{ status: number }>]>)("can't view, resolve or dismiss it when they %s, and another member of staff can", async (_, reported, change) => {
      const s = await scenario({ reported });
      expect((await change(s)).status).toBeLessThan(300);
      const as = s.as(staff);
      for (const res of [await as.view(s.reportId), await as.resolve(s.reportId, { action: "REMOVE_MESSAGE" }), await as.dismiss(s.reportId)]) {
        expect(res.status).toBe(403);
        expect(res.body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF", message: NEEDS_OTHER_STAFF_TEXT });
      }
      expectNoWords((await as.view(s.reportId)).body, SECRET, DETAILS);
      expect(await auditRows(s.tenant.id, "chat_report.view")).toEqual([]);
      expect(await reportRow(s.reportId)).toMatchObject({ status: "OPEN", resolvedByUserId: null });
      expect((await messageRow(s.messageId)).removedAt).toBeNull();
      // Still listed for them, with the note in place of a way in.
      expect(await platformRow(staff, s.reportId)).toMatchObject({ needsOtherStaff: true });

      const other = await otherStaff();
      expect(await platformRow(other, s.reportId)).toMatchObject({ needsOtherStaff: false });
      expect((await s.as(other).view(s.reportId)).status).toBe(200);
      expect((await s.as(other).dismiss(s.reportId)).status).toBe(200);
      // Closed, it still isn't theirs to read, which the console's closed tab shows too.
      expect((await as.view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
      expect(await platformRow(staff, s.reportId, "DISMISSED")).toMatchObject({ needsOtherStaff: true });
    });

    it.each([
      ["suspend the admin it's about", (s) => s.as(staff).suspend(s.reported.membership.id)],
      ["take that admin's role in its console", (s) => s.as(staff).setRole(s.reported.membership.id, "MEMBER")],
      ["remove that admin", (s) => removeAdmin(s, s.reported.membership.id)],
      ["suspend its reporter, an admin", (s) => s.as(staff).suspend(s.reporter.membership.id)],
      ["give its reporter, an admin, the staff flag", (s) => setStaffFlag(s.reporter.user.id, true)],
    ] as Array<[string, (s: Scenario) => Promise<{ status: number }>]>)("can still close it when they %s, which can't have made it theirs", async (_, change) => {
      // About its only other admin, so it's staff's for both reasons and stays theirs whatever happens to either party.
      const s = await scenario({ reporter: { role: "TENANT_ADMIN" }, reported: { role: "TENANT_ADMIN" }, noNeutralAdmin: true });
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);
      expect((await change(s)).status).toBeLessThan(300);
      expect(await platformRow(staff, s.reportId)).toMatchObject({ needsOtherStaff: false });
      expect((await s.as(staff).resolve(s.reportId, { action: "REMOVE_MESSAGE" })).status).toBe(200);
      expect((await reportRow(s.reportId)).status).toBe("RESOLVED");
    });

    it("leaves open, for another member of staff, a report on a message they remove that they changed the admins since", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      expect((await assignAdmin(s)).status).toBeLessThan(300);
      // That report was filed ten minutes ago and their change came five minutes ago; someone else reports the message now.
      const now = Date.now();
      await ctx.db.update(chatReports).set({ createdAt: new Date(now - 600_000) }).where(eq(chatReports.id, s.reportId));
      await ctx.db.update(auditLog).set({ createdAt: new Date(now - 300_000) }).where(and(eq(auditLog.tenantId, s.tenant.id), eq(auditLog.action, "platform.tenant.admin.assign")));
      const [later] = await ctx.db
        .insert(chatReports)
        .values({ tenantId: s.tenant.id, targetKind: "MESSAGE", targetId: s.messageId, conversationId: s.conversationId, reporterMembershipId: (await bareMember(ctx, s.tenant.id)).id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", contextMessageIds: [s.messageId] })
        .returning();
      expect((await s.as(staff).view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });

      expect((await s.as(staff).resolve(later!.id, { action: "REMOVE_MESSAGE" })).status).toBe(200);
      expect((await messageRow(s.messageId)).removedAt).toBeInstanceOf(Date);
      expect(await reportRow(s.reportId)).toMatchObject({ status: "OPEN", resolvedByUserId: null });
      expect((await auditRows(s.tenant.id, "chat_report.resolve")).map((r) => r.targetId)).toEqual([later!.id]);
      // The message is gone, so whoever takes it has only to close it.
      const other = await otherStaff();
      expect((await s.as(other).resolve(s.reportId, { action: "REMOVE_MESSAGE" })).status).toBe(200);
      expect(await reportRow(s.reportId)).toMatchObject({ status: "RESOLVED", resolutionAction: "REMOVE_MESSAGE" });
    });

    it("counts a change stamped up to a minute before the report, which an overlapping transaction can be, and not one before that", async () => {
      const s = await scenario();
      expect((await removeAdmin(s, s.neutral.membership.id)).status).toBe(204);
      const [change] = await auditRows(s.tenant.id, "platform.tenant.admin.remove");
      const filedAt = (await reportRow(s.reportId)).createdAt.getTime();
      const stamp = (offsetMs: number) => ctx.db.update(auditLog).set({ createdAt: new Date(filedAt + offsetMs) }).where(eq(auditLog.id, change!.id));
      // Begun before the report was filed and committed after it: still counts.
      await stamp(-50_000);
      expect((await s.as(staff).view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
      // Made before the report, beyond any transaction that could have overlapped it.
      await stamp(-70_000);
      expect(await platformRow(staff, s.reportId)).toMatchObject({ needsOtherStaff: false });
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);
    });

    it("counts only their own changes to this institution's admins", async () => {
      // Escalated as no admin is left, so only the rule could keep staff out.
      const s = await scenario({ noNeutralAdmin: true });
      // A plain member suspended and reinstated, or given the staff flag and back, isn't a change of admins.
      expect((await s.as(staff).suspend(s.reported.membership.id)).status).toBe(200);
      expect((await s.as(staff).reinstate(s.reported.membership.id)).status).toBe(200);
      expect((await setStaffFlag(s.reported.user.id, true)).status).toBe(200);
      expect((await setStaffFlag(s.reported.user.id, false)).status).toBe(200);
      // Nor is one at another institution.
      const elsewhere = await scenario();
      expect((await removeAdmin(elsewhere, elsewhere.neutral.membership.id)).status).toBe(204);
      expect(await platformRow(staff, s.reportId)).toMatchObject({ needsOtherStaff: false });
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);

      // An institution's own admin escalating a report holds back no member of staff.
      const t = await scenario({ reporter: { role: "TENANT_ADMIN" } });
      expect((await t.as(t.reporter).suspend(t.neutral.membership.id)).status).toBe(200);
      expect((await t.as(staff).view(t.reportId)).status).toBe(200);
    });

    it("judges an admin by the role they held at the change, so a later change to them doesn't let staff back in", async () => {
      const suspended = await scenario();
      expect((await suspended.as(staff).suspend(suspended.neutral.membership.id)).status).toBe(200);
      const flagged = await scenario();
      expect((await setStaffFlag(flagged.neutral.user.id, true)).status).toBe(200);
      for (const s of [suspended, flagged]) {
        // No longer an admin there by now, which the report stays staff's without.
        await ctx.db.update(memberships).set({ role: "MEMBER" }).where(eq(memberships.id, s.neutral.membership.id));
        expect((await s.as(staff).view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
      }
    });

    it("doesn't count a change to someone who wasn't an admin then, though they are now, and reads an older row by the role now", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const plain = await bareMember(ctx, s.tenant.id);
      expect((await s.as(staff).suspend(plain.id)).status).toBe(200);
      const flagged = await createUser(ctx);
      const flaggedMembership = await createMembership(ctx, s.tenant.id, flagged.id);
      expect((await setStaffFlag(flagged.id, true)).status).toBe(200);
      // Both made admins there since, by someone else.
      await ctx.db.update(memberships).set({ role: "TENANT_ADMIN" }).where(inArray(memberships.id, [plain.id, flaggedMembership.id]));
      expect(await platformRow(staff, s.reportId)).toMatchObject({ needsOtherStaff: false });
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);

      // Rows written before the role and adminOf were recorded go by the role now, one key missing at a time.
      const rewrite = async (action: string, metadata: Record<string, unknown>) => ctx.db.update(auditLog).set({ metadata }).where(and(eq(auditLog.action, action), eq(auditLog.targetId, action === "membership.suspend" ? plain.id : flagged.id)));
      await rewrite("platform.admin.grant", {});
      expect((await s.as(staff).view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
      await rewrite("platform.admin.grant", { adminOf: [] });
      await rewrite("membership.suspend", { from: "APPROVED", to: "SUSPENDED", reason: "Being tested" });
      expect((await s.as(staff).view(s.reportId)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
    });
  });

  describe("another institution", () => {
    it("answers 404 for its reports, to its own admin or staff, through the wrong slug", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const other = await createTenant(ctx);
      const otherAdmin = await memberSession(ctx, other.tenant.id, { role: "TENANT_ADMIN" });
      for (const as of [adminOf(other.tenant.slug, otherAdmin), adminOf(other.tenant.slug, staff)]) {
        expect((await as.view(s.reportId)).status).toBe(404);
        expect((await as.resolve(s.reportId)).status).toBe(404);
        expect((await as.dismiss(s.reportId)).status).toBe(404);
        expect((await as.list()).body.total).toBe(0);
      }
      expect((await reportRow(s.reportId)).status).toBe("OPEN");
    });
  });

  describe("resolving and dismissing", () => {
    it("resolves with no action, keeping the message and telling nobody", async () => {
      const s = await scenario();
      const res = await s.as(s.neutral).resolve(s.reportId, { action: "NONE", note: NOTE });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: s.reportId, status: "RESOLVED", resolutionAction: "NONE" });
      expectNoWords(res.body, NOTE, SECRET);
      expect(await reportRow(s.reportId)).toMatchObject({ status: "RESOLVED", resolutionAction: "NONE", resolvedByUserId: s.neutral.user.id, resolutionNote: NOTE });
      expect((await messageRow(s.messageId)).removedAt).toBeNull();
      expect(await removedNotices(s.tenant.id)).toEqual([]);
      expect(realtime.to(s.reported.user.id, "chat:removed")).toEqual([]);
      const [row] = await auditRows(s.tenant.id, "chat_report.resolve");
      expect(row).toMatchObject({ actorUserId: s.neutral.user.id, targetId: s.reportId });
      expect(row!.metadata).toEqual({ access: "tenant_admin", action: "NONE", targetKind: "MESSAGE", targetId: s.messageId });
    });

    it("dismisses, and a report already handled can't be handled again", async () => {
      const s = await scenario();
      const res = await s.as(s.neutral).dismiss(s.reportId, { note: NOTE });
      expect(res.status).toBe(200);
      expect(await reportRow(s.reportId)).toMatchObject({ status: "DISMISSED", resolutionAction: null, resolvedByUserId: s.neutral.user.id, resolutionNote: NOTE });
      expect(await auditRows(s.tenant.id, "chat_report.dismiss")).toHaveLength(1);
      expectNoWords(await auditRows(s.tenant.id, "chat_report.dismiss"), NOTE);
      for (const again of [await s.as(s.neutral).dismiss(s.reportId), await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE" })]) {
        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe("INVALID_TRANSITION");
      }
      expect((await messageRow(s.messageId)).removedAt).toBeNull();
    });

    it("stays open if the dismissal can't be recorded", async () => {
      const s = await scenario();
      await refusingAudit("chat_report.dismiss", async () => {
        const res = await s.as(s.neutral).dismiss(s.reportId, { note: NOTE });
        expect(res.status).toBe(500);
        expectNoWords(res.body, NOTE);
      });
      expect(await reportRow(s.reportId)).toMatchObject({ status: "OPEN", resolvedByUserId: null, resolvedAt: null, resolutionNote: null });
      expect(await auditRows(s.tenant.id, "chat_report.dismiss")).toEqual([]);
    });

    it("validates the action", async () => {
      const s = await scenario();
      expect((await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_AND_SUSPEND" })).status).toBe(400);
      expect((await s.as(s.neutral).resolve(s.reportId, { action: "NONE", note: "x".repeat(501) })).status).toBe(400);
      expect((await reportRow(s.reportId)).status).toBe("OPEN");
    });

    describe("removing the message", () => {
      it("tombstones it for the thread and tells the sender in fixed words, with the note in the app", async () => {
        const s = await scenario();
        // Forgets the message itself going out to the thread, which is the one time its words should travel.
        realtime.clear();
        const res = await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "RESOLVED", resolutionAction: "REMOVE_MESSAGE" });
        expect(await messageRow(s.messageId)).toMatchObject({ removedByUserId: s.neutral.user.id, removalNote: NOTE, body: SECRET, removedAt: expect.any(Date) });

        const expected = { tenantSlug: s.tenant.slug, conversationId: s.conversationId, messageId: s.messageId, seq: 2 };
        expect(realtime.to(s.reported.user.id, "chat:removed").map((e) => e.payload)).toEqual([expected]);
        expect(realtime.to(s.reporter.user.id, "chat:removed").map((e) => e.payload)).toEqual([expected]);
        expect(realtime.to(s.neutral.user.id, "chat:removed")).toEqual([]);

        const notices = await removedNotices(s.tenant.id);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ recipientMembershipId: s.reported.membership.id, title: "A message you sent was removed", body: NOTE, data: { conversationId: s.conversationId, messageId: s.messageId } });
        expectNoWords(notices, SECRET, DETAILS);

        await ctx.jobs.drain();
        expect(realtime.to(s.reported.user.id, "notification:new")).toHaveLength(1);
        expectNoWords([realtime.events, ctx.jobs.history], SECRET, DETAILS);

        const seen = await api().get(`/api/v1/t/${s.tenant.slug}/notifications`).set(s.reported.headers);
        expect(seen.body.data.find((n: { type: string }) => n.type === "CHAT_MESSAGE_REMOVED")).toMatchObject({ title: "A message you sent was removed", body: NOTE });
      });

      it("leaves the note out when there isn't one, rather than saying something empty", async () => {
        const s = await scenario();
        await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE" });
        expect((await removedNotices(s.tenant.id))[0]).toMatchObject({ body: null });
        expect(await messageRow(s.messageId)).toMatchObject({ removalNote: null });
      });

      it("shows members body: null in the thread, the list preview and the realtime echo, and the report's view can still read it", async () => {
        const s = await scenario();
        const clientKey = randomUUID();
        const later = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "A newer message", clientKey);
        await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });

        for (const member of [s.reported, s.reporter]) {
          const chat = chatApi(ctx, s.tenant.slug, member);
          const thread = (await chat.messages(s.conversationId)).body.data as ChatMessageDto[];
          expect(thread.find((m) => m.id === s.messageId)).toMatchObject({ body: null, removed: true, seq: 2 });
          expect(thread.find((m) => m.id === later.body.data.id)).toMatchObject({ body: "A newer message", removed: false });
          const after = (await chat.messages(s.conversationId, { afterSeq: 1 })).body.data as ChatMessageDto[];
          expect(after.find((m) => m.id === s.messageId)!.body).toBeNull();
          const everything = JSON.stringify([thread, after, (await chat.get(s.conversationId)).body, (await chat.list()).body, (await chat.badge()).body]);
          expect(everything).not.toContain(SECRET);
          expect(everything).not.toContain(NOTE);
          expect(everything).not.toContain(s.neutral.user.id);
          expect(everything).not.toMatch(/removalNote|removal_note|removedBy|removed_by/);
        }

        // The removed message is the newest either of them can see once the newer one is gone too.
        await ctx.db.update(chatMessages).set({ removedAt: new Date() }).where(eq(chatMessages.id, later.body.data.id));
        const preview = (await chatApi(ctx, s.tenant.slug, s.reported).get(s.conversationId)).body.data as ChatConversationDto;
        expect(preview.lastMessage).toMatchObject({ body: null, mine: true });
        expect(((await chatApi(ctx, s.tenant.slug, s.reported).list()).body.data as ChatConversationDto[])[0]!.lastMessage).toMatchObject({ body: null });

        // A retry of the send that made it answers with the tombstone, not the words.
        const retry = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "A newer message", clientKey);
        expect(retry.body.data).toMatchObject({ id: later.body.data.id, body: null, removed: true });

        const view = (await s.as(s.neutral).view(s.reportId)).body.data as AdminChatReportViewDto;
        expect(view.messages.find((m) => m.isTarget)).toMatchObject({ body: SECRET, removed: true });
      });

      it("resolves every other open report on the message, each with its own audit row, and leaves other messages' reports open", async () => {
        const s = await scenario();
        const third = await bareMember(ctx, s.tenant.id);
        const fourth = await bareMember(ctx, s.tenant.id);
        const sibling = (reporterMembershipId: string, status: "OPEN" | "DISMISSED") => ({ tenantId: s.tenant.id, targetKind: "MESSAGE" as const, targetId: s.messageId, conversationId: s.conversationId, reporterMembershipId, reportedMembershipId: s.reported.membership.id, reason: "SPAM" as const, status, contextMessageIds: [s.messageId] });
        const [open] = await ctx.db.insert(chatReports).values(sibling(third.id, "OPEN")).returning();
        const [dismissed] = await ctx.db.insert(chatReports).values(sibling(fourth.id, "DISMISSED")).returning();
        const { body } = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "A different message");
        const unrelated = await chatApi(ctx, s.tenant.slug, s.reporter).report(body.data.id);

        expect((await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE })).status).toBe(200);
        expect(await reportRow(open!.id)).toMatchObject({ status: "RESOLVED", resolutionAction: "REMOVE_MESSAGE", resolvedByUserId: s.neutral.user.id, resolutionNote: "auto: message removed" });
        expect((await reportRow(dismissed!.id)).status).toBe("DISMISSED");
        expect((await reportRow(unrelated.body.data.id)).status).toBe("OPEN");

        const rows = await auditRows(s.tenant.id, "chat_report.resolve");
        expect(rows.map((r) => r.targetId).sort()).toEqual([s.reportId, open!.id].sort());
        expect(rows.find((r) => r.targetId === open!.id)!.metadata).toMatchObject({ viaReportId: s.reportId });
        expect(await removedNotices(s.tenant.id)).toHaveLength(1);

        // The other report's view lists it too, as what it is: the one message that report is about.
        expect(((await s.as(s.neutral).view(open!.id)).body.data as AdminChatReportViewDto).messages.map((m) => m.body)).toEqual([SECRET]);
      });

      it("doesn't name the acting admin on the audit row of a report they filed themselves", async () => {
        const s = await scenario();
        // Direct, as only a group lets two members report one message. An admin isn't held back by a report of their own, and acts on the other.
        const [own] = await ctx.db.insert(chatReports).values({ tenantId: s.tenant.id, targetKind: "MESSAGE", targetId: s.messageId, conversationId: s.conversationId, reporterMembershipId: s.neutral.membership.id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", contextMessageIds: [s.messageId] }).returning();
        expect((await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE" })).status).toBe(200);
        expect((await reportRow(own!.id)).status).toBe("RESOLVED");

        const rows = await auditRows(s.tenant.id, "chat_report.resolve");
        expect(rows.find((r) => r.targetId === own!.id)).toMatchObject({ actorUserId: null, actorMembershipId: null, ip: null, metadata: expect.objectContaining({ viaReportId: s.reportId }) });
        expect(rows.find((r) => r.targetId === s.reportId)).toMatchObject({ actorUserId: s.neutral.user.id, actorMembershipId: s.neutral.membership.id });
      });

      it("doesn't let a removed message into another report's view unless it's that report's target", async () => {
        const s = await scenario();
        const { body } = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "Sent later, reported later");
        const later = await chatApi(ctx, s.tenant.slug, s.reporter).report(body.data.id);
        expect((await reportRow(later.body.data.id)).contextMessageIds).toContain(s.messageId);
        await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE" });
        const view = (await s.as(s.neutral).view(later.body.data.id)).body.data as AdminChatReportViewDto;
        expect(view.messages.map((m) => m.body)).toEqual(["Hello there", "Sent later, reported later"]);
      });

      it("skips the notification when the sender is gone", async () => {
        const s = await scenario();
        expect((await api().post("/api/v1/me/delete").set(s.reported.headers).send({ confirm: true })).status).toBeLessThan(300);
        const res = await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });
        expect(res.status).toBe(200);
        expect((await messageRow(s.messageId)).removedAt).toBeInstanceOf(Date);
        expect(await removedNotices(s.tenant.id)).toEqual([]);
        expect(realtime.to(s.reporter.user.id, "chat:removed")).toHaveLength(1);
      });

      it("changes nothing if the audit row can't be written", async () => {
        const s = await scenario();
        await refusingAudit("chat_report.resolve", async () => {
          const res = await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });
          expect(res.status).toBe(500);
          expectNoWords(res.body, SECRET, NOTE);
        });
        expect((await messageRow(s.messageId)).removedAt).toBeNull();
        expect((await reportRow(s.reportId)).status).toBe("OPEN");
        expect(await removedNotices(s.tenant.id)).toEqual([]);
        expect(realtime.to(s.reported.user.id, "chat:removed")).toEqual([]);
      });

      it("undoes the removal itself if a later audit row can't be written, leaving no notice, no event and every report open", async () => {
        const s = await scenario();
        const third = await bareMember(ctx, s.tenant.id);
        const [sibling] = await ctx.db.insert(chatReports).values({ tenantId: s.tenant.id, targetKind: "MESSAGE", targetId: s.messageId, conversationId: s.conversationId, reporterMembershipId: third.id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", contextMessageIds: [s.messageId] }).returning();
        realtime.clear();
        // Only the row for the other report, which is written after the message has been removed and the sender told.
        await refusingAuditWhere("not (metadata ? 'viaReportId')", async () => {
          const res = await s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE });
          expect(res.status).toBe(500);
          expectNoWords(res.body, SECRET, NOTE);
        });
        await ctx.jobs.drain();
        expect(await messageRow(s.messageId)).toMatchObject({ removedAt: null, removedByUserId: null, removalNote: null });
        expect((await reportRow(s.reportId)).status).toBe("OPEN");
        expect((await reportRow(sibling!.id)).status).toBe("OPEN");
        expect(await removedNotices(s.tenant.id)).toEqual([]);
        expect(await auditRows(s.tenant.id, "chat_report.resolve")).toEqual([]);
        expect(realtime.to(s.reported.user.id, "chat:removed")).toEqual([]);
        expect(realtime.to(s.reporter.user.id, "chat:removed")).toEqual([]);
      });

      describe("with two admins at once", () => {
        const statuses = (results: Array<{ status: number }>) => results.map((r) => r.status).sort();

        it("removes once and notifies once on one report", async () => {
          const s = await scenario();
          const second = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN" });
          const body = { action: "REMOVE_MESSAGE", note: NOTE };
          const results = await Promise.all([s.as(s.neutral).resolve(s.reportId, body), s.as(second).resolve(s.reportId, body)]);
          expect(statuses(results)).toEqual([200, 409]);
          expect(await removedNotices(s.tenant.id)).toHaveLength(1);
          expect(realtime.to(s.reported.user.id, "chat:removed")).toHaveLength(1);
          expect(await auditRows(s.tenant.id, "chat_report.resolve")).toHaveLength(1);
        });

        it("doesn't deadlock or notify twice closing two reports on one message", async () => {
          const s = await scenario();
          const second = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN" });
          const third = await bareMember(ctx, s.tenant.id);
          const [other] = await ctx.db.insert(chatReports).values({ tenantId: s.tenant.id, targetKind: "MESSAGE", targetId: s.messageId, conversationId: s.conversationId, reporterMembershipId: third.id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", contextMessageIds: [s.messageId] }).returning();
          const body = { action: "REMOVE_MESSAGE" };
          const results = await Promise.all([s.as(s.neutral).resolve(s.reportId, body), s.as(second).resolve(other!.id, body)]);
          expect(statuses(results)).toEqual([200, 409]);
          expect(await removedNotices(s.tenant.id)).toHaveLength(1);
          expect(realtime.to(s.reported.user.id, "chat:removed")).toHaveLength(1);
        });

        it("doesn't let a dismissal overlap a removal", async () => {
          const s = await scenario();
          const second = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN" });
          const results = await Promise.all([s.as(s.neutral).resolve(s.reportId, { action: "REMOVE_MESSAGE" }), s.as(second).dismiss(s.reportId)]);
          expect(statuses(results)).toEqual([200, 409]);
          const { status } = await reportRow(s.reportId);
          const removed = (await messageRow(s.messageId)).removedAt !== null;
          expect({ status, removed }).toEqual(removed ? { status: "RESOLVED", removed: true } : { status: "DISMISSED", removed: false });
        });
      });
    });

    describe.each(["MENTORSHIP_NOTE", "REFERRAL_NOTE"] as const)("on a %s", (targetKind) => {
      async function noteReport() {
        const s = await scenario();
        // Its target is a message here on purpose, so a slip that treats any target as a message would show up.
        const [row] = await ctx.db
          .insert(chatReports)
          .values({ tenantId: s.tenant.id, targetKind, targetId: s.messageId, conversationId: null, reporterMembershipId: s.reporter.membership.id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", noteSnapshot: "The request's own words", contextMessageIds: [s.messageId] })
          .returning();
        return { ...s, noteId: row!.id };
      }

      it("shows only the note, and on the record", async () => {
        const s = await noteReport();
        const view = (await s.as(s.neutral).view(s.noteId)).body.data as AdminChatReportViewDto;
        expect(view).toMatchObject({ targetKind, noteSnapshot: "The request's own words", messages: [] });
        expectNoWords(view, SECRET);
        const [row] = (await auditRows(s.tenant.id, "chat_report.view")).filter((r) => r.targetId === s.noteId);
        expect(row!.metadata).toEqual({ access: "tenant_admin", targetKind, conversationId: null, messageIds: [], messageCount: 0 });
        expectNoWords(row, "The request's own words");
      });

      it("refuses REMOVE_MESSAGE with a 400 and changes nothing, and can be resolved or dismissed", async () => {
        const s = await noteReport();
        const refused = await s.as(s.neutral).resolve(s.noteId, { action: "REMOVE_MESSAGE" });
        expect(refused.status).toBe(400);
        expect((await reportRow(s.noteId)).status).toBe("OPEN");
        expect((await messageRow(s.messageId)).removedAt).toBeNull();
        expect((await s.as(s.neutral).resolve(s.noteId, { action: "NONE" })).status).toBe(200);
        expect((await s.as(s.neutral).dismiss(s.reportId)).status).toBe(200);
      });

      it("keeps a note's words out of the queue", async () => {
        const s = await noteReport();
        const list = await s.as(s.neutral).list();
        expect(list.body.data.find((r: { id: string }) => r.id === s.noteId)).toMatchObject({ targetKind, reason: "SPAM" });
        expectNoWords(list.body, "The request's own words");
      });

      it("keeps a named admin out in the same way", async () => {
        const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
        const [row] = await ctx.db.insert(chatReports).values({ tenantId: s.tenant.id, targetKind, targetId: randomUUID(), conversationId: null, reporterMembershipId: s.reporter.membership.id, reportedMembershipId: s.reported.membership.id, reason: "SPAM", noteSnapshot: "The request's own words" }).returning();
        expect((await s.as(s.reported).view(row!.id)).status).toBe(404);
      });
    });
  });

  describe("an admin with an open report about them", () => {
    const REFUSAL = { code: "NEEDS_ANOTHER_ADMIN", message: "This needs another admin or Illuminize staff" };
    const refused = (res: { status: number; body: { error: Record<string, unknown> } }) => {
      expect(res.status).toBe(403);
      expect(res.body.error).toMatchObject(REFUSAL);
    };

    it("gets the same answer whichever member they target, so it can't point at the reporter, and nothing changes", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const bystander = await bareMember(ctx, s.tenant.id);
      const as = s.as(s.reported);
      const answers = [];
      for (const target of [s.reporter.membership.id, bystander.id, s.neutral.membership.id, s.reported.membership.id, randomUUID()]) {
        const suspend = await as.suspend(target);
        refused(suspend);
        answers.push(suspend.body);
        const role = await as.setRole(target, "TENANT_ADMIN");
        refused(role);
        answers.push(role.body);
      }
      for (const answer of answers) expect(answer).toEqual(answers[0]);
      const rows = await ctx.db.select().from(memberships).where(inArray(memberships.id, [s.reporter.membership.id, bystander.id]));
      expect(rows.map((r) => [r.status, r.role])).toEqual([
        ["APPROVED", "MEMBER"],
        ["APPROVED", "MEMBER"],
      ]);
      expect(await auditRows(s.tenant.id, "membership.suspend")).toEqual([]);
      expect(await auditRows(s.tenant.id, "membership.role_change")).toEqual([]);
    });

    it("leaves a record of each refused attempt, which other admins can see and which says nothing of any report", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      refused(await s.as(s.reported).suspend(s.reporter.membership.id));
      refused(await s.as(s.reported).setRole(s.reporter.membership.id, "MEMBER"));
      refused(await s.as(s.reported).profile(s.reporter.membership.id, { isPhoneVisible: true }));

      const rows = await auditRows(s.tenant.id, "membership.action_refused");
      expect(rows.map((r) => (r.metadata as { attempted: string }).attempted).sort()).toEqual(["membership.admin_profile_update", "membership.role_change", "membership.suspend"]);
      for (const row of rows) {
        expect(row).toMatchObject({ actorUserId: s.reported.user.id, actorMembershipId: s.reported.membership.id, targetType: "membership", targetId: s.reporter.membership.id });
        expectNoWords(row, s.reportId, s.messageId, "report");
      }
      expect((await s.as(s.neutral).audit({ action: "membership.action_refused" })).body.total).toBe(3);
    });

    it("can't restore a suspended admin, who could then close the report, while plain members go on as normal", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const suspendedAdmin = await memberSession(ctx, s.tenant.id, { role: "TENANT_ADMIN", status: "SUSPENDED" });
      const pendingAdmin = await bareMember(ctx, s.tenant.id, { role: "TENANT_ADMIN", status: "PENDING" });
      refused(await s.as(s.reported).reinstate(suspendedAdmin.membership.id));
      refused(await s.as(s.reported).approve(pendingAdmin.id));
      const rows = await ctx.db.select().from(memberships).where(inArray(memberships.id, [suspendedAdmin.membership.id, pendingAdmin.id]));
      expect(rows.map((r) => r.status).sort()).toEqual(["PENDING", "SUSPENDED"]);
      expect((await s.as(suspendedAdmin).view(s.reportId)).status).toBe(403);

      // Anyone neutral still can, and so can they once the report is closed.
      expect((await s.as(s.neutral).reinstate(suspendedAdmin.membership.id)).status).toBe(200);
      expect((await s.as(staff).approve(pendingAdmin.id)).status).toBe(200);
      const another = await bareMember(ctx, s.tenant.id, { role: "TENANT_ADMIN", status: "SUSPENDED" });
      expect((await s.as(s.neutral).dismiss(s.reportId)).status).toBe(200);
      expect((await s.as(s.reported).reinstate(another.id)).status).toBe(200);
    });

    it("can't edit anyone's profile, however small the edit, and can once the report closes", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const bystander = await bareMember(ctx, s.tenant.id);
      const as = s.as(s.reported);
      const answers = [];
      for (const [target, edit] of [
        [s.reporter.membership.id, { isPhoneVisible: true }],
        [s.reporter.membership.id, { dateOfBirth: "2014-01-01" }],
        [bystander.id, { city: "Pune" }],
        [bystander.id, {}],
        [randomUUID(), {}],
      ] as Array<[string, Record<string, unknown>]>) {
        const res = await as.profile(target, edit);
        refused(res);
        answers.push(res.body);
      }
      for (const answer of answers) expect(answer).toEqual(answers[0]);
      const [reporter] = await ctx.db.select().from(memberships).where(eq(memberships.id, s.reporter.membership.id));
      expect(reporter).toMatchObject({ isPhoneVisible: false, dateOfBirth: null });
      expect(await auditRows(s.tenant.id, "membership.admin_profile_update")).toEqual([]);

      expect((await s.as(s.neutral).profile(s.reporter.membership.id, { city: "Delhi" })).status).toBe(200);
      expect((await s.as(staff).profile(s.reporter.membership.id, { city: "Chennai" })).status).toBe(200);
      expect((await s.as(s.neutral).dismiss(s.reportId)).status).toBe(200);
      expect((await as.profile(bystander.id, { city: "Pune" })).status).toBe(200);
    });

    it("can't cut the reporter off from chat at a school by making them a current pupil", async () => {
      const { tenant } = await createTenant(ctx, { type: "SCHOOL", features: { ...defaultFeaturesFor("SCHOOL"), messaging: true } });
      const reporter = await memberSession(ctx, tenant.id, { fullName: "Reporter Rao", batchYear: 2010 });
      const reported = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", batchYear: 2010 });
      const id = await acceptedThread(ctx, tenant.slug, reporter, reported);
      const { body } = await chatApi(ctx, tenant.slug, reported).send(id, SECRET);
      expect((await chatApi(ctx, tenant.slug, reporter).report(body.data.id)).status).toBe(201);
      refused(await adminOf(tenant.slug, reported).profile(reporter.membership.id, { batchYear: new Date().getFullYear() + 1 }));
      expect((await chatApi(ctx, tenant.slug, reporter).badge()).status).toBe(200);
    });

    it("limits the actions a change that changes nothing could probe with, and leaves the rest of the console alone", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await bareMember(ctx, tenant.id);
      const suspended = await bareMember(ctx, tenant.id, { status: "SUSPENDED" });
      const pending = await bareMember(ctx, tenant.id, { status: "PENDING" });
      const as = adminOf(tenant.slug, admin);
      await ctx.redis.set(keys.rateLimit("member-admin-action", admin.user.id), "59", "EX", 3600);
      process.env.RATE_LIMIT_IN_TESTS = "1";
      try {
        expect((await as.setRole(member.id, "MEMBER")).status).toBe(200);
        for (const over of [await as.setRole(member.id, "MEMBER"), await as.suspend(member.id), await as.profile(member.id, {}), await as.reinstate(suspended.id)]) {
          expect(over.status).toBe(429);
          expect(over.body.error.code).toBe("RATE_LIMITED");
        }
        // Approving new members one at a time isn't held back.
        expect((await as.approve(pending.id)).status).toBe(200);
        expect((await as.member(member.id)).status).toBe(200);
      } finally {
        delete process.env.RATE_LIMIT_IN_TESTS;
      }
    });

    it("also can't change a role to what it already is, or the answer would tell targets apart", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      refused(await s.as(s.reported).setRole(s.reporter.membership.id, "MEMBER"));
    });

    it("stops being held back once the report closes, however it closes", async () => {
      const dismissed = await scenario({ reported: { role: "TENANT_ADMIN" } });
      refused(await dismissed.as(dismissed.reported).suspend(dismissed.reporter.membership.id));
      expect((await dismissed.as(dismissed.neutral).dismiss(dismissed.reportId)).status).toBe(200);
      expect((await dismissed.as(dismissed.reported).suspend(dismissed.reporter.membership.id)).status).toBe(200);

      const resolved = await scenario({ reported: { role: "TENANT_ADMIN" } });
      expect((await resolved.as(resolved.neutral).resolve(resolved.reportId, { action: "NONE" })).status).toBe(200);
      expect((await resolved.as(resolved.reported).setRole(resolved.reporter.membership.id, "TENANT_ADMIN")).status).toBe(200);
    });

    it("stays held back while any report about them is open, even after another closes", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const { body } = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "Another one");
      const second = await chatApi(ctx, s.tenant.slug, s.reporter).report(body.data.id);
      await s.as(s.neutral).dismiss(s.reportId);
      refused(await s.as(s.reported).suspend(s.reporter.membership.id));
      await s.as(s.neutral).dismiss(second.body.data.id);
      expect((await s.as(s.reported).suspend(s.reporter.membership.id)).status).toBe(200);
    });

    it("isn't kept from the rest of the job: approving and reinstating go on as normal", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const pending = await bareMember(ctx, s.tenant.id, { status: "PENDING" });
      const suspended = await bareMember(ctx, s.tenant.id, { status: "SUSPENDED" });
      expect((await s.as(s.reported).approve(pending.id)).status).toBe(200);
      expect((await s.as(s.reported).reinstate(suspended.id)).status).toBe(200);
    });

    it("doesn't apply to an admin who only filed a report", async () => {
      const s = await scenario({ reporter: { role: "TENANT_ADMIN" } });
      expect((await s.as(s.reporter).profile(s.neutral.membership.id, { city: "Pune" })).status).toBe(200);
      expect((await s.as(s.reporter).setRole(s.neutral.membership.id, "MEMBER")).status).toBe(200);
      expect((await s.as(s.reporter).suspend(s.reported.membership.id)).status).toBe(200);
    });

    it("doesn't apply to an admin with no report about them, or to Illuminize staff", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      expect((await s.as(staff).suspend(s.reporter.membership.id)).status).toBe(200);
      expect((await s.as(staff).setRole(s.reported.membership.id, "MEMBER")).status).toBe(200);
      const other = await scenario({ reported: { role: "TENANT_ADMIN" } });
      expect((await other.as(other.neutral).suspend(other.reporter.membership.id)).status).toBe(200);
    });

    it.each(["MEMBER", "TENANT_ADMIN"] as const)("doesn't apply to staff even when they're the member reported, holding the %s role, though they still can't see the report", async (role) => {
      const { tenant } = await createTenant(ctx);
      const session = await staffMember(tenant.id, { role });
      const member = await memberSession(ctx, tenant.id);
      const bystander = await bareMember(ctx, tenant.id);
      const id = await acceptedThread(ctx, tenant.slug, member, session);
      const { body } = await chatApi(ctx, tenant.slug, session).send(id, SECRET);
      const filed = await chatApi(ctx, tenant.slug, member).report(body.data.id);
      expect(filed.status).toBe(201);
      const as = adminOf(tenant.slug, session);
      expect((await as.suspend(bystander.id)).status).toBe(200);
      expect((await as.reinstate(bystander.id)).status).toBe(200);
      expect((await as.setRole(bystander.id, "TENANT_ADMIN")).status).toBe(200);
      expect((await as.profile(bystander.id, { city: "Pune" })).status).toBe(200);
      expect(await auditRows(tenant.id, "membership.action_refused")).toEqual([]);
      expect((await as.view(filed.body.data.id)).status).toBe(404);
    });

    it("is decided fresh: a report filed a moment ago counts, with no sign-in in between", async () => {
      const { tenant } = await createTenant(ctx);
      const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
      const member = await memberSession(ctx, tenant.id);
      const bystander = await bareMember(ctx, tenant.id);
      const as = adminOf(tenant.slug, admin);
      expect((await as.setRole(bystander.id, "TENANT_ADMIN")).status).toBe(200);
      const id = await acceptedThread(ctx, tenant.slug, member, admin);
      const { body } = await chatApi(ctx, tenant.slug, admin).send(id, SECRET);
      expect((await chatApi(ctx, tenant.slug, member).report(body.data.id)).status).toBe(201);
      refused(await as.setRole(bystander.id, "MEMBER"));
    });

    // A trigger holds one side mid-transaction, and the other starts only once it's there, so these don't depend on timing.
    describe("and a report filed while they act", () => {
      /** An admin, a member they could suspend, and something of theirs to report in each of the three ways. */
      async function beforeTheReport() {
        const { tenant } = await createTenant(ctx);
        const reporter = await memberSession(ctx, tenant.id, { fullName: "Reporter Rao" });
        const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN", fullName: "Reported Roy" });
        await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
        const target = await bareMember(ctx, tenant.id);
        const conversationId = await acceptedThread(ctx, tenant.slug, reporter, admin);
        const sent = await chatApi(ctx, tenant.slug, admin).send(conversationId, SECRET);
        await offerToMentor(ctx, tenant.slug, reporter);
        const asked = await askMentor(ctx, tenant.slug, admin, reporter.membership.id);
        const job = await postReferralJob(ctx, tenant.slug, reporter);
        const referral = await askForReferral(ctx, tenant.slug, admin, job.id);
        const report = {
          message: () => chatApi(ctx, tenant.slug, reporter).report(sent.body.data.id),
          mentorship: () => mentorshipApi(ctx, tenant.slug, reporter).report(asked.id),
          referral: () => referralsApi(ctx, tenant.slug, reporter).report(referral.id),
        };
        return { tenant, target, as: adminOf(tenant.slug, admin), report };
      }
      const memberRow = async (id: string) => (await ctx.db.select().from(memberships).where(eq(memberships.id, id)))[0]!;
      const reportsIn = (tenantId: string) => ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, tenantId));

      it.each(["message", "mentorship", "referral"] as const)("is stopped by a %s report filed first, which the check waits for rather than missing", async (kind) => {
        const s = await beforeTheReport();
        await withTrigger(ctx, "before insert on chat_reports", "perform pg_sleep(0.5); return new;", async () => {
          // Supertest sends a request only once something calls then().
          const filing = s.report[kind]().then((res) => res);
          await untilSomeoneSleeps(ctx);
          refused(await s.as.suspend(s.target.id));
          expect((await filing).status).toBeLessThan(300);
        });
        expect((await memberRow(s.target.id)).status).toBe("APPROVED");
        expect(await auditRows(s.tenant.id, "membership.suspend")).toEqual([]);
        expect(await auditRows(s.tenant.id, "membership.action_refused")).toHaveLength(1);
        expect(await reportsIn(s.tenant.id)).toEqual([expect.objectContaining({ status: "OPEN" })]);
      });

      it("files a report sent during the change once the change commits, and both stand", async () => {
        const s = await beforeTheReport();
        await withTrigger(ctx, "before update on memberships", "perform pg_sleep(1); return new;", async () => {
          const suspending = s.as.suspend(s.target.id).then((res) => res);
          await untilSomeoneSleeps(ctx);
          const filing = s.report.message().then((res) => res);
          // The report waits for the change to commit instead of slipping in beside it.
          await untilSomeoneWaitsFor(ctx, "advisory");
          expect(await reportsIn(s.tenant.id)).toEqual([]);
          const [suspended, filed] = await Promise.all([suspending, filing]);
          expect(suspended.status).toBe(200);
          expect(filed.status).toBe(201);
        });
        expect((await memberRow(s.target.id)).status).toBe("SUSPENDED");
        expect(await reportsIn(s.tenant.id)).toEqual([expect.objectContaining({ status: "OPEN" })]);
        refused(await s.as.setRole(s.target.id, "TENANT_ADMIN"));
      });

      it("takes reports about the same admin side by side", async () => {
        const s = await beforeTheReport();
        await withTrigger(ctx, "before insert on chat_reports", "perform pg_sleep(1); return new;", async () => {
          const filing = Promise.all([s.report.message(), s.report.mentorship(), s.report.referral()]);
          // Two filers inside their inserts at once, each holding the subject lock: they share it. (Only two, because the
          // mentorship and referral requests are between the same pair, whose lock they take one after the other.)
          await untilSomeoneSleeps(ctx, 2);
          expect((await filing).map((res) => res.status)).toEqual([201, 200, 200]);
        });
        expect(await reportsIn(s.tenant.id)).toHaveLength(3);
      });
    });
  });

  describe("with messaging switched off", () => {
    it("leaves all of it working: queue, tile, view, resolve, dismiss and the rule on reported admins", async () => {
      const s = await scenario({ reported: { role: "TENANT_ADMIN" } });
      const { body } = await chatApi(ctx, s.tenant.slug, s.reported).send(s.conversationId, "One more");
      const second = await chatApi(ctx, s.tenant.slug, s.reporter).report(body.data.id);
      await ctx.db
        .update(tenantSettings)
        .set({ features: { ...defaultFeaturesFor("COLLEGE"), messaging: false } })
        .where(eq(tenantSettings.tenantId, s.tenant.id));
      await invalidateTenantCache(ctx, s.tenant.slug);
      expect((await chatApi(ctx, s.tenant.slug, s.reporter).send(s.conversationId, "Refused")).status).toBe(403);

      const as = s.as(s.neutral);
      expect((await as.list()).body.total).toBe(2);
      expect((await as.dashboard()).body.data.openChatReports).toBe(2);
      expect((await as.view(s.reportId)).body.data.messages.find((m: { isTarget: boolean }) => m.isTarget).body).toBe(SECRET);
      expect((await s.as(staff).view(s.reportId)).status).toBe(200);
      expect((await platformList()).body.data.map((r: { id: string }) => r.id)).toContain(s.reportId);
      expect((await s.as(s.reported).suspend(s.reporter.membership.id)).status).toBe(403);
      expect((await as.resolve(s.reportId, { action: "REMOVE_MESSAGE", note: NOTE })).status).toBe(200);
      expect((await messageRow(s.messageId)).removedAt).toBeInstanceOf(Date);
      expect((await as.dismiss(second.body.data.id)).status).toBe(200);
      expect((await as.dashboard()).body.data.openChatReports).toBe(0);
    });
  });
});
