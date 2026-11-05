import { and, eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, chatReports, notifications, outboundMessages, users } from "../../src/db/schema";
import { countDeliveredMessages } from "../../src/repositories/messages.repo";
import { sweepEscalatedChatReports } from "../../src/services/chat/staffAlerts.service";
import type { RenderedMessage } from "../../src/services/messages/types";
import { acceptedThread, chatApi, type Session } from "../helpers/chat";
import { auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { capturingSenders } from "../helpers/messages";
import { NOTE, askMentor, mentorshipApi, offerToMentor } from "../helpers/mentorship";
import { REFERRAL_NOTE, askForReferral, postReferralJob, referralsApi } from "../helpers/referrals";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

const SECRET = "A message only an audited view may show 3K9P";
const DETAILS = "The reporter's own words about it";
const NAMES = ["Reporter Rao", "Reported Roy", "Neutral Nair"];
const ABOUT_AN_ADMIN = "It's about one of the institution's admins, who can't suspend anyone or change roles until it's closed.";
const NO_OTHER_ADMIN = "No other admin there can handle it.";
const ABOUT_A_STAFF_ADMIN = "It's about one of the institution's admins.";

type Email = Extract<RenderedMessage, { channel: "EMAIL" }>;

describe.skipIf(!dbAvailable)("staff alerts for escalated chat reports", () => {
  let ctx: TestContext;
  const { senders, reset } = capturingSenders();
  /** The signed-in member of staff, and a second one, both with a confirmed email. */
  let staff: { headers: ReturnType<typeof auth>; id: string };
  let other: typeof users.$inferSelect;

  beforeAll(async () => {
    ctx = await createTestContext({}, { messageSenders: senders });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    reset();
    const session = await loginAs(ctx, "+919999999999");
    staff = { headers: auth(session.accessToken), id: session.user.id };
    await ctx.db.update(users).set({ email: "staff@illuminize.test", emailVerifiedAt: new Date() }).where(eq(users.id, staff.id));
    const created = await createUser(ctx, { isPlatformAdmin: true });
    other = (await ctx.db.update(users).set({ email: "other@illuminize.test", emailVerifiedAt: new Date() }).where(eq(users.id, created.id)).returning())[0]!;
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const api = () => request(ctx.app);
  const bothStaff = () => [staff.id, other.id].sort();
  const alerts = () => ctx.db.select().from(outboundMessages).where(eq(outboundMessages.type, "STAFF_CHAT_REPORT"));
  const recipients = async () => (await alerts()).map((a) => a.recipientUserId).sort();
  const reportRow = async (id: string) => (await ctx.db.select().from(chatReports).where(eq(chatReports.id, id)))[0]!;
  const emails = () => senders.EMAIL.sent as Email[];
  const sweep = () => ctx.jobs.runScheduled("chat-reports-staff-alert");
  const expectNoWords = (value: unknown, ...words: string[]) => {
    const text = JSON.stringify(value);
    for (const word of words) expect(text).not.toContain(word);
  };

  /** A message `reported` sent `reporter`, ready to be reported, in an institution with one neutral admin unless told otherwise. */
  async function scenario(opts: { reporterRole?: "MEMBER" | "TENANT_ADMIN"; reportedRole?: "MEMBER" | "TENANT_ADMIN"; neutralAdmin?: boolean } = {}) {
    const { tenant } = await createTenant(ctx);
    const reporter = await memberSession(ctx, tenant.id, { fullName: "Reporter Rao", role: opts.reporterRole ?? "MEMBER" });
    const reported = await memberSession(ctx, tenant.id, { fullName: "Reported Roy", role: opts.reportedRole ?? "MEMBER" });
    const neutral = opts.neutralAdmin === false ? null : await memberSession(ctx, tenant.id, { fullName: "Neutral Nair", role: "TENANT_ADMIN" });
    const conversationId = await acceptedThread(ctx, tenant.slug, reporter, reported);
    const sent = await chatApi(ctx, tenant.slug, reported).send(conversationId, SECRET);
    const file = async () => {
      const res = await chatApi(ctx, tenant.slug, reporter).report(sent.body.data.id, { reason: "HARASSMENT", details: DETAILS });
      expect(res.status).toBe(201);
      return res.body.data.id as string;
    };
    const admin = (who: Pick<Session, "headers">) => {
      const base = `/api/v1/t/${tenant.slug}/admin`;
      return {
        dismiss: (id: string) => api().post(`${base}/chat-reports/${id}/dismiss`).set(who.headers).send({}),
        suspend: (id: string) => api().post(`${base}/members/${id}/suspend`).set(who.headers).send({ reason: "Testing" }),
      };
    };
    return { tenant, reporter, reported, neutral, file, admin };
  }

  it("alerts every member of staff once, as the report about an admin is filed, by email, with ids alone stored and nothing billed", async () => {
    const s = await scenario({ reportedRole: "TENANT_ADMIN" });
    const day = 86_400_000;
    const period = { from: new Date(Date.now() - day), toExclusive: new Date(Date.now() + day) };
    const billedBefore = await countDeliveredMessages(ctx.db, s.tenant.id, period);
    const reportId = await s.file();

    const claimedAt = (await reportRow(reportId)).staffAlertedAt!;
    expect(claimedAt).toBeInstanceOf(Date);
    const queued = await alerts();
    expect(queued.map((a) => a.recipientUserId).sort()).toEqual(bothStaff());
    for (const alert of queued) {
      expect(alert).toMatchObject({
        tenantId: null,
        status: "QUEUED",
        channels: ["EMAIL", "WHATSAPP", "SMS"],
        contextType: "chat_report",
        contextId: reportId,
        dedupeKey: `staff-chat-report-${reportId}-${alert.recipientUserId}-${claimedAt.getTime()}`,
      });
      expect(alert.payload).toEqual({ chatReportId: reportId, tenantId: s.tenant.id });
    }

    await ctx.jobs.drain();
    expect(emails().map((e) => e.to).sort()).toEqual(["other@illuminize.test", "staff@illuminize.test"]);
    for (const email of emails()) {
      expect(email.subject).toBe(`A chat report at ${s.tenant.name} needs staff`);
      expect(email.text).toContain("Reason: Harassment. Reported: Message.");
      expect(email.text).toContain(ABOUT_AN_ADMIN);
      expect(email.text).toContain("http://localhost:5173/platform/chat-reports");
      expect(email.html).toContain("Open Chat reports");
    }
    expect((await alerts()).map((a) => a.status)).toEqual(["SENT", "SENT"]);
    const sends = ctx.jobs.history.filter((j) => j.name === "messages.send" || j.name === "chatReports.alertStaff");
    expectNoWords([emails(), await alerts(), sends], SECRET, DETAILS, ...NAMES, s.reporter.membership.id, s.reported.membership.id);
    expectNoWords([ctx.jobs.history, await ctx.db.select().from(auditLog).where(eq(auditLog.tenantId, s.tenant.id))], SECRET, DETAILS);

    // The sweep finds it already told, however often it runs, and doesn't claim it again.
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
    await sweep();
    await ctx.jobs.drain();
    expect((await reportRow(reportId)).staffAlertedAt).toEqual(claimedAt);
    expect(await alerts()).toHaveLength(2);
    expect(emails()).toHaveLength(2);
    // Staff mail isn't the institution's: nothing is counted for its bill.
    expect(await countDeliveredMessages(ctx.db, s.tenant.id, period)).toEqual(billedBefore);
  });

  it("alerts at once when the only admin is reported, though no admin hears of it", async () => {
    const s = await scenario({ reportedRole: "TENANT_ADMIN", neutralAdmin: false });
    const reportId = await s.file();
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "CHAT_REPORT_FILED"))).toEqual([]);
    expect(await recipients()).toEqual(bothStaff());
    await ctx.jobs.drain();
    expect(emails()[0]!.text).toContain(ABOUT_AN_ADMIN);
    expect((await reportRow(reportId)).staffAlertedAt).toBeInstanceOf(Date);
  });

  it("leaves a report its institution's admins can handle with them, and the sweep alerts staff once it becomes theirs", async () => {
    const s = await scenario();
    const reportId = await s.file();
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
    expect(await alerts()).toEqual([]);
    expect((await reportRow(reportId)).staffAlertedAt).toBeNull();

    // Staff take the admin role from the only admin who could handle it, so it's for another member of staff.
    expect((await api().delete(`/api/v1/platform/tenants/${s.tenant.id}/admins/${s.neutral!.membership.id}`).set(staff.headers)).status).toBe(204);
    await sweep();
    expect(await recipients()).toEqual([other.id]);
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
    await ctx.jobs.drain();
    expect(await alerts()).toHaveLength(1);
    expect(emails().map((e) => [e.to, e.text])).toEqual([["other@illuminize.test", expect.stringContaining(NO_OTHER_ADMIN)]]);
    expectNoWords([emails(), await alerts()], SECRET, DETAILS, ...NAMES);

    const view = (headers: Record<string, string>) => api().post(`/api/v1/t/${s.tenant.slug}/admin/chat-reports/${reportId}/view`).set(headers).send();
    expect((await view(staff.headers)).body.error).toMatchObject({ code: "NEEDS_OTHER_STAFF" });
    expect((await view(auth((await loginAs(ctx, other.phoneE164)).accessToken))).status).toBe(200);
  });

  it("holds a report no member of staff may take, saying so in the console, and alerts whoever may next", async () => {
    const s = await scenario();
    const reportId = await s.file();
    const otherHeaders = auth((await loginAs(ctx, other.phoneE164)).accessToken);
    const admins = (headers: Record<string, string>) => api().post(`/api/v1/platform/tenants/${s.tenant.id}/admins`).set(headers);
    const row = async () => ((await api().get("/api/v1/platform/chat-reports").set(staff.headers)).body.data as Array<{ id: string }>).find((r) => r.id === reportId);
    // One member of staff takes the only admin's role; the other adds an admin and takes the role back, so both changed them.
    expect((await api().delete(`/api/v1/platform/tenants/${s.tenant.id}/admins/${s.neutral!.membership.id}`).set(staff.headers)).status).toBe(204);
    expect(await row()).toMatchObject({ needsOtherStaff: true, noStaffCanTake: false });
    const added = await admins(otherHeaders).send({ phone: (await createUser(ctx)).phoneE164, fullName: "Added Admin" });
    expect(added.status).toBeLessThan(300);
    expect((await api().delete(`/api/v1/platform/tenants/${s.tenant.id}/admins/${added.body.data.id}`).set(otherHeaders)).status).toBe(204);
    expect(await row()).toMatchObject({ needsOtherStaff: true, noStaffCanTake: true });
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
    expect((await reportRow(reportId)).staffAlertedAt).toBeNull();
    expect(await alerts()).toEqual([]);

    // A third member of staff, whom only they may alert.
    const third = await createUser(ctx);
    expect((await api().post(`/api/v1/platform/users/${third.id}/platform-admin`).set(staff.headers).send({ enabled: true })).status).toBe(200);
    expect(await row()).toMatchObject({ needsOtherStaff: true, noStaffCanTake: false });
    expect(await sweepEscalatedChatReports(ctx)).toBe(1);
    expect(await recipients()).toEqual([third.id]);
  });

  it.each([
    ["another may take it, so the claim stands", false],
    ["nobody may, so the claim is released for whoever may next", true],
  ])("cancels an alert to a member of staff who changed its admins before it went out: %s", async (_, both) => {
    // About an admin, so it stays staff's whoever is added.
    const s = await scenario({ reportedRole: "TENANT_ADMIN" });
    const reportId = await s.file();
    expect(await recipients()).toEqual(bothStaff());
    const addAdmin = async (headers: Record<string, string>) => expect((await api().post(`/api/v1/platform/tenants/${s.tenant.id}/admins`).set(headers).send({ phone: (await createUser(ctx)).phoneE164, fullName: "Added Admin" })).status).toBeLessThan(300);
    await addAdmin(staff.headers);
    if (both) await addAdmin(auth((await loginAs(ctx, other.phoneE164)).accessToken));
    await ctx.jobs.drain();
    const cancelled = (await alerts()).filter((a) => a.status === "CANCELLED");
    expect(cancelled.map((a) => a.recipientUserId).sort()).toEqual(both ? bothStaff() : [staff.id]);
    for (const alert of cancelled) expect(alert.lastError).toBe("another member of staff must handle it");
    expect(emails().map((e) => e.to)).toEqual(both ? [] : ["other@illuminize.test"]);
    expect((await reportRow(reportId)).staffAlertedAt).toEqual(both ? null : expect.any(Date));
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
  });

  it("catches an escalation an institution's own admin causes: the reporter, an admin, suspending the only other one", async () => {
    const s = await scenario({ reporterRole: "TENANT_ADMIN" });
    const reportId = await s.file();
    expect(await alerts()).toEqual([]);
    expect((await s.admin(s.reporter).suspend(s.neutral!.membership.id)).status).toBe(200);
    await sweep();
    expect(await recipients()).toEqual(bothStaff());
    expect((await alerts()).map((a) => a.contextId)).toEqual([reportId, reportId]);
    await ctx.jobs.drain();
    expect(emails()[0]!.text).toContain(NO_OTHER_ADMIN);
  });

  /** An institution whose only admin is the second member of staff, chatting with a member: each has a message to report. */
  async function staffAdminThread() {
    const { tenant } = await createTenant(ctx);
    const membership = await createMembership(ctx, tenant.id, other.id, { role: "TENANT_ADMIN" });
    const staffMember = { headers: auth((await loginAs(ctx, other.phoneE164)).accessToken), user: other, membership, token: "" } as Session;
    const member = await memberSession(ctx, tenant.id);
    const conversationId = await acceptedThread(ctx, tenant.slug, member, staffMember);
    const fromStaff = (await chatApi(ctx, tenant.slug, staffMember).send(conversationId, SECRET)).body.data.id as string;
    const fromMember = (await chatApi(ctx, tenant.slug, member).send(conversationId, "And a reply")).body.data.id as string;
    return { tenant, member, staffMember, fromStaff, fromMember };
  }

  it("leaves out staff the report names, as its reported member or its reporter", async () => {
    const { tenant, member, staffMember, fromStaff, fromMember } = await staffAdminThread();
    expect((await chatApi(ctx, tenant.slug, member).report(fromStaff)).status).toBe(201);
    expect(await recipients()).toEqual([staff.id]);
    // The institution has no admin of its own, so this one is for staff too, and its reporter isn't told.
    expect((await chatApi(ctx, tenant.slug, staffMember).report(fromMember)).status).toBe(201);
    expect(await recipients()).toEqual([staff.id, staff.id]);
    await ctx.jobs.drain();
    // The admin reported is staff, whom an open report doesn't hold back, so the alert doesn't say it does.
    const texts = emails().map((e) => e.text);
    expect(texts).toHaveLength(2);
    expect(texts.filter((t) => t.includes(ABOUT_A_STAFF_ADMIN))).toHaveLength(1);
    expect(texts.filter((t) => t.includes(NO_OTHER_ADMIN))).toHaveLength(1);
    expect(texts.join("\n")).not.toContain("can't suspend");
  });

  it("holds a report that names every member of staff until there's one it doesn't, and alerts them then", async () => {
    await ctx.db.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, staff.id));
    const { tenant, member, fromStaff } = await staffAdminThread();
    expect((await chatApi(ctx, tenant.slug, member).report(fromStaff)).status).toBe(201);
    const [report] = await ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, tenant.id));
    expect(await alerts()).toEqual([]);
    expect(report!.staffAlertedAt).toBeNull();
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);

    await ctx.db.update(users).set({ isPlatformAdmin: true }).where(eq(users.id, staff.id));
    expect(await sweepEscalatedChatReports(ctx)).toBe(1);
    expect(await recipients()).toEqual([staff.id]);
    await ctx.jobs.drain();
    expect(emails().map((e) => e.to)).toEqual(["staff@illuminize.test"]);
  });

  it.each([
    ["the report is closed", "report closed"],
    ["the report stops being for staff", "report no longer for staff"],
    ["the recipient stops being staff", "no longer Illuminize staff"],
  ])("checks again when sending, and cancels if %s", async (what, cause) => {
    const s = await scenario({ reportedRole: "TENANT_ADMIN" });
    const reportId = await s.file();
    if (what === "the report is closed") expect((await s.admin(staff).dismiss(reportId)).status).toBe(200);
    if (what === "the report stops being for staff") expect((await s.admin(s.neutral!).suspend(s.reported.membership.id)).status).toBe(200);
    if (what === "the recipient stops being staff") expect((await api().post(`/api/v1/platform/users/${other.id}/platform-admin`).set(staff.headers).send({ enabled: false })).status).toBe(200);
    await ctx.jobs.drain();
    const rows = await alerts();
    const cancelled = what === "the recipient stops being staff" ? rows.filter((a) => a.recipientUserId === other.id) : rows;
    expect(cancelled.map((a) => [a.status, a.lastError])).toEqual(cancelled.map(() => ["CANCELLED", cause]));
    expect(emails().map((e) => e.to)).toEqual(what === "the recipient stops being staff" ? ["staff@illuminize.test"] : []);
    // Only a report its admins can handle again counts as never told, for when it's staff's once more.
    expect((await reportRow(reportId)).staffAlertedAt).toEqual(what === "the report stops being for staff" ? null : expect.any(Date));
  });

  it("alerts again when a report that stopped being staff's before its alerts went out becomes theirs once more", async () => {
    const s = await scenario({ reportedRole: "TENANT_ADMIN" });
    const reportId = await s.file();
    // The neutral admin suspends the reported one before anything is sent, so the institution can handle it again.
    expect((await s.admin(s.neutral!).suspend(s.reported.membership.id)).status).toBe(200);
    await ctx.jobs.drain();
    expect(emails()).toEqual([]);
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);

    // Then staff take the admin role from the neutral admin, the only one left who could handle it, and leave it to the other.
    expect((await api().delete(`/api/v1/platform/tenants/${s.tenant.id}/admins/${s.neutral!.membership.id}`).set(staff.headers)).status).toBe(204);
    expect(await sweepEscalatedChatReports(ctx)).toBe(1);
    await ctx.jobs.drain();
    expect(emails().map((e) => [e.to, e.text])).toEqual([["other@illuminize.test", expect.stringContaining(NO_OTHER_ADMIN)]]);
    const rows = await alerts();
    expect(rows.filter((a) => a.status === "CANCELLED")).toHaveLength(2);
    expect(rows.filter((a) => a.status === "SENT").map((a) => [a.contextId, a.recipientUserId])).toEqual([[reportId, other.id]]);
    expect(await sweepEscalatedChatReports(ctx)).toBe(0);
  });

  type Kind = "message" | "mentorship" | "referral";
  const KIND_LABELS: Record<Kind, string> = { message: "Message", mentorship: "Mentorship request", referral: "Referral request" };

  /**
   * An institution with a reporter, the member they report, a neutral admin, and the second member of staff holding the
   * admin role too; files a report of this kind about `subject`.
   */
  async function reportOfKind(kind: Kind, subjectRole: "MEMBER" | "TENANT_ADMIN") {
    const { tenant } = await createTenant(ctx);
    const reporter = await memberSession(ctx, tenant.id, { fullName: "Reporter Rao" });
    const subject = await memberSession(ctx, tenant.id, { fullName: "Reported Roy", role: subjectRole });
    const neutral = await memberSession(ctx, tenant.id, { fullName: "Neutral Nair", role: "TENANT_ADMIN" });
    const staffAdmin = await createMembership(ctx, tenant.id, other.id, { role: "TENANT_ADMIN" });
    const body = { reason: "SPAM", details: DETAILS };
    let res;
    if (kind === "message") {
      const conversationId = await acceptedThread(ctx, tenant.slug, reporter, subject);
      const sent = await chatApi(ctx, tenant.slug, subject).send(conversationId, SECRET);
      res = await chatApi(ctx, tenant.slug, reporter).report(sent.body.data.id, body);
    } else if (kind === "mentorship") {
      await offerToMentor(ctx, tenant.slug, reporter);
      const asked = await askMentor(ctx, tenant.slug, subject, reporter.membership.id);
      res = await mentorshipApi(ctx, tenant.slug, reporter).report(asked.id, body);
    } else {
      const job = await postReferralJob(ctx, tenant.slug, reporter);
      const asked = await askForReferral(ctx, tenant.slug, subject, job.id);
      res = await referralsApi(ctx, tenant.slug, reporter).report(asked.id, body);
    }
    expect(res.status).toBe(kind === "message" ? 201 : 200);
    const [report] = await ctx.db.select().from(chatReports).where(eq(chatReports.tenantId, tenant.id));
    const filedTo = async () =>
      (await ctx.db.select().from(notifications).where(and(eq(notifications.tenantId, tenant.id), eq(notifications.type, "CHAT_REPORT_FILED")))).map((n) => n.recipientMembershipId).sort();
    return { tenant, report: report!, neutral, staffAdmin, filedTo };
  }

  it.each(["message", "mentorship", "referral"] as const)("sends a %s report its admins can handle to them alone: no CHAT_REPORT_FILED to staff holding the admin role, and no alert", async (kind) => {
    const r = await reportOfKind(kind, "MEMBER");
    expect(await r.filedTo()).toEqual([r.neutral.membership.id]);
    expect(await alerts()).toEqual([]);
  });

  it.each(["message", "mentorship", "referral"] as const)("alerts staff at once to a reported %s from an admin, without the note, and staff holding the admin role hear of it as admins too", async (kind) => {
    const r = await reportOfKind(kind, "TENANT_ADMIN");
    expect(await recipients()).toEqual(bothStaff());
    expect((await alerts()).map((a) => a.payload)).toEqual([
      { chatReportId: r.report.id, tenantId: r.tenant.id },
      { chatReportId: r.report.id, tenantId: r.tenant.id },
    ]);
    // It's escalated, so the staff admin may open it, and hears of it as the institution's admins do.
    expect(await r.filedTo()).toEqual([r.neutral.membership.id, r.staffAdmin.id].sort());
    await ctx.jobs.drain();
    expect(emails()).toHaveLength(2);
    for (const email of emails()) expect(email.text).toContain(`Reason: Spam. Reported: ${KIND_LABELS[kind]}.`);
    expectNoWords([emails(), await alerts()], SECRET, NOTE, REFERRAL_NOTE, DETAILS, ...NAMES);
  });

  it.each([
    ["by WhatsApp, where its template is configured", "WHATSAPP"],
    ["by SMS, where its flow is configured", "SMS"],
    ["not at all, where neither is", null],
  ] as const)("reaches staff with no confirmed email %s", async (_how, channel) => {
    await ctx.db.update(users).set({ email: null, emailVerifiedAt: null }).where(eq(users.id, other.id));
    if (channel === "WHATSAPP") ctx.config.whatsappTemplates.STAFF_CHAT_REPORT = { name: "staff_alert", language: "en" };
    if (channel === "SMS") ctx.config.msg91FlowTemplateIds.STAFF_CHAT_REPORT = "flow-staff";
    const s = await scenario({ reportedRole: "TENANT_ADMIN" });
    try {
      await s.file();
      await ctx.jobs.drain();
    } finally {
      delete ctx.config.whatsappTemplates.STAFF_CHAT_REPORT;
      delete ctx.config.msg91FlowTemplateIds.STAFF_CHAT_REPORT;
    }
    expect(emails().map((e) => e.to)).toEqual(["staff@illuminize.test"]);
    const alert = (await alerts()).find((a) => a.recipientUserId === other.id)!;
    expect(senders.WHATSAPP.sent).toEqual(
      channel === "WHATSAPP"
        ? [
            {
              channel: "WHATSAPP",
              to: other.phoneE164,
              template: { name: "staff_alert", language: "en", components: [{ type: "body", parameters: [{ type: "text", text: s.tenant.name }, { type: "text", text: "Harassment" }] }] },
            },
          ]
        : [],
    );
    expect(senders.SMS.sent).toEqual(
      channel === "SMS" ? [{ channel: "SMS", to: other.phoneE164, flowTemplateId: "flow-staff", vars: { institution: s.tenant.name, reason: "Harassment", link: "http://localhost:5173/platform/chat-reports" } }] : [],
    );
    if (channel) {
      expect(alert).toMatchObject({ status: "SENT", channel });
    } else {
      expect(alert.status).toBe("FAILED");
      expect(alert.errors.map((e) => [e.channel, e.error])).toEqual([
        ["EMAIL", "no email address"],
        ["WHATSAPP", "no WhatsApp template configured for STAFF_CHAT_REPORT (WHATSAPP_TEMPLATES)"],
        ["SMS", "no MSG91 flow template id for STAFF_CHAT_REPORT"],
      ]);
    }
    expectNoWords([senders.WHATSAPP.sent, senders.SMS.sent, await alerts()], SECRET, DETAILS, ...NAMES);
  });
});
