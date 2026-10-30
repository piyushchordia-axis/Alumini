import { Router } from "express";
import type { AppContext } from "../../../context";
import { ok, route } from "../../../middleware/validate";
import { getTenantDashboard } from "../../../services/stats.service";

export function dashboardRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.get(
    "/dashboard",
    route({}, async ({ req, res }) => {
      ok(res, await getTenantDashboard(ctx, req.tenantCtx!.tenant.id));
    }),
  );
  return router;
}
