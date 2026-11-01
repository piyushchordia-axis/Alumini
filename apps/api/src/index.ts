import http from "node:http";
import { createApp } from "./app";
import { createRuntime } from "./bootstrap";
import { loadConfig, loadDotenvFiles } from "./config/env";
import { startWorkers, type RunningWorkers } from "./jobs/runWorkers";
import { createLogger } from "./lib/logger";
import { attachRealtime } from "./realtime/server";

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.isDevelopment);
  const runtime = await createRuntime({ role: "api", config, logger });
  const { ctx } = runtime;
  const app = createApp(ctx);

  // REST and live updates (Socket.IO at /socket.io) share one HTTP server.
  const server = http.createServer(app);
  const realtime = attachRealtime(server, ctx);
  ctx.realtime = realtime.publisher;
  server.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV, otpProvider: config.OTP_PROVIDER, workerMode: config.workerMode, storage: config.STORAGE_PROVIDER }, "Illuminize API listening");
    if (config.isProduction && config.STORAGE_PROVIDER === "local") {
      logger.warn("Uploads are stored on this server's disk; use STORAGE_PROVIDER=s3 when running several servers or on ephemeral disks");
    }
  });

  // Development and the Codespaces demo run the background workers in this process; production runs `pnpm worker`.
  let workers: RunningWorkers | null = null;
  if (config.workerMode === "inline") {
    workers = await startWorkers(ctx, { redisUrl: config.REDIS_URL, concurrency: config.WORKER_CONCURRENCY });
  }

  const shutdown = (signal: string) => {
    logger.info({ signal }, "Shutting down");
    void (async () => {
      try {
        // Closes sockets and the HTTP server, then background work, then connections.
        await realtime.close();
        await workers?.close();
        await runtime.close();
      } finally {
        process.exit(0);
      }
    })();
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
