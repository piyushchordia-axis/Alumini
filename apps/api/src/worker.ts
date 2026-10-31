import http from "node:http";
import { sql } from "drizzle-orm";
import { createRuntime } from "./bootstrap";
import { loadConfig, loadDotenvFiles } from "./config/env";
import { startWorkers } from "./jobs/runWorkers";
import { createLogger } from "./lib/logger";

/**
 * The background worker process (`pnpm worker`, or `node dist/worker.js` from the API image). Runs the job handlers
 * and scheduled jobs; never runs migrations. GET /health on WORKER_HEALTH_PORT reports database and Redis status.
 */
async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.isDevelopment);
  const runtime = await createRuntime({ role: "worker", config, logger });
  const { ctx } = runtime;
  const workers = await startWorkers(ctx, { redisUrl: config.REDIS_URL, concurrency: config.WORKER_CONCURRENCY });

  const health = http.createServer(async (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    const [dbOk, redisOk] = await Promise.all([
      ctx.db.execute(sql`select 1`).then(() => true, () => false),
      ctx.redis.ping().then(() => true, () => false),
    ]);
    res.writeHead(dbOk && redisOk ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ role: "worker", db: dbOk ? "ok" : "down", redis: redisOk ? "ok" : "down" }));
  });
  health.listen(config.WORKER_HEALTH_PORT, () => logger.info({ port: config.WORKER_HEALTH_PORT }, "Illuminize worker running"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Worker shutting down");
    health.close();
    void (async () => {
      try {
        await workers.close();
        await runtime.close();
      } finally {
        process.exit(0);
      }
    })();
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
