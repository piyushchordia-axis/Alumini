import { deleteAccountSchema, pushTokenParamsSchema, pushTokenSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../context";
import { requireAuth } from "../middleware/auth";
import { noContent, ok, route } from "../middleware/validate";
import { deletePushToken, upsertPushToken } from "../repositories/users.repo";
import { deleteAccount, getMe } from "../services/auth.service";

export function meRoutes(ctx: AppContext): Router {
  const router = Router();
  router.use("/me", requireAuth(ctx));

  router.get(
    "/me",
    route({}, async ({ req, res }) => {
      ok(res, await getMe(ctx, req.auth!.userId));
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
