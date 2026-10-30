import { sql } from "drizzle-orm";
import { Router } from "express";
import type { AppContext } from "../context";

export function healthRoutes(ctx: AppContext): Router {
  const router = Router();
  router.get("/health", async (_req, res) => {
    let db = "ok";
    let redis = "ok";
    try {
      await ctx.db.execute(sql`select 1`);
    } catch {
      db = "down";
    }
    try {
      await ctx.redis.ping();
    } catch {
      redis = "down";
    }
    const healthy = db === "ok" && redis === "ok";
    res.status(healthy ? 200 : 503).json({ data: { status: healthy ? "ok" : "degraded", db, redis } });
  });
  return router;
}
