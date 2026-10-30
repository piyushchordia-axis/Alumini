import type { RequestHandler } from "express";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import { isSessionAlive } from "../services/token.service";

function bearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export function requireAuth(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = bearer(req.header("authorization"));
      if (!token) throw AppError.unauthenticated();
      const claims = await ctx.jwt.verify(token);
      if (!(await isSessionAlive(ctx, claims.sid))) {
        throw new AppError(401, "SESSION_REVOKED", "Your session has ended. Please sign in again.");
      }
      req.auth = { userId: claims.sub, sid: claims.sid, isPlatformAdmin: claims.pa };
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Like requireAuth but tolerates missing/invalid tokens (req.auth stays undefined). */
export function optionalAuth(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    const token = bearer(req.header("authorization"));
    if (!token) return next();
    try {
      const claims = await ctx.jwt.verify(token);
      if (await isSessionAlive(ctx, claims.sid)) {
        req.auth = { userId: claims.sub, sid: claims.sid, isPlatformAdmin: claims.pa };
      }
    } catch {
      /* ignore */
    }
    next();
  };
}

export function requirePlatformAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(AppError.unauthenticated());
    if (!req.auth.isPlatformAdmin) return next(AppError.forbidden("Platform administrator access required"));
    next();
  };
}
