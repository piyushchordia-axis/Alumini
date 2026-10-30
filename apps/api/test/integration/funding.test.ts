import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("funding listings", () => {
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
  const api = () => request(ctx.app);

  it("creates seeking and offering listings with validation", async () => {
    const { tenant } = await createTenant(ctx);
    const base = `/api/v1/t/${tenant.slug}/funding`;
    const founder = await memberSession(ctx, tenant.id);
    const investor = await memberSession(ctx, tenant.id);

    const noStage = await api().post(base).set(founder.headers).send({ kind: "SEEKING", title: "Acme AI", pitch: "We build AI for supply chains." });
    expect(noStage.status).toBe(400);
    const badAmounts = await api().post(base).set(founder.headers).send({ kind: "SEEKING", stage: "SEED", title: "Acme AI", pitch: "We build AI for supply chains.", amountMinMinor: 100, amountMaxMinor: 10 });
    expect(badAmounts.status).toBe(400);

    const seeking = await api().post(base).set(founder.headers).send({ kind: "SEEKING", stage: "SEED", title: "Acme AI", pitch: "We build AI for supply chains.", amountMinMinor: 1000000, amountMaxMinor: 5000000, sectors: ["ai"] });
    expect(seeking.status).toBe(201);
    expect(seeking.body.data).toMatchObject({ kind: "SEEKING", stage: "SEED", currency: "INR", sectors: ["ai"], moderationStatus: "APPROVED" });

    const offering = await api().post(base).set(investor.headers).send({ kind: "OFFERING", title: "Angel cheques", pitch: "Writing small cheques into alumni startups.", currency: "usd" });
    expect(offering.status).toBe(201);
    expect(offering.body.data).toMatchObject({ kind: "OFFERING", stage: null, currency: "USD" });

    expect((await api().get(base).set(founder.headers)).body.data).toHaveLength(2);
    expect((await api().get(`${base}?kind=OFFERING`).set(founder.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?stage=SEED`).set(founder.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?q=supply`).set(founder.headers)).body.data).toHaveLength(1);

    const edit = await api().patch(`${base}/${seeking.body.data.id}`).set(founder.headers).send({ stage: "SERIES_A" });
    expect(edit.body.data.stage).toBe("SERIES_A");
    expect((await api().patch(`${base}/${seeking.body.data.id}`).set(investor.headers).send({ stage: "IDEA" })).status).toBe(403);

    await api().post(`${base}/${seeking.body.data.id}/close`).set(founder.headers);
    expect((await api().get(base).set(investor.headers)).body.data).toHaveLength(1);
    expect((await api().get(`${base}?includeClosed=true`).set(investor.headers)).body.data).toHaveLength(2);
    expect((await api().delete(`${base}/${offering.body.data.id}`).set(investor.headers)).status).toBe(204);
  });
});
