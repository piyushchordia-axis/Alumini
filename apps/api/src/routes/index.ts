import { Router } from "express";
import type { AppContext } from "../context";
import { authRoutes } from "./auth.routes";
import { healthRoutes } from "./health.routes";
import { meRoutes } from "./me.routes";
import { platformRouter } from "./platform";
import { publicRoutes } from "./public.routes";
import { tenantRouter } from "./tenant";

export function apiRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(healthRoutes(ctx));
  router.use(publicRoutes(ctx));
  router.use(authRoutes(ctx));
  router.use(meRoutes(ctx));
  router.use("/t/:tenantSlug", tenantRouter(ctx));
  router.use("/platform", platformRouter(ctx));
  return router;
}
