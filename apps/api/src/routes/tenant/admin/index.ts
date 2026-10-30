import { Router } from "express";
import type { AppContext } from "../../../context";
import { requireTenantAdmin } from "../../../middleware/tenant";
import { auditRoutes } from "./audit.routes";
import { dashboardRoutes } from "./dashboard.routes";
import { memberRoutes } from "./members.routes";

export function adminRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use(requireTenantAdmin);
  router.use(dashboardRoutes(ctx));
  router.use(memberRoutes(ctx));
  router.use(auditRoutes(ctx));
  return router;
}
