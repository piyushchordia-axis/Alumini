import { deleteAccountSchema, emailChangeSchema, profileCopyQuerySchema, pushTokenParamsSchema, pushTokenSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../context";
import { requireAuth } from "../middleware/auth";
import { byIp, byUser, rateLimit } from "../middleware/rateLimit";
import { noContent, ok, route } from "../middleware/validate";
import { deletePushToken, upsertPushToken } from "../repositories/users.repo";
import { deleteAccount, getMe } from "../services/auth.service";
import { getEmailStatus, removeEmail, requestEmailChange } from "../services/email.service";
import { getPortableProfile } from "../services/membership.service";

export function meRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use("/me", requireAuth(ctx));

  router.get(
    "/me",
    route({}, async ({ req, res }) => {
      ok(res, await getMe(ctx, req.auth!.userId));
    }),
  );

  // The caller's own details at another institution, for "Use details from …" while joining `exclude`. Null if none.
  router.get(
    "/me/profile-copy",
    route({ query: profileCopyQuerySchema }, async ({ req, res, query }) => {
      ok(res, await getPortableProfile(ctx, req.auth!.userId, query.exclude));
    }),
  );

  router.get(
    "/me/email",
    route({}, async ({ req, res }) => {
      ok(res, await getEmailStatus(ctx, req.auth!.userId));
    }),
  );

  router.post(
    "/me/email",
    rateLimit(ctx, { bucket: "email-req-user-h", limit: 3, windowSec: 3600, keyFn: byUser }),
    rateLimit(ctx, { bucket: "email-req-user-d", limit: 10, windowSec: 86_400, keyFn: byUser }),
    rateLimit(ctx, { bucket: "email-req-ip", limit: 10, windowSec: 3600, keyFn: byIp }),
    route({ body: emailChangeSchema }, async ({ req, res, body }) => {
      ok(res, await requestEmailChange(ctx, req.auth!.userId, body.email, req.ip));
    }),
  );

  router.delete(
    "/me/email",
    route({}, async ({ req, res }) => {
      ok(res, await removeEmail(ctx, req.auth!.userId, req.ip));
    }),
  );

  router.post(
    "/me/push-tokens",
    route({ body: pushTokenSchema }, async ({ req, res, body }) => {
      await upsertPushToken(ctx.db, { userId: req.auth!.userId, token: body.token, platform: body.platform });
      noContent(res);
    }),
  );

  router.delete(
    "/me/push-tokens/:token",
    route({ params: pushTokenParamsSchema }, async ({ req, res, params }) => {
      await deletePushToken(ctx.db, req.auth!.userId, params.token);
      noContent(res);
    }),
  );

  router.post(
    "/me/delete",
    route({ body: deleteAccountSchema }, async ({ req, res }) => {
      await deleteAccount(ctx, req.auth!.userId, req.ip);
      noContent(res);
    }),
  );

  return router;
}
