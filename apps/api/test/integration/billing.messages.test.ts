import type { MessageChannel } from "@illuminize/shared";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outboundMessages } from "../../src/db/schema";
import { ConsoleChannelSender } from "../../src/services/messages/providers/ConsoleChannelSender";
import { tenantOutboundChannels } from "../../src/services/billing.service";
import { auth, createTenant, loginAs, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("subscription channels and message metering", () => {
  let ctx: TestContext;
  let H: Record<string, string>;
  beforeAll(async () => {
    // This server can send WhatsApp and email, not SMS.
    const logger = (await import("../../src/lib/logger")).createLogger("silent", false);
    ctx = await createTestContext({}, { messageSenders: { WHATSAPP: new ConsoleChannelSender("WHATSAPP", logger), EMAIL: new ConsoleChannelSender("EMAIL", logger) } });
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    H = auth((await loginAs(ctx, "+919999999999")).accessToken);
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const api = () => request(ctx.app);

  async function sent(tenantId: string | null, channel: MessageChannel, at: string, status: "SENT" | "DELIVERED" | "READ" | "FAILED" | "CANCELLED" = "SENT") {
    await ctx.db.insert(outboundMessages).values({ tenantId, type: "PLATFORM_TEST", status, channels: [channel], channel, sentAt: status === "FAILED" || status === "CANCELLED" ? null : new Date(at), payload: {} });
  }

  it("stores channels and rates on plans and limits outbound channels to plan ∩ configured", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/platform/tenants/${tenant.id}/billing`;
    expect(await tenantOutboundChannels(ctx, tenant.id)).toEqual([]); // no plan: in-app and push only

    const plan = await api()
      .post(`${base}/plans`)
      .set(H)
      .send({ billingModel: "FREE", effectiveFrom: "2026-01-01", includedChannels: ["SMS", "EMAIL", "EMAIL"], messageRatesMinor: { EMAIL: 0.5, SMS: 18 } });
    expect(plan.status).toBe(201);
    expect(plan.body.data).toMatchObject({ includedChannels: ["SMS", "EMAIL"], messageRatesMinor: { EMAIL: 0.5, SMS: 18 } });
    expect(await tenantOutboundChannels(ctx, tenant.id, "2026-03-01")).toEqual(["EMAIL"]); // SMS isn't configured here

    const admin = await memberSession(ctx, tenant.id, { role: "TENANT_ADMIN" });
    const settings = await api().get(`/api/v1/t/${tenant.slug}/admin/settings`).set(admin.headers);
    expect(settings.body.data.outboundChannels).toEqual(["EMAIL"]);

    // A plan starting later takes over on its first day, without any write.
    await api().post(`${base}/plans`).set(H).send({ billingModel: "FREE", effectiveFrom: "2026-09-01", includedChannels: ["WHATSAPP", "EMAIL"] });
    expect(await tenantOutboundChannels(ctx, tenant.id, "2026-08-31")).toEqual(["EMAIL"]);
    expect(await tenantOutboundChannels(ctx, tenant.id, "2026-09-01")).toEqual(["WHATSAPP", "EMAIL"]);

    const upd = await api().patch(`/api/v1/platform/billing/plans/${plan.body.data.id}`).set(H).send({ includedChannels: [] });
    expect(upd.body.data.includedChannels).toEqual([]);
    expect(await tenantOutboundChannels(ctx, tenant.id, "2026-03-01")).toEqual([]);
    expect((await api().post(`${base}/plans`).set(H).send({ billingModel: "FREE", effectiveFrom: "2026-01-01", includedChannels: ["PIGEON"] })).status).toBe(400);
  });

  it("counts delivered messages per channel in the period and charges them", async () => {
    const { tenant } = await createTenant(ctx);
    const { tenant: other } = await createTenant(ctx);
    const base = `/api/v1/platform/tenants/${tenant.id}/billing`;
    await api()
      .post(`${base}/plans`)
      .set(H)
      .send({ billingModel: "FLAT_FEE", flatFeeMinor: 100000, effectiveFrom: "2026-01-01", includedChannels: ["WHATSAPP", "EMAIL"], messageRatesMinor: { WHATSAPP: 80, EMAIL: 0.5 } });

    // July in India: 1 Jul 00:00 IST = 30 Jun 18:30 UTC; 31 Jul 23:59 IST = 31 Jul 18:29 UTC.
    await sent(tenant.id, "WHATSAPP", "2026-06-30T18:30:00Z");
    await sent(tenant.id, "WHATSAPP", "2026-07-15T10:00:00Z", "DELIVERED");
    await sent(tenant.id, "WHATSAPP", "2026-07-20T10:00:00Z", "READ");
    await sent(tenant.id, "EMAIL", "2026-07-02T10:00:00Z");
    await sent(tenant.id, "EMAIL", "2026-07-03T10:00:00Z");
    await sent(tenant.id, "EMAIL", "2026-07-31T18:31:00Z"); // 1 Aug in India
    await sent(tenant.id, "SMS", "2026-06-30T18:29:00Z"); // 30 Jun in India
    await sent(tenant.id, "WHATSAPP", "2026-07-10T10:00:00Z", "FAILED");
    await sent(tenant.id, "EMAIL", "2026-07-10T10:00:00Z", "CANCELLED");
    await sent(other.id, "WHATSAPP", "2026-07-10T10:00:00Z");
    await sent(null, "EMAIL", "2026-07-10T10:00:00Z"); // platform messages (no tenant)

    const july = await api().get(`${base}/usage?from=2026-07-01&to=2026-07-31`).set(H);
    expect(july.body.data).toMatchObject({
      messages: { WHATSAPP: 3, SMS: 0, EMAIL: 2 },
      memberAmountMinor: 100000,
      messageAmountMinor: 3 * 80 + 1, // 2 emails × 0.5 paise
      estimatedAmountMinor: 100241,
    });
    const snap = await api().post(`${base}/snapshots`).set(H).send({ periodStart: "2026-07-01", periodEnd: "2026-07-31" });
    expect(snap.body.data).toMatchObject({ messageCounts: { WHATSAPP: 3, SMS: 0, EMAIL: 2 }, messageAmountMinor: 241, amountMinor: 100241 });
  });
});
