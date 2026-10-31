import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listPushTokensForUsers } from "../../src/repositories/users.repo";
import { auth, loginAs } from "../helpers/factories";
import { createTestContext, isDatabaseAvailable, type TestContext } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();
const PHONE = "+919876543210";

describe.skipIf(!dbAvailable)("auth flow", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });
  beforeEach(async () => {
    await ctx.truncateAll();
    ctx.otpCapture.codes.clear();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("logs in with phone + OTP, creating the user on first login", async () => {
    const req = await request(ctx.app).post("/api/v1/auth/otp/request").send({ phone: "98765 43210" });
    expect(req.status).toBe(200);
    expect(req.body.data).toMatchObject({ channel: "console", expiresInSec: 300 });

    const wrong = await request(ctx.app).post("/api/v1/auth/otp/verify").send({ phone: PHONE, code: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.code).toBe("OTP_INVALID");

    const code = ctx.otpCapture.codes.get(PHONE)!;
    const verify = await request(ctx.app).post("/api/v1/auth/otp/verify").send({ phone: PHONE, code });
    expect(verify.status).toBe(200);
    expect(verify.body.data.user).toMatchObject({ phone: PHONE, isPlatformAdmin: false });
    expect(verify.body.data.memberships).toEqual([]);
    expect(verify.body.data.accessToken).toBeTypeOf("string");

    const me = await request(ctx.app).get("/api/v1/me").set(auth(verify.body.data.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.user.id).toBe(verify.body.data.user.id);
  });

  it("flags platform admins from configuration", async () => {
    const session = await loginAs(ctx, "+919999999999");
    expect(session.user.isPlatformAdmin).toBe(true);
  });

  it("rotates refresh tokens and rejects reuse of the old one", async () => {
    const session = await loginAs(ctx, PHONE);
    const refreshed = await request(ctx.app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).not.toBe(session.refreshToken);

    const reuse = await request(ctx.app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("SESSION_REVOKED");

    const me = await request(ctx.app).get("/api/v1/me").set(auth(refreshed.body.data.accessToken));
    expect(me.status).toBe(200);
  });

  it("logout revokes the session immediately even for unexpired access tokens", async () => {
    const session = await loginAs(ctx, PHONE);
    const out = await request(ctx.app).post("/api/v1/auth/logout").set(auth(session.accessToken)).send({ refreshToken: session.refreshToken });
    expect(out.status).toBe(204);
    const me = await request(ctx.app).get("/api/v1/me").set(auth(session.accessToken));
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("SESSION_REVOKED");
    const refresh = await request(ctx.app).post("/api/v1/auth/refresh").send({ refreshToken: session.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("rejects requests without a token or with an invalid one", async () => {
    expect((await request(ctx.app).get("/api/v1/me")).status).toBe(401);
    const bad = await request(ctx.app).get("/api/v1/me").set(auth("not-a-token"));
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("validates input", async () => {
    const res = await request(ctx.app).post("/api/v1/auth/otp/request").send({ phone: "12" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const res2 = await request(ctx.app).post("/api/v1/auth/otp/verify").send({ phone: PHONE, code: "12" });
    expect(res2.status).toBe(400);
  });

  it("registers push tokens and deletes the account", async () => {
    const session = await loginAs(ctx, PHONE);
    const push = await request(ctx.app)
      .post("/api/v1/me/push-tokens")
      .set(auth(session.accessToken))
      .send({ token: "ExponentPushToken[abcdefghijklmnop]", platform: "ANDROID" });
    expect(push.status).toBe(204);
    // Looked up in bulk when notifications fan out to devices.
    const tokens = await listPushTokensForUsers(ctx.db, [session.user.id, "00000000-0000-4000-8000-000000000000"]);
    expect(tokens.map((t) => t.token)).toEqual(["ExponentPushToken[abcdefghijklmnop]"]);

    const del = await request(ctx.app).post("/api/v1/me/delete").set(auth(session.accessToken)).send({ confirm: true });
    expect(del.status).toBe(204);
    const me = await request(ctx.app).get("/api/v1/me").set(auth(session.accessToken));
    expect(me.status).toBe(401);
  });
});
