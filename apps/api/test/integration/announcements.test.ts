import type { MessageChannel } from "@illuminize/shared";
import { eq, sql } from "drizzle-orm";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notifications, outboundMessages, postAnnouncements, posts, tenantBillingPlans, users } from "../../src/db/schema";
import type { RealtimePublisher } from "../../src/realtime/publisher";
import type { ChannelSender, RenderedMessage } from "../../src/services/messages/types";
import { createTenant, memberSession } from "../helpers/factories";
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

class CapturingRealtime implements RealtimePublisher {
  readonly events: Array<{ event: string; payload: unknown }> = [];
  emit(_to: string | string[], event: string, ...args: unknown[]) {
    this.events.push({ event, payload: args[0] });
  }
  disconnect() {}
}

describe.skipIf(!dbAvailable)("announcements", () => {
  let ctx: TestContext;
  const email = new Capture("EMAIL");
  let realtime: CapturingRealtime;
  beforeAll(async () => {
    ctx = await createTestContext({}, { messageSenders: { EMAIL: email } });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    email.sent.length = 0;
    realtime = new CapturingRealtime();
    ctx.realtime = realtime as unknown as TestContext["realtime"];
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  async function setup(channels: MessageChannel[] = []) {
    const { tenant } = await createTenant(ctx, { name: "Announce University" });
    if (channels.length) await ctx.db.insert(tenantBillingPlans).values({ tenantId: tenant.id, billingModel: "FREE", effectiveFrom: "2020-01-01", includedChannels: channels });
    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const members = await Promise.all([0, 1, 2].map(() => memberSession(ctx, tenant.id)));
    return { tenant, admin, members, base: `/api/v1/t/${tenant.slug}` };
  }

  it("only admins post announcements; they're pinned and reach every member in the app once", async () => {
    const { tenant, admin, members, base } = await setup();
    const denied = await api().post(`${base}/posts`).set(members[0]!.headers).send({ body: "Not allowed", announcement: {} });
    expect(denied.status).toBe(403);
    await memberSession(ctx, tenant.id, { status: "PENDING" });

    const res = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Convocation is on 12 December. Gates open at 9am.", announcement: {} });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: "ANNOUNCEMENT", isPinned: true, moderationStatus: "APPROVED" });
    await ctx.jobs.drain();
    await ctx.jobs.drain(); // a re-run of the same work adds nothing
    const rows = await ctx.db.select().from(notifications).where(eq(notifications.type, "ANNOUNCEMENT"));
    expect(rows.map((r) => r.recipientMembershipId).sort()).toEqual(members.map((m) => m.membership.id).sort()); // not the author, not pending members
    expect(rows[0]).toMatchObject({ title: "📣 Announce University", body: "Convocation is on 12 December. Gates open at 9am.", data: { postId: res.body.data.id } });
    expect(realtime.events.filter((e) => e.event === "notification:bulk")).toHaveLength(1);
    const [ann] = await ctx.db.select().from(postAnnouncements);
    expect(ann).toMatchObject({ notifiedCount: 3, messagedCount: 0, fanoutStartedAt: expect.any(Date), fanoutFinishedAt: expect.any(Date) });

    // Pinned strip on the feed, and the moderation list knows its kind.
    const feed = await api().get(`${base}/posts`).set(members[0]!.headers);
    expect(feed.body.pinned.map((p: { id: string }) => p.id)).toEqual([res.body.data.id]);
    const queue = await ctx.db.execute<{ kind: string }>(sql`select kind from moderation_items where id = ${res.body.data.id}`);
    expect(queue.rows[0]!.kind).toBe("ANNOUNCEMENT");
  });

  it("sends by email only when the plan allows it, to confirmed addresses of members who haven't opted out", async () => {
    const blocked = await setup();
    const no = await api().post(`${blocked.base}/posts`).set(blocked.admin.headers).send({ body: "Hello", announcement: { channels: ["EMAIL"] } });
    expect(no.status).toBe(400);

    await ctx.truncateAll();
    const { admin, members, base } = await setup(["EMAIL", "WHATSAPP"]);
    const [a, b, c] = members as [(typeof members)[0], (typeof members)[0], (typeof members)[0]];
    await ctx.db.update(users).set({ email: "a@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, a.user.id));
    await ctx.db.update(users).set({ email: "b@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, b.user.id));
    await api().patch(`${base}/notification-prefs`).set(b.headers).send({ announcementMessages: false });
    expect(c.user.id).toBeDefined(); // c has no email: in-app only
    const audience = await api().get(`${base}/admin/announcements/audience`).set(admin.headers);
    expect(audience.body.data).toEqual({ members: 3, withEmail: 1, withPhone: 2, channels: ["EMAIL"] }); // WhatsApp isn't configured on this server

    const res = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Alumni meet on Saturday at the main auditorium.", announcement: { channels: ["EMAIL"], pin: false } });
    expect(res.body.data.isPinned).toBe(false);
    await ctx.jobs.drain();
    expect(email.sent.map((m) => m.to)).toEqual(["a@example.com"]);
    const sent = email.sent[0]!;
    expect(sent.subject).toBe("Announce University: Alumni meet on Saturday at the main auditorium.");
    expect(sent.html).toContain(`${ctx.config.webAppUrl}/t/`);
    expect(sent.html).toContain(`/app/feed/${res.body.data.id}`);
    expect(sent.headers?.["List-Unsubscribe"]).toMatch(/\/api\/v1\/unsubscribe\?token=/);
    expect(sent.text).toContain("/unsubscribe?token=");
    expect(await ctx.db.select().from(notifications).where(eq(notifications.type, "ANNOUNCEMENT"))).toHaveLength(3);
    expect((await ctx.db.select().from(postAnnouncements))[0]).toMatchObject({ notifiedCount: 3, messagedCount: 1 });
  });

  it("stops if the announcement is removed before it goes out, and cancels queued emails", async () => {
    const { admin, members, base } = await setup(["EMAIL"]);
    await ctx.db.update(users).set({ email: "a@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, members[0]!.user.id));
    const removed = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Oops", announcement: {} });
    await ctx.db.update(posts).set({ moderationStatus: "REMOVED" }).where(eq(posts.id, removed.body.data.id));
    await ctx.jobs.drain();
    expect(await ctx.db.select().from(notifications)).toHaveLength(0);

    const later = await api().post(`${base}/posts`).set(admin.headers).send({ body: "Second try", announcement: { channels: ["EMAIL"] } });
    await ctx.jobs.drain({ maxJobs: 1 }); // the fan-out queues the email
    await ctx.db.update(posts).set({ moderationStatus: "REMOVED" }).where(eq(posts.id, later.body.data.id));
    await ctx.jobs.drain();
    expect(email.sent).toHaveLength(0);
    expect((await ctx.db.select().from(outboundMessages))[0]).toMatchObject({ status: "CANCELLED", lastError: "announcement removed" });
  });

  it("keeps every pinned post visible: the strip shows five, the rest stay in the feed", async () => {
    const { admin, members, base } = await setup();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await api().post(`${base}/posts`).set(admin.headers).send({ body: `Notice ${i}`, announcement: {} })).body.data.id);
    const page = await api().get(`${base}/posts?limit=20`).set(members[0]!.headers);
    expect(page.body.pinned).toHaveLength(5);
    const all = [...page.body.pinned, ...page.body.data].map((p: { id: string }) => p.id);
    expect(new Set(all)).toEqual(new Set(ids));
    expect(all).toHaveLength(7);
  });
});
