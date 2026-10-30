import { Router } from "express";
import type { AppContext } from "../../context";
import { requireAuth } from "../../middleware/auth";
import { loadMembership, resolveTenant, touchActivity } from "../../middleware/tenant";
import { adminRoutes } from "./admin";
import { membershipRoutes } from "./membership.routes";
import { notificationRoutes } from "./notifications.routes";

/** Mounted at /t/:tenantSlug — every route below requires a signed-in user and a resolvable tenant. */
export function tenantRouter(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use(requireAuth(ctx), resolveTenant(ctx), loadMembership(ctx), touchActivity(ctx));

  router.use(membershipRoutes(ctx));
  router.use(notificationRoutes(ctx));
  router.use("/admin", adminRoutes(ctx));
  return router;
}
