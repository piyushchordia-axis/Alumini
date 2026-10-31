import { tenantSlugSchema, utcToZonedWallTime, type TenantFeature } from "@illuminize/shared";
import type { RequestHandler } from "express";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import { memberActivityDays, memberships } from "../db/schema";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";
import { findMembership } from "../repositories/memberships.repo";
import { loadTenantContext } from "../services/tenant.service";

/** Resolves `:tenantSlug` into `req.tenantCtx`. Inactive tenants are hidden unless the caller is a platform admin. */
export function resolveTenant(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      const parsed = tenantSlugSchema.safeParse(req.params.tenantSlug);
      if (!parsed.success) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
      const tenantCtx = await loadTenantContext(ctx, parsed.data);
      if (tenantCtx.tenant.status !== "ACTIVE" && !req.auth?.isPlatformAdmin) {
        throw AppError.forbidden("This institution is not active", "TENANT_INACTIVE");
      }
      req.tenantCtx = tenantCtx;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function loadMembership(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth || !req.tenantCtx) {
        req.membership = null;
        return next();
      }
      req.membership = (await findMembership(ctx.db, req.tenantCtx.tenant.id, req.auth.userId)) ?? null;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireMember: RequestHandler = (req, _res, next) => {
  const m = req.membership;
  if (!m) return next(AppError.forbidden("You are not a member of this institution", "NOT_A_MEMBER"));
  switch (m.status) {
    case "APPROVED":
      return next();
    case "PENDING":
      return next(AppError.forbidden("Your membership is awaiting approval", "MEMBERSHIP_PENDING"));
    case "REJECTED":
      return next(AppError.forbidden("Your membership request was not approved", "MEMBERSHIP_REJECTED", { statusReason: m.statusReason }));
    case "SUSPENDED":
      return next(AppError.forbidden("Your membership is suspended", "MEMBERSHIP_SUSPENDED", { statusReason: m.statusReason }));
  }
};

/**
 * Any membership of the tenant, whatever its status. For the member's own data (notifications), which pending,
 * rejected and suspended members must still be able to read: that is where they learn the outcome.
 */
export const requireAnyMembership: RequestHandler = (req, _res, next) => {
  if (!req.membership) return next(AppError.forbidden("You are not a member of this institution", "NOT_A_MEMBER"));
  next();
};

export function isTenantAdmin(req: { auth?: { isPlatformAdmin: boolean }; membership?: { status: string; role: string } | null }): boolean {
  if (req.auth?.isPlatformAdmin) return true;
  return req.membership?.status === "APPROVED" && req.membership.role === "TENANT_ADMIN";
}

export const requireTenantAdmin: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(AppError.unauthenticated());
  if (!isTenantAdmin(req)) return next(AppError.forbidden("Institution administrator access required"));
  next();
};

export function requireFeature(feature: TenantFeature): RequestHandler {
  return (req, _res, next) => {
    const enabled = req.tenantCtx?.settings.features?.[feature] ?? true;
    if (!enabled) return next(AppError.forbidden(`The ${feature} feature is disabled for this institution`, "FEATURE_DISABLED"));
    next();
  };
}

/** Records member activity at most once per hour: last_active_at, plus the day in member_activity_days for billing. */
export function touchActivity(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const m = req.membership;
    if (m && m.status === "APPROVED") {
      try {
        const set = await ctx.redis.set(keys.active(m.id), "1", "EX", 3600, "NX");
        if (set === "OK") {
          const now = new Date();
          // The activity day is the calendar day in the billing time zone, so periods line up with invoices.
          const day = utcToZonedWallTime(now.toISOString(), ctx.config.BILLING_TIMEZONE).slice(0, 10) || now.toISOString().slice(0, 10);
          await Promise.all([
            ctx.db.update(memberships).set({ lastActiveAt: now }).where(eq(memberships.id, m.id)),
            ctx.db.insert(memberActivityDays).values({ tenantId: m.tenantId, membershipId: m.id, day }).onConflictDoNothing(),
          ]);
        }
      } catch (err) {
        ctx.logger.warn({ err }, "touchActivity failed");
      }
    }
    next();
  };
}
