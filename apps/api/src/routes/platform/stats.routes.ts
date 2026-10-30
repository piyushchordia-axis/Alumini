import { Router } from "express";
import type { AppContext } from "../../context";
import { ok, route } from "../../middleware/validate";
import { getPlatformStats } from "../../services/stats.service";

export function platformStatsRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get("/stats", route({}, async ({ res }) => ok(res, await getPlatformStats(ctx))));
  return router;
}
