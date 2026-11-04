import { defaultFeaturesFor } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { events, jobs, outboundMessages, posts, tenantDigests, tenantJobRuns, tenantSettings, tenants, users } from "../../src/db/schema";
import { engagementTick } from "../../src/services/celebrations.service";
import { DIGEST_PAGE, runDigest, weekStartIn } from "../../src/services/digest.service";
import type { ChannelSender, RenderedMessage } from "../../src/services/messages/types";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

class CaptureEmail implements ChannelSender<"EMAIL"> {
  readonly channel = "EMAIL" as const;
  readonly provider = "capture";
  readonly sent: Array<Extract<RenderedMessage, { channel: "EMAIL" }>> = [];
  async send(m: Extract<RenderedMessage, { channel: "EMAIL" }>) {
    this.sent.push(m);
    return { providerMessageId: `e-${this.sent.length}` };
  }
}

const meta = { attempt: 1, maxAttempts: 1 };

describe.skipIf(!dbAvailable)("weekly digest", () => {
  let ctx: TestContext;
  const email = new CaptureEmail();
  beforeAll(async () => {
    ctx = await createTestContext({}, { messageSenders: { EMAIL: email } });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    email.sent.length = 0;
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  async function setup() {
    const { tenant } = await createTenant(ctx, { name: "Digest College" });
    const author = await memberSession(ctx, tenant.id, { fullName: "Asha Rao" });
    const reader = await memberSession(ctx, tenant.id, { fullName: "Bala Iyer" });
    const now = new Date();
    const week = weekStartIn(now, "Asia/Kolkata");
    return { tenant, author, reader, now, week, base: `/api/v1/t/${tenant.slug}` };
  }
  const confirmEmail = (userId: string, address: string) => ctx.db.update(users).set({ email: address, emailVerifiedAt: new Date() }).where(eq(users.id, userId));

  it("collects the week's popular posts, new jobs and upcoming events, and emails members who want it", async () => {
    const { tenant, author, reader, now, week, base } = await setup();
    const [quiet] = await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, body: "Quiet post", moderationStatus: "APPROVED", reactionCount: 1 }).returning();
    const [loud] = await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, body: "Reunion photos <script>alert(1)</script> are up!", moderationStatus: "APPROVED", reactionCount: 3, commentCount: 4 }).returning();
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, body: "Old news", moderationStatus: "APPROVED", reactionCount: 50, createdAt: new Date(now.getTime() - 9 * 86_400_000) });
    await ctx.db.insert(jobs).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Backend engineer", companyName: "Zylo", jobType: "FULL_TIME", description: "Build things", moderationStatus: "APPROVED", workMode: "REMOTE" });
    await ctx.db.insert(events).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Pune meetup", description: "Chai", kind: "CASUAL_MEETUP", city: "Pune", startAt: new Date(now.getTime() + 3 * 86_400_000), timezone: "Asia/Kolkata", moderationStatus: "APPROVED" });
    await ctx.db.insert(events).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Too far ahead", description: "-", kind: "CASUAL_MEETUP", city: "Pune", startAt: new Date(now.getTime() + 30 * 86_400_000), timezone: "Asia/Kolkata", moderationStatus: "APPROVED" });
    await confirmEmail(reader.user.id, "bala@example.com");
    await confirmEmail(author.user.id, "asha@example.com");
    await request(ctx.app).patch(`${base}/notification-prefs`).set(author.headers).send({ digestEmail: false });

    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    await ctx.jobs.drain();
    const [row] = await ctx.db.select().from(tenantDigests);
    expect(row!.content.postIds).toEqual([loud!.id, quiet!.id]);
    expect(row!.content.jobIds).toHaveLength(1);
    expect(row!.content.eventIds).toHaveLength(1);
    expect(row!.content.newMembers).toBe(2);

    expect(email.sent.map((m) => m.to)).toEqual(["bala@example.com"]);
    const mail = email.sent[0]!;
    expect(mail.subject).toBe("This week at Digest College");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain(`/t/${tenant.slug}/app/feed/${loud!.id}`);
    expect(mail.html).toContain("Backend engineer");
    expect(mail.html).toContain("Zylo · Remote");
    expect(mail.html).toContain("Pune meetup");
    expect(mail.html).not.toContain("Too far ahead");
    expect(mail.headers?.["List-Unsubscribe"]).toMatch(/unsubscribe\?token=/);

    // A second run of the same week adds nothing.
    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    await ctx.db.delete(tenantJobRuns);
    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    await ctx.jobs.drain();
    expect(email.sent).toHaveLength(1);

    // Members can read it in the app; content removed since is left out.
    await ctx.db.update(posts).set({ moderationStatus: "REMOVED" }).where(eq(posts.id, loud!.id));
    const latest = await request(ctx.app).get(`${base}/digest/latest`).set(reader.headers);
    expect(latest.body.data).toMatchObject({ weekStart: week, newMembers: 2, jobs: [{ title: "Backend engineer", location: null, workMode: "REMOTE" }], events: [{ title: "Pune meetup", city: "Pune" }] });
    expect(latest.body.data.posts.map((p: { id: string }) => p.id)).toEqual([quiet!.id]);
  });

  it("skips features the institution has off, and weeks with nothing to show", async () => {
    const { tenant, author, week } = await setup();
    await ctx.db.insert(jobs).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Only a job", companyName: "X", jobType: "FULL_TIME", description: "-", moderationStatus: "APPROVED" });
    await ctx.db.update(tenantSettings).set({ features: { ...defaultFeaturesFor("COLLEGE"), jobs: false } }).where(eq(tenantSettings.tenantId, tenant.id));
    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    expect(await ctx.db.select().from(tenantDigests)).toHaveLength(0);
    const latest = await request(ctx.app).get(`/api/v1/t/${tenant.slug}/digest/latest`).set(author.headers);
    expect(latest.body.data).toBeNull();
  });

  it("treats a feature missing from the stored row as its type's default", async () => {
    const { tenant, author, week } = await setup();
    const [job] = await ctx.db.insert(jobs).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, title: "Only a job", companyName: "X", jobType: "FULL_TIME", description: "-", moderationStatus: "APPROVED" }).returning();
    await ctx.db.update(tenantSettings).set({ features: { feed: true } }).where(eq(tenantSettings.tenantId, tenant.id));
    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    const [digest] = await ctx.db.select().from(tenantDigests);
    expect(digest?.content.jobIds).toEqual([job!.id]);
  });

  it("emails every member exactly once across pages", async () => {
    const { tenant, author, week } = await setup();
    await ctx.db.insert(posts).values({ tenantId: tenant.id, authorMembershipId: author.membership.id, body: "Something", moderationStatus: "APPROVED" });
    const n = DIGEST_PAGE + 3;
    await ctx.db.execute(sql`insert into users (phone_e164, email, email_verified_at) select '+9170' || lpad(g::text, 8, '0'), 'm' || g || '@example.com', now() from generate_series(1, ${n}) g`);
    await ctx.db.execute(sql`
      insert into memberships (tenant_id, user_id, full_name, batch_year, profession_type, status)
      select ${tenant.id}, id, 'Member', 2010, 'EMPLOYED', 'APPROVED' from users where email like 'm%@example.com'`);
    await runDigest(ctx, { tenantId: tenant.id, weekStart: week }, meta);
    await ctx.jobs.drain({ maxJobs: 5000 });
    const rows = await ctx.db.select({ to: outboundMessages.toEmail, status: outboundMessages.status }).from(outboundMessages);
    expect(rows).toHaveLength(n);
    expect(new Set(rows.map((r) => r.to)).size).toBe(n);
    expect(rows.every((r) => r.status === "SENT")).toBe(true);
  });

  it("is queued on Monday from 08:00 in the institution's time zone", async () => {
    const { tenant } = await setup();
    await ctx.db.update(tenants).set({ timezone: "Asia/Kolkata" }).where(eq(tenants.id, tenant.id));
    const tick = async (at: string) => {
      ctx.jobs.clear();
      await engagementTick(ctx, { at }, meta);
      return ctx.jobs.peek("digest.tenant").map((j) => j.data);
    };
    // Monday 2 Nov 2026: 07:45 in India is 02:15 UTC; 08:00 is 02:30 UTC.
    expect(await tick("2026-11-02T02:15:00Z")).toEqual([]);
    expect(await tick("2026-11-02T02:30:00Z")).toEqual([{ tenantId: tenant.id, weekStart: "2026-11-02" }]);
    expect(await tick("2026-11-03T02:30:00Z")).toEqual([]); // Tuesday
    expect(weekStartIn(new Date("2026-11-08T20:00:00Z"), "Asia/Kolkata")).toBe("2026-11-09"); // Monday already in India
  });
});
