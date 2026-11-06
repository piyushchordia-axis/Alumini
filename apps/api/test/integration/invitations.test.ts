import { importInChunks, importProblems, type InvitationImportResultDto, type InvitationImportRow, type MessageChannel } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { invitations, memberships, outboundMessages, tenantBillingPlans, tenantSettings, tenants } from "../../src/db/schema";
import { claimInvitation } from "../../src/repositories/invitations.repo";
import type { ChannelSender, RenderedMessage } from "../../src/services/messages/types";
import { PROFILE, auth, createMembership, createTenant, createUser, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

class Capture<C extends MessageChannel> implements ChannelSender<C> {
  readonly provider = "capture";
  readonly sent: Array<Extract<RenderedMessage, { channel: C }>> = [];
  constructor(readonly channel: C) {}
  async send(m: Extract<RenderedMessage, { channel: C }>) {
    this.sent.push(m);
    return { providerMessageId: `${this.channel}-${this.sent.length}` };
  }
}

describe.skipIf(!dbAvailable)("invitations", () => {
  let ctx: TestContext;
  const whatsapp = new Capture("WHATSAPP");
  const email = new Capture("EMAIL");
  beforeAll(async () => {
    ctx = await createTestContext({ WHATSAPP_TEMPLATES: "INVITE=illuminize_invite:en", INVITES_DAILY_LIMIT: "3" }, { messageSenders: { WHATSAPP: whatsapp, EMAIL: email } });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    whatsapp.sent.length = 0;
    email.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  async function setup(opts: { channels?: MessageChannel[]; country?: string; approval?: "AUTO_APPROVE" | "ADMIN_APPROVAL" } = {}) {
    const { tenant } = await createTenant(ctx, { name: "Invite College", memberApprovalMode: opts.approval ?? "ADMIN_APPROVAL", allowSelfRegistration: false });
    if (opts.country) await ctx.db.update(tenants).set({ country: opts.country }).where(eq(tenants.id, tenant.id));
    if (opts.channels) await ctx.db.insert(tenantBillingPlans).values({ tenantId: tenant.id, billingModel: "FREE", effectiveFrom: "2020-01-01", includedChannels: opts.channels });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const base = `/api/v1/t/${tenant.slug}`;
    return { tenant, admin, base };
  }

  it("imports rows with a result per row", async () => {
    const { tenant, admin, base } = await setup({ country: "GB" });
    const existing = await memberSession(ctx, tenant.id, { phone: "+447700900111" });
    expect(existing.membership.status).toBe("APPROVED");
    await api()
      .post(`${base}/admin/profile-fields`)
      .set(admin.headers)
      .send({ key: "house", label: "House", type: "SELECT", options: [{ value: "blue", label: "Blue" }] });
    const res = await api()
      .post(`${base}/admin/invitations/import`)
      .set(admin.headers)
      .send({
        rowOffset: 100,
        rows: [
          { phone: "07700 900123", name: "Asha Rao", batchYear: "2012", email: "Asha@Example.com", fields: { house: "blue" } },
          { phone: "+447700900123", name: "Duplicate" },
          { phone: "9.19876E+11" },
          { phone: "123" },
          { phone: "+447700900124", batchYear: "1890" },
          { phone: "+447700900125", email: "not-email" },
          { phone: "+447700900126", fields: { house: "green" } },
          { phone: "+447700900111", name: "Already here" },
          { phone: "+919876543210", name: "With country code" },
        ],
      });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d).toMatchObject({ created: 2, updated: 0, skipped: 7, queued: 0 });
    expect(d.results.map((r: { row: number; status: string }) => [r.row, r.status])).toEqual([
      [101, "created"],
      [102, "invalid"],
      [103, "invalid"],
      [104, "invalid"],
      [105, "invalid"],
      [106, "invalid"],
      [107, "invalid"],
      [108, "member"],
      [109, "created"],
    ]);
    expect(d.results[1].message).toMatch(/earlier row/);
    expect(d.results[2].message).toMatch(/scientific notation/);
    expect(d.results[6].message).toBe("House: Choose one of the options");
    const [row] = await ctx.db.select().from(invitations).where(eq(invitations.phoneE164, "+447700900123"));
    expect(row).toMatchObject({ fullName: "Asha Rao", batchYear: 2012, email: "asha@example.com", fieldValues: { house: "blue" }, status: "PENDING" });

    // Importing again updates the invitation instead of duplicating it.
    const again = await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: [{ phone: "+447700900123", name: "Asha R." }] });
    expect(again.body.data).toMatchObject({ created: 0, updated: 1 });
    expect((await ctx.db.select().from(invitations).where(eq(invitations.phoneE164, "+447700900123")))[0]!.fullName).toBe("Asha R.");
  });

  it("refuses a row whose batch comes before the start its invitation keeps, and imports the rest of the file", async () => {
    const { tenant, admin, base } = await setup();
    const [kept] = await ctx.db
      .insert(invitations)
      .values({ tenantId: tenant.id, phoneE164: "+919800000031", fullName: "Harsh Vora", startYear: 2012, batchYear: 2016, token: "kept-start-token", expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    const res = await api()
      .post(`${base}/admin/invitations/import`)
      .set(admin.headers)
      .send({
        rows: [
          { phone: "+919800000031", name: "Harsh V.", batchYear: "2010" },
          { phone: "+919800000032", name: "Leela Menon", batchYear: "2019" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 1, updated: 0, skipped: 1 });
    expect(res.body.data.results[0]).toMatchObject({ row: 1, status: "invalid", message: "Batch can't be before the year they joined (2012)" });
    // Left as it was.
    expect((await ctx.db.select().from(invitations).where(eq(invitations.id, kept!.id)))[0]).toMatchObject({ fullName: "Harsh Vora", startYear: 2012, batchYear: 2016 });

    // The year they joined itself, or a later one, is taken.
    const fixed = await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: [{ phone: "+919800000031", batchYear: "2012" }] });
    expect(fixed.body.data).toMatchObject({ updated: 1, skipped: 0 });
    expect((await ctx.db.select().from(invitations).where(eq(invitations.id, kept!.id)))[0]).toMatchObject({ startYear: 2012, batchYear: 2012 });
  });

  it("leaves out a row with a cell too long for the request on its own line, through the apps' chunked import", async () => {
    const { base, admin } = await setup();
    const rows: InvitationImportRow[] = [
      { phone: "+917600000101", name: "Asha Rao", batchYear: "2012" },
      { phone: "+917600000102", name: "Ravi Shah", batchYear: "Class of 2012" },
      { phone: "+917600000103", name: "Mina Patel" },
    ];
    // Sent as it is, the long batch fails the whole request, with no line to find it by.
    const whole = await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows, rowOffset: 1 });
    expect(whole.status).toBe(400);

    const outcome = await importInChunks(rows, async (chunk) => {
      const res = await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: chunk.rows, rowOffset: chunk.rowOffset });
      expect(res.status).toBe(200);
      return res.body.data as InvitationImportResultDto;
    });
    expect(outcome.error).toBeUndefined();
    expect(outcome.result).toMatchObject({ created: 2, updated: 0, skipped: 1 });
    // The header is line 1, so the second data row is line 3.
    expect(importProblems(outcome.result)).toEqual([{ row: 3, phone: "+917600000102", status: "invalid", message: "Batch is too long to be a year" }]);
    expect((await ctx.db.select().from(invitations)).map((r) => r.fullName).sort()).toEqual(["Asha Rao", "Mina Patel"]);
  });

  it("sends only over the plan's channels, rate-limits resends and the daily total, and shows delivery", async () => {
    const none = await setup();
    await api().post(`${none.base}/admin/invitations/import`).set(none.admin.headers).send({ rows: [{ phone: "+919800000001" }] });
    const blocked = await api().post(`${none.base}/admin/invitations/send-pending`).set(none.admin.headers);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/plan doesn't include/);

    const { base, admin } = await setup({ channels: ["WHATSAPP", "EMAIL"] });
    const imp = await api()
      .post(`${base}/admin/invitations/import`)
      .set(admin.headers)
      .send({ send: true, rows: [{ phone: "+919800000011", name: "Ravi Kumar" }, { phone: "+919800000012", email: "meera@example.com" }, { phone: "+919800000013" }, { phone: "+919800000014" }] });
    expect(imp.body.data).toMatchObject({ created: 4, queued: 3 }); // daily limit 3
    await ctx.jobs.drain();
    expect(whatsapp.sent).toHaveLength(3);
    const first = whatsapp.sent[0]!;
    expect(first.template.name).toBe("illuminize_invite");
    expect(first.template.components[0]!.parameters.map((p) => p.text)).toEqual(["Ravi", "Invite College"]);
    const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.phoneE164, "+919800000011"));
    expect(first.template.components[1]).toEqual({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: inv!.token }] });
    expect(inv).toMatchObject({ status: "SENT", sendCount: 1 });

    const list = await api().get(`${base}/admin/invitations?status=SENT`).set(admin.headers);
    expect(list.body.total).toBe(3);
    expect(list.body.data[0].delivery).toMatchObject({ status: "SENT", channel: "WHATSAPP" });
    expect(list.body.data[0].link).toMatch(/^http:\/\/localhost:5173\/i\/[A-Za-z0-9_-]{20,}$/);

    // Resending within 24 hours is skipped; the 4th invitation hits today's limit.
    const resend = await api().post(`${base}/admin/invitations/send`).set(admin.headers).send({ ids: [inv!.id] });
    expect(resend.body.data).toEqual({ queued: 0, skipped: 1 });
    const limited = await api().post(`${base}/admin/invitations/send-pending`).set(admin.headers);
    expect(limited.status).toBe(429);
    const summary = await api().get(`${base}/admin/invitations/summary`).set(admin.headers);
    expect(summary.body.data).toMatchObject({ pending: 1, sent: 3, accepted: 0, channels: ["WHATSAPP", "EMAIL"], sendableToday: 0 });
    const messages = await ctx.db.select().from(outboundMessages);
    expect(messages.every((m) => m.contextType === "invite" && m.type === "INVITE")).toBe(true);
  });

  it("doesn't send an invitation revoked after it was queued", async () => {
    const { base, admin } = await setup({ channels: ["WHATSAPP"] });
    const imp = await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ send: true, rows: [{ phone: "+919800000021" }] });
    // Let the send job queue the message, then revoke before the message goes out.
    await ctx.jobs.drain({ maxJobs: 1 });
    const id = imp.body.data.results[0].invitationId;
    expect((await api().post(`${base}/admin/invitations/${id}/revoke`).set(admin.headers)).body.data.status).toBe("REVOKED");
    await ctx.jobs.drain();
    expect(whatsapp.sent).toHaveLength(0);
    expect((await ctx.db.select().from(outboundMessages))[0]!.status).toBe("CANCELLED");
  });

  it("shows a public summary for open links only", async () => {
    const { base, admin } = await setup();
    await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: [{ phone: "+919876543210", name: "Asha Rao" }] });
    const [inv] = await ctx.db.select().from(invitations);
    const pub = await api().get(`/api/v1/invites/${inv!.token}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data).toMatchObject({ firstName: "Asha", maskedPhone: "+91*******210", tenant: { name: "Invite College" } });
    expect(JSON.stringify(pub.body.data)).not.toContain("9876543210");
    await ctx.db.update(invitations).set({ expiresAt: new Date(Date.now() - 1000) });
    expect((await api().get(`/api/v1/invites/${inv!.token}`)).status).toBe(404);
    await ctx.db.update(invitations).set({ expiresAt: new Date(Date.now() + 86_400_000), status: "REVOKED" });
    expect((await api().get(`/api/v1/invites/${inv!.token}`)).status).toBe(404);
    expect((await api().get("/api/v1/invites/not-a-real-token-xyz")).status).toBe(404);
  });

  it("lets an invited phone join a closed institution, approved and prefilled, and marks the invitation accepted", async () => {
    const { base, admin } = await setup();
    await api()
      .post(`${base}/admin/profile-fields`)
      .set(admin.headers)
      .send({ key: "roll", label: "Roll", type: "TEXT", memberEditable: false, visibility: "ADMINS" });
    await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: [{ phone: "+919811111111", name: "Asha Rao", batchYear: 2012, fields: { roll: "EE-42" } }] });

    // Someone else can't join (registration is closed).
    const stranger = await loginAs(ctx, "+919811111199");
    expect((await api().post(`${base}/memberships`).set(auth(stranger.accessToken)).send(PROFILE)).body.error.code).toBe("REGISTRATION_CLOSED");

    const invited = await loginAs(ctx, "+919811111111");
    const h = auth(invited.accessToken);
    const mine = await api().get(`${base}/memberships/invitation`).set(h);
    expect(mine.body.data).toEqual({ fullName: "Asha Rao", batchYear: 2012, fields: { roll: "EE-42" }, autoApprove: true });
    const joined = await api().post(`${base}/memberships`).set(h).send({ ...PROFILE, fullName: "Asha Rao" });
    expect(joined.status).toBe(201);
    expect(joined.body.data.status).toBe("APPROVED");
    const [inv] = await ctx.db.select().from(invitations);
    expect(inv).toMatchObject({ status: "ACCEPTED", acceptedMembershipId: joined.body.data.id });
    // The admin-managed answer from the import is on the profile (admins see it).
    const detail = await api().get(`${base}/admin/members/${joined.body.data.id}`).set(admin.headers);
    expect(detail.body.data.fields).toEqual([expect.objectContaining({ key: "roll", value: "EE-42" })]);
    expect((await api().get(`${base}/memberships/invitation`).set(h)).body.data).toBeNull();
    // A closed invitation can't be claimed twice.
    expect(await claimInvitation(ctx.db, inv!.id, joined.body.data.id)).toBeUndefined();
  });

  it("follows the approval mode when invitees aren't auto-approved, never lifts a suspension, and lets a rejected member back in", async () => {
    const { tenant, base, admin } = await setup();
    await ctx.db.update(tenantSettings).set({ inviteAutoApprove: false, allowSelfRegistration: true }).where(eq(tenantSettings.tenantId, tenant.id));
    await api().post(`${base}/admin/invitations/import`).set(admin.headers).send({ rows: [{ phone: "+919822222222" }, { phone: "+919833333333" }, { phone: "+919844444444" }] });

    const pending = await loginAs(ctx, "+919822222222");
    // Settings are cached; this tenant's cache entry was never read, so the change applies.
    expect((await api().post(`${base}/memberships`).set(auth(pending.accessToken)).send(PROFILE)).body.data.status).toBe("PENDING");

    await ctx.db.update(tenantSettings).set({ inviteAutoApprove: true }).where(eq(tenantSettings.tenantId, tenant.id));
    await ctx.redis.flushall();
    const suspendedUser = await createUser(ctx, { phone: "+919833333333" });
    await createMembership(ctx, tenant.id, suspendedUser.id, { status: "SUSPENDED" });
    const s = await loginAs(ctx, "+919833333333");
    const res = await api().post(`${base}/memberships`).set(auth(s.accessToken)).send(PROFILE);
    expect(res.status).toBe(409);

    const rejectedUser = await createUser(ctx, { phone: "+919844444444" });
    await createMembership(ctx, tenant.id, rejectedUser.id, { status: "REJECTED" });
    const r = await loginAs(ctx, "+919844444444");
    const back = await api().post(`${base}/memberships`).set(auth(r.accessToken)).send(PROFILE);
    expect(back.status).toBe(201);
    expect(back.body.data.status).toBe("APPROVED");
    const rows = await ctx.db.select().from(memberships).where(eq(memberships.tenantId, tenant.id));
    expect(rows.find((m) => m.userId === suspendedUser.id)!.status).toBe("SUSPENDED");
  });
});
