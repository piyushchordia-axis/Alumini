import { logoutSchema, otpRequestSchema, otpVerifySchema, refreshSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../context";
import { requireAuth } from "../middleware/auth";
import { byIp, rateLimit } from "../middleware/rateLimit";
import { noContent, ok, route } from "../middleware/validate";
import { loginWithVerifiedPhone } from "../services/auth.service";
import { requestOtp, verifyOtp } from "../services/otp.service";
import { revokeAllSessions, revokeSession, rotateRefresh } from "../services/token.service";

export function authRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post(
    "/auth/otp/request",
    rateLimit(ctx, { bucket: "otp-req-ip", limit: 20, windowSec: 3600, keyFn: byIp }),
    route({ body: otpRequestSchema }, async ({ req, res, body }) => {
      ok(res, await requestOtp(ctx, body.phone, req.ip));
    }),
  );

  router.post(
    "/auth/otp/verify",
    rateLimit(ctx, { bucket: "otp-verify-ip", limit: 60, windowSec: 900, keyFn: byIp }),
    route({ body: otpVerifySchema }, async ({ req, res, body }) => {
      const phone = await verifyOtp(ctx, body.phone, body.code, req.ip);
      const session = await loginWithVerifiedPhone(ctx, phone, { ip: req.ip, userAgent: req.header("user-agent") });
      ok(res, session);
    }),
  );

  router.post(
    "/auth/refresh",
    rateLimit(ctx, { bucket: "refresh-ip", limit: 120, windowSec: 900, keyFn: byIp }),
    route({ body: refreshSchema }, async ({ res, body }) => {
      ok(res, await rotateRefresh(ctx, body.refreshToken));
    }),
  );

  router.post(
    "/auth/logout",
    requireAuth(ctx),
    route({ body: logoutSchema }, async ({ req, res, body }) => {
      await revokeSession(ctx, req.auth!.sid, req.auth!.userId, body.refreshToken);
      noContent(res);
    }),
  );

  router.post(
    "/auth/logout-all",
    requireAuth(ctx),
    route({}, async ({ req, res }) => {
      await revokeAllSessions(ctx, req.auth!.userId);
      noContent(res);
    }),
  );

  return router;
}
