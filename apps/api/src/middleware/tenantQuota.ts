import type { RequestHandler } from "express";
import type { Config } from "../config/env";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";

export interface TenantDailyQuota {
  /** The Redis counter for one institution on one UTC day (see redis/keys.ts). */
  key: (tenantId: string, day: string) => string;
  cap: (config: Config) => number;
  /** What the member is told once it's reached. */
  message: string;
  /** What the log line says, with the institution and the count and nothing else. */
  logMessage: string;
}

/**
 * Counts one against an institution's daily quota of something all its members share, a guard against storage abuse,
 * throwing RATE_LIMITED once over it until the next UTC day. Unlike consumeRateLimit it runs in tests too. A caller that
 * can refuse for reasons of its own counts only once those have passed, so a refusal costs the institution nothing.
 */
export async function consumeTenantDailyQuota(ctx: Pick<AppContext, "redis" | "config" | "logger">, tenantId: string, quota: TenantDailyQuota): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const key = quota.key(tenantId, day);
  const n = await ctx.redis.incr(key);
  if (n === 1) await ctx.redis.expire(key, 86_400 + 3600);
  if (n > quota.cap(ctx.config)) {
    ctx.logger.warn({ tenantId, n }, quota.logMessage);
    throw AppError.rateLimited(3600, quota.message);
  }
}

/** consumeTenantDailyQuota as a step in a route, for the institution the request is for. */
export function tenantDailyQuota(ctx: AppContext, quota: TenantDailyQuota): RequestHandler {
  return async (req, _res, next) => {
    try {
      await consumeTenantDailyQuota(ctx, req.tenantCtx!.tenant.id, quota);
      next();
    } catch (err) {
      next(err);
    }
  };
}
