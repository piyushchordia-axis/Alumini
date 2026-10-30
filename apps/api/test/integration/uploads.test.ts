import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTenant, memberSession } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe.skipIf(!dbAvailable)("image uploads", () => {
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

  it("stores valid images and serves them back", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const res = await api().post(`/api/v1/t/${tenant.slug}/uploads`).set(member.headers).attach("file", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(new RegExp(`/uploads/${tenant.id}/[0-9a-f-]+\\.png$`));
    const path = new URL(res.body.data.url).pathname;
    const served = await api().get(path);
    expect(served.status).toBe(200);
    expect(served.headers["content-type"]).toContain("image/png");
  });

  it("rejects non-images and spoofed content types", async () => {
    const { tenant } = await createTenant(ctx);
    const member = await memberSession(ctx, tenant.id);
    const base = `/api/v1/t/${tenant.slug}/uploads`;
    const text = await api().post(base).set(member.headers).attach("file", Buffer.from("hello"), { filename: "a.txt", contentType: "text/plain" });
    expect(text.status).toBe(415);
    const spoof = await api().post(base).set(member.headers).attach("file", Buffer.alloc(64, 7), { filename: "a.png", contentType: "image/png" });
    expect(spoof.status).toBe(415);
    expect(spoof.body.error.code).toBe("UNSUPPORTED_MEDIA");
    const missing = await api().post(base).set(member.headers);
    expect(missing.status).toBe(400);
  });
});
