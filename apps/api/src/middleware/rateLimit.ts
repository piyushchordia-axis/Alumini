import type { Request, RequestHandler } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";

export interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowSec: number;
  keyFn: (req: Request) => string | undefined;
}

export const byIp = (req: Request): string | undefined => req.ip;
export const byUser = (req: Request): string | undefined => req.auth?.userId;
export const byMembership = (req: Request): string | undefined => req.membership?.id ?? req.auth?.userId;

/** Fixed-window limiter backed by Redis INCR/EXPIRE. Disabled in tests unless RATE_LIMIT_IN_TESTS=1. */
export function rateLimit(ctx: AppContext, opts: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    if (ctx.config.isTest && process.env.RATE_LIMIT_IN_TESTS !== "1") return next();
    try {
      const key = opts.keyFn(req);
      if (!key) return next();
      const redisKey = keys.rateLimit(opts.bucket, key);
      const n = await ctx.redis.incr(redisKey);
      if (n === 1) await ctx.redis.expire(redisKey, opts.windowSec);
      res.setHeader("X-RateLimit-Limit", String(opts.limit));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(opts.limit - n, 0)));
      if (n > opts.limit) {
        const ttl = await ctx.redis.ttl(redisKey);
        throw AppError.rateLimited(Math.max(ttl, 1));
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
