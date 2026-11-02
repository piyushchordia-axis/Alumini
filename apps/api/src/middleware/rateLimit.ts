import type { Request, RequestHandler } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";

export interface RateLimitWindow {
  bucket: string;
  limit: number;
  windowSec: number;
}

export interface RateLimitOptions extends RateLimitWindow {
  keyFn: (req: Request) => string | undefined;
}

export const byIp = (req: Request): string | undefined => req.ip;
export const byUser = (req: Request): string | undefined => req.auth?.userId;
export const byMembership = (req: Request): string | undefined => req.membership?.id ?? req.auth?.userId;

/**
 * Counts `amount` against a fixed window and throws RATE_LIMITED once over the limit. The window starts when the key is
 * created, in one atomic step: setting the TTL only when the count is exactly 1 would never expire a counter that jumps
 * past 1. Disabled in tests unless RATE_LIMIT_IN_TESTS=1, which returns null.
 */
export async function consumeRateLimit(ctx: AppContext, window: RateLimitWindow, key: string, amount = 1): Promise<{ remaining: number } | null> {
  if (ctx.config.isTest && process.env.RATE_LIMIT_IN_TESTS !== "1") return null;
  const redisKey = keys.rateLimit(window.bucket, key);
  const results = await ctx.redis.multi().set(redisKey, "0", "EX", window.windowSec, "NX").incrby(redisKey, amount).exec();
  const [error, count] = results?.[1] ?? [new Error("The rate limit transaction was aborted"), 0];
  if (error) throw error;
  if ((count as number) > window.limit) throw AppError.rateLimited(Math.max(await ctx.redis.ttl(redisKey), 1));
  return { remaining: window.limit - (count as number) };
}

/** Fixed-window limiter backed by Redis. */
export function rateLimit(ctx: AppContext, opts: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const setHeaders = (remaining: number) => {
      res.setHeader("X-RateLimit-Limit", String(opts.limit));
      res.setHeader("X-RateLimit-Remaining", String(remaining));
    };
    try {
      const key = opts.keyFn(req);
      if (!key) return next();
      const used = await consumeRateLimit(ctx, opts, key);
      if (used) setHeaders(used.remaining);
      next();
    } catch (err) {
      if (err instanceof AppError && err.code === "RATE_LIMITED") setHeaders(0);
      next(err);
    }
  };
}
