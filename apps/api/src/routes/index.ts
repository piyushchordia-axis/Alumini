import { Router } from "express";
import type { AppContext } from "../context";
import { healthRoutes } from "./health.routes";
import { publicRoutes } from "./public.routes";

export function apiRouter(ctx: AppContext): Router {
  const router = Router();
  router.use(healthRoutes(ctx));
  router.use(publicRoutes(ctx));
  return router;
}
