import { createApp } from "./app";
import { loadConfig, loadDotenvFiles } from "./config/env";
import type { AppContext } from "./context";
import { createDb } from "./db/client";
import { createJwtSigner } from "./lib/jwt";
import { createLogger } from "./lib/logger";
import { createRedis } from "./redis/client";
import { ExpoPushChannel } from "./services/notifications/ExpoPushChannel";
import { createOtpSender } from "./services/otp";
import { createStorage } from "./services/storage";

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.isDevelopment);
  const { pool, db } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  redis.on("error", (err) => logger.error({ err }, "Redis error"));

  const push = new ExpoPushChannel(db, redis, logger, config.EXPO_ACCESS_TOKEN);
  const ctx: AppContext = {
    config,
    db,
    redis,
    logger,
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: createOtpSender(config, logger),
    storage: createStorage(config),
    push,
  };
  const app = createApp(ctx);

  // Expo delivery receipts: drop tokens of uninstalled apps. (Moves to the background worker once it exists.)
  const receipts = setInterval(() => {
    push.checkReceipts().catch((err) => logger.warn({ err }, "push receipt check failed"));
  }, 5 * 60 * 1000);
  receipts.unref();

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV, otpProvider: config.OTP_PROVIDER }, "Illuminize API listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    clearInterval(receipts);
    server.close(async () => {
      try {
        await redis.quit();
        await pool.end();
      } finally {
        process.exit(0);
      }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
