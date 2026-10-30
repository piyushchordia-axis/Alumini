import { beforeEach, describe, expect, it } from "vitest";
import type { AppError } from "../../src/lib/errors";
import { keys } from "../../src/redis/keys";
import { OTP_MAX_ATTEMPTS, OTP_MAX_PER_HOUR, requestOtp, verifyOtp } from "../../src/services/otp.service";
import { createUnitContext } from "../helpers/unitContext";

const PHONE = "+919876543210";

describe("otp.service", () => {
  let ctx: ReturnType<typeof createUnitContext>;

  beforeEach(() => {
    ctx = createUnitContext();
  });

  it("sends a 6-digit code, stores a hash and sets a cooldown", async () => {
    const result = await requestOtp(ctx, PHONE, "1.2.3.4");
    expect(result).toMatchObject({ expiresInSec: 300, resendAfterSec: 60, channel: "console" });
    expect(result.devCode).toBeUndefined();
    const code = ctx.otpCapture.codes.get(PHONE)!;
    expect(code).toMatch(/^\d{6}$/);
    const stored = await ctx.redis.hgetall(keys.otp(PHONE));
    expect(stored.codeHash).toHaveLength(64);
    expect(stored.codeHash).not.toContain(code);
    expect(await ctx.redis.ttl(keys.otpCooldown(PHONE))).toBeGreaterThan(0);
  });

  it("normalises the phone before storing", async () => {
    await requestOtp(ctx, "98765 43210", undefined);
    expect(ctx.otpCapture.codes.has(PHONE)).toBe(true);
  });

  it("enforces the resend cooldown", async () => {
    await requestOtp(ctx, PHONE, undefined);
    await expect(requestOtp(ctx, PHONE, undefined)).rejects.toMatchObject({ code: "OTP_COOLDOWN", status: 429 });
  });

  it("enforces the hourly per-phone limit", async () => {
    for (let i = 0; i < OTP_MAX_PER_HOUR; i++) {
      await requestOtp(ctx, PHONE, undefined);
      await ctx.redis.del(keys.otpCooldown(PHONE));
    }
    await expect(requestOtp(ctx, PHONE, undefined)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("uses the fixed dev code when configured", async () => {
    ctx = createUnitContext({ OTP_DEV_FIXED_CODE: "123456" });
    await requestOtp(ctx, PHONE, undefined);
    expect(ctx.otpCapture.codes.get(PHONE)).toBe("123456");
  });

  it("rolls back when delivery fails", async () => {
    ctx.otpCapture.failNext = true;
    await expect(requestOtp(ctx, PHONE, undefined)).rejects.toMatchObject({ code: "OTP_SEND_FAILED", status: 502 });
    expect(await ctx.redis.exists(keys.otp(PHONE))).toBe(0);
    expect(await ctx.redis.exists(keys.otpCooldown(PHONE))).toBe(0);
    // user can immediately retry
    await requestOtp(ctx, PHONE, undefined);
  });

  it("verifies the correct code once and clears state", async () => {
    await requestOtp(ctx, PHONE, undefined);
    const code = ctx.otpCapture.codes.get(PHONE)!;
    await expect(verifyOtp(ctx, PHONE, code)).resolves.toBe(PHONE);
    expect(await ctx.redis.exists(keys.otp(PHONE))).toBe(0);
    expect(await ctx.redis.exists(keys.otpCooldown(PHONE))).toBe(0);
    await expect(verifyOtp(ctx, PHONE, code)).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  it("rejects wrong codes with remaining attempts and locks after too many", async () => {
    await requestOtp(ctx, PHONE, undefined);
    const code = ctx.otpCapture.codes.get(PHONE)!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 1; i < OTP_MAX_ATTEMPTS; i++) {
      const err = await verifyOtp(ctx, PHONE, wrong).catch((e: AppError) => e);
      expect(err).toMatchObject({ code: "OTP_INVALID", details: { attemptsLeft: OTP_MAX_ATTEMPTS - i } });
    }
    await expect(verifyOtp(ctx, PHONE, wrong)).rejects.toMatchObject({ code: "OTP_LOCKED", status: 429 });
    // locked: even the right code and new requests are refused
    await expect(verifyOtp(ctx, PHONE, code)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    await expect(requestOtp(ctx, PHONE, undefined)).rejects.toMatchObject({ code: "OTP_LOCKED" });
  });

  it("reports OTP_EXPIRED when nothing was requested", async () => {
    await expect(verifyOtp(ctx, PHONE, "123456")).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });
});
