import { OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS, type OtpRequestResultDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { normalizePhone } from "../lib/phone";
import { randomOtpCode, safeEqualHex, sha256 } from "../lib/random";
import { keys } from "../redis/keys";

/** Wrong guesses allowed per code; the code is then discarded and the member requests a new one. */
export const OTP_MAX_ATTEMPTS = 5;
/** Codes discarded for wrong guesses within an hour before the number is locked for OTP_LOCK_SECONDS. */
export const OTP_MAX_BURNED_CODES_PER_HOUR = 3;
export const OTP_LOCK_SECONDS = 15 * 60;
/** Wrong guesses allowed from one IP per hour (across all numbers). */
export const OTP_MAX_WRONG_PER_IP_HOUR = 30;
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

/**
 * Verifies the code and returns the normalised phone number on success.
 *
 * Brute force is bounded three ways: each code allows OTP_MAX_ATTEMPTS guesses and is then discarded (attempts are
 * counted before comparing, so a burst of parallel guesses cannot get past the limit); one IP may make
 * OTP_MAX_WRONG_PER_IP_HOUR wrong guesses an hour; and a number whose codes keep being discarded is locked. Five wrong
 * guesses from someone else therefore cost the owner one code, not a 15-minute lock-out.
 */
export async function verifyOtp(ctx: AppContext, rawPhone: string, code: string, ip?: string): Promise<string> {
  const { e164: phone } = normalizePhone(rawPhone);
  await assertNotLocked(ctx, phone);
  if (ip) {
    const wrongFromIp = Number((await ctx.redis.get(keys.otpWrongIp(ip))) ?? 0);
    if (wrongFromIp >= OTP_MAX_WRONG_PER_IP_HOUR) {
      const ttl = await ctx.redis.ttl(keys.otpWrongIp(ip));
      throw AppError.rateLimited(Math.max(ttl, 60), "Too many incorrect codes. Please try again later.");
    }
  }

  const otpKey = keys.otp(phone);
  // Count the attempt first: HINCRBY is atomic, so concurrent requests each get a distinct number.
  const attempts = await ctx.redis.hincrby(otpKey, "attempts", 1);
  const stored = await ctx.redis.hget(otpKey, "codeHash");
  if (!stored) {
    // HINCRBY recreates a missing hash; remove it so no key without a TTL is left behind.
    await ctx.redis.del(otpKey);
    throw new AppError(400, "OTP_EXPIRED", "This code has expired. Please request a new one.");
  }
  if (attempts > OTP_MAX_ATTEMPTS) {
    await ctx.redis.del(otpKey);
    throw tooManyAttempts();
  }

  const matches = safeEqualHex(codeHash(code, phone, ctx.config.OTP_PEPPER), stored);
  if (!matches) {
    if (ip) await incrWithWindow(ctx, keys.otpWrongIp(ip), 3600);
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await ctx.redis.del(otpKey);
      const burned = await incrWithWindow(ctx, keys.otpBurned(phone), 3600);
      if (burned >= OTP_MAX_BURNED_CODES_PER_HOUR) {
        await ctx.redis.multi().set(keys.otpLock(phone), "1", "EX", OTP_LOCK_SECONDS).del(keys.otpBurned(phone)).exec();
        throw new AppError(429, "OTP_LOCKED", "Too many incorrect attempts. Please try again later.", { retryAfterSec: OTP_LOCK_SECONDS });
      }
      throw tooManyAttempts();
    }
    throw new AppError(400, "OTP_INVALID", "Incorrect code", { attemptsLeft: OTP_MAX_ATTEMPTS - attempts });
  }

  await ctx.redis.del(otpKey, keys.otpCooldown(phone));
  return phone;
}

function tooManyAttempts(): AppError {
  return new AppError(429, "OTP_LOCKED", "Too many incorrect attempts. Please request a new code.", { retryAfterSec: 0, requestNewCode: true });
}
