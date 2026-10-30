import { OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, type OtpRequestResultDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { normalizePhone } from "../lib/phone";
import { randomOtpCode, safeEqualHex, sha256 } from "../lib/random";
import { keys } from "../redis/keys";

export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LOCK_SECONDS = 15 * 60;
export const OTP_MAX_PER_HOUR = 5;
export const OTP_MAX_PER_DAY = 10;
export const OTP_MAX_PER_IP_HOUR = 20;

function codeHash(code: string, phone: string, pepper: string): string {
  return sha256(`${code}:${phone}:${pepper}`);
}

async function incrWithWindow(ctx: AppContext, key: string, windowSec: number): Promise<number> {
  const n = await ctx.redis.incr(key);
  if (n === 1) await ctx.redis.expire(key, windowSec);
  return n;
}

async function assertNotLocked(ctx: AppContext, phone: string): Promise<void> {
  const ttl = await ctx.redis.ttl(keys.otpLock(phone));
  if (ttl > 0) {
    throw new AppError(429, "OTP_LOCKED", "Too many incorrect attempts. Please try again later.", { retryAfterSec: ttl });
  }
}

export async function requestOtp(ctx: AppContext, rawPhone: string, ip: string | undefined): Promise<OtpRequestResultDto> {
  const { e164: phone } = normalizePhone(rawPhone);
  await assertNotLocked(ctx, phone);

  const cooldown = await ctx.redis.ttl(keys.otpCooldown(phone));
  if (cooldown > 0) {
    throw new AppError(429, "OTP_COOLDOWN", `Please wait ${cooldown}s before requesting another code`, { retryAfterSec: cooldown });
  }

  const [perHour, perDay] = await Promise.all([
    incrWithWindow(ctx, keys.otpCountHour(phone), 3600),
    incrWithWindow(ctx, keys.otpCountDay(phone), 86_400),
  ]);
  if (perHour > OTP_MAX_PER_HOUR || perDay > OTP_MAX_PER_DAY) {
    const ttl = await ctx.redis.ttl(perHour > OTP_MAX_PER_HOUR ? keys.otpCountHour(phone) : keys.otpCountDay(phone));
    throw AppError.rateLimited(Math.max(ttl, 60), "Too many codes requested for this number. Please try again later.");
  }
  if (ip) {
    const perIp = await incrWithWindow(ctx, keys.otpCountIp(ip), 3600);
    if (perIp > OTP_MAX_PER_IP_HOUR) {
      const ttl = await ctx.redis.ttl(keys.otpCountIp(ip));
      throw AppError.rateLimited(Math.max(ttl, 60), "Too many codes requested. Please try again later.");
    }
  }
  const day = new Date().toISOString().slice(0, 10);
  const global = await incrWithWindow(ctx, keys.otpGlobalDay(day), 86_400);
  if (global > ctx.config.OTP_GLOBAL_DAILY_CAP) {
    ctx.logger.error({ day, global }, "Global OTP daily cap reached");
    throw AppError.rateLimited(3600, "OTP service is temporarily unavailable. Please try again later.");
  }

  const code = ctx.config.OTP_DEV_FIXED_CODE ?? randomOtpCode();
  const otpKey = keys.otp(phone);
  await ctx.redis
    .multi()
    .del(otpKey)
    .hset(otpKey, "codeHash", codeHash(code, phone, ctx.config.OTP_PEPPER), "attempts", "0", "createdAt", String(Date.now()))
    .expire(otpKey, OTP_TTL_SECONDS)
    .set(keys.otpCooldown(phone), "1", "EX", OTP_RESEND_COOLDOWN_SECONDS)
    .exec();

  let channel: OtpRequestResultDto["channel"];
  try {
    ({ channel } = await ctx.otpSender.send(phone, code));
  } catch (err) {
    ctx.logger.error({ err, phone }, "OTP delivery failed");
    await ctx.redis.del(otpKey, keys.otpCooldown(phone));
    throw new AppError(502, "OTP_SEND_FAILED", "We could not deliver the code. Please try again in a moment.");
  }
  await ctx.redis.hset(otpKey, "channel", channel);

  const result: OtpRequestResultDto = {
    expiresInSec: OTP_TTL_SECONDS,
    resendAfterSec: OTP_RESEND_COOLDOWN_SECONDS,
    channel,
  };
  if (ctx.config.isDevelopment) result.devCode = code;
  return result;
}

/** Verifies the code and returns the normalised phone number on success. */
export async function verifyOtp(ctx: AppContext, rawPhone: string, code: string): Promise<string> {
  const { e164: phone } = normalizePhone(rawPhone);
  await assertNotLocked(ctx, phone);

  const otpKey = keys.otp(phone);
  const stored = await ctx.redis.hget(otpKey, "codeHash");
  if (!stored) {
    throw new AppError(400, "OTP_EXPIRED", "This code has expired. Please request a new one.");
  }

  const attempts = await ctx.redis.hincrby(otpKey, "attempts", 1);
  const matches = safeEqualHex(codeHash(code, phone, ctx.config.OTP_PEPPER), stored);
  if (!matches) {
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await ctx.redis.multi().del(otpKey).set(keys.otpLock(phone), "1", "EX", OTP_LOCK_SECONDS).exec();
      throw new AppError(429, "OTP_LOCKED", "Too many incorrect attempts. Please request a new code later.", {
        retryAfterSec: OTP_LOCK_SECONDS,
      });
    }
    throw new AppError(400, "OTP_INVALID", "Incorrect code", { attemptsLeft: OTP_MAX_ATTEMPTS - attempts });
  }

  await ctx.redis.del(otpKey, keys.otpCooldown(phone));
  return phone;
}
