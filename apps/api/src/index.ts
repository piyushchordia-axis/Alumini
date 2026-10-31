import { createApp } from "./app";
import { createRuntime } from "./bootstrap";
import { loadConfig, loadDotenvFiles } from "./config/env";
import { startWorkers, type RunningWorkers } from "./jobs/runWorkers";
import { createLogger } from "./lib/logger";

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.isDevelopment);
  const runtime = await createRuntime({ role: "api", config, logger });
  const { ctx } = runtime;
  const app = createApp(ctx);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV, otpProvider: config.OTP_PROVIDER, workerMode: config.workerMode }, "Illuminize API listening");
  });

  // Development and the Codespaces demo run the background workers in this process; production runs `pnpm worker`.
  let workers: RunningWorkers | null = null;
  if (config.workerMode === "inline") {
    workers = await startWorkers(ctx, { redisUrl: config.REDIS_URL, concurrency: config.WORKER_CONCURRENCY });
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    server.close(async () => {
      try {
        await workers?.close();
        await runtime.close();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
