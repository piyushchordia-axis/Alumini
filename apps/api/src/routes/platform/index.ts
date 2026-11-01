import { Router } from "express";
import type { AppContext } from "../../context";
import { requireAuth, requirePlatformAdmin } from "../../middleware/auth";
import { platformAuditRoutes } from "./audit.routes";
import { platformBillingRoutes } from "./billing.routes";
import { platformJobRoutes } from "./jobs.routes";
import { platformMessageRoutes } from "./messages.routes";
import { platformStatsRoutes } from "./stats.routes";
import { platformTenantRoutes } from "./tenants.routes";
import { platformUserRoutes } from "./users.routes";

/** Mounted at /platform — Illuminize staff only. */
export function platformRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(requireAuth(ctx), requirePlatformAdmin());
  router.use(platformTenantRoutes(ctx));
  router.use(platformBillingRoutes(ctx));
  router.use(platformStatsRoutes(ctx));
  router.use(platformUserRoutes(ctx));
  router.use(platformAuditRoutes(ctx));
  router.use(platformMessageRoutes(ctx));
  router.use(platformJobRoutes(ctx));
  return router;
}
