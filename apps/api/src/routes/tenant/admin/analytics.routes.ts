import { analyticsQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../../context";
import { byMembership, rateLimit } from "../../../middleware/rateLimit";
import { ok, route } from "../../../middleware/validate";
import { getTenantAnalytics } from "../../../services/analytics.service";
import { exportActivityCsv, exportMembersCsv } from "../../../services/exports.service";
import { adminActor } from "../_actor";

export function analyticsRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  const exportLimit = rateLimit(ctx, { bucket: "admin-export", limit: 20, windowSec: 3600, keyFn: byMembership });

  router.get(
    "/analytics",
    route({ query: analyticsQuerySchema }, async ({ req, res, query }) => {
      ok(res, await getTenantAnalytics(ctx, req.tenantCtx!.tenant.id, query.weeks));
    }),
  );
  router.get(
    "/exports/members.csv",
    exportLimit,
    route({}, async ({ req, res }) => {
      await exportMembersCsv(ctx, req.tenantCtx!, adminActor(req), res);
    }),
  );
  router.get(
    "/exports/activity.csv",
    exportLimit,
    route({ query: analyticsQuerySchema }, async ({ req, res, query }) => {
      await exportActivityCsv(ctx, req.tenantCtx!, adminActor(req), query.weeks, res);
    }),
  );
  return router;
}
