import { platformComparisonQuerySchema } from "@illuminize/shared";
import { Router } from "express";
import type { AppContext } from "../../context";
import { byUser, rateLimit } from "../../middleware/rateLimit";
import { ok, route } from "../../middleware/validate";
import { getPlatformComparison } from "../../services/analytics.service";
import { exportComparisonCsv } from "../../services/exports.service";
import { getPlatformStats } from "../../services/stats.service";

export function platformStatsRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get("/stats", route({}, async ({ res }) => ok(res, await getPlatformStats(ctx))));
  router.get("/analytics/comparison", route({ query: platformComparisonQuerySchema }, async ({ res, query }) => ok(res, await getPlatformComparison(ctx, query))));
  router.get(
    "/exports/comparison.csv",
    rateLimit(ctx, { bucket: "platform-export", limit: 30, windowSec: 3600, keyFn: byUser }),
    route({ query: platformComparisonQuerySchema }, async ({ req, res, query }) => {
      await exportComparisonCsv(ctx, { userId: req.auth!.userId, membershipId: null, ip: req.ip }, query, res);
    }),
  );
  return router;
}
