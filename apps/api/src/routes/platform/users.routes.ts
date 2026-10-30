import { platformAdminToggleSchema, platformUsersQuerySchema, userIdParamsSchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { ok, route } from "../../middleware/validate";
import { listPlatformUsers, setPlatformAdmin } from "../../services/platform.service";

export function platformUserRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get("/users", route({ query: platformUsersQuerySchema }, async ({ res, query }) => res.json(await listPlatformUsers(ctx, query))));
  router.post("/users/:userId/platform-admin", route({ params: userIdParamsSchema, body: platformAdminToggleSchema }, async ({ req, res, params, body }) => ok(res, await setPlatformAdmin(ctx, { ...req.auth!, ip: req.ip }, params.userId, body.enabled))));
  return router;
}
