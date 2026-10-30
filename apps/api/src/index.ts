import { createApp } from "./app";
import { loadConfig, loadDotenvFiles } from "./config/env";
import type { AppContext } from "./context";
import { createDb } from "./db/client";
import { createJwtSigner } from "./lib/jwt";
import { createLogger } from "./lib/logger";
import { createRedis } from "./redis/client";
import { ExpoPushChannel } from "./services/notifications/ExpoPushChannel";
import { createOtpSender } from "./services/otp";

async function main(): Promise<void> {
  loadDotenvFiles();
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL, config.isDevelopment);
  const { pool, db } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  redis.on("error", (err) => logger.error({ err }, "Redis error"));

  const ctx: AppContext = {
    config,
    db,
    redis,
    logger,
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: createOtpSender(config, logger),
    push: new ExpoPushChannel(db, logger, config.EXPO_ACCESS_TOKEN),
  };
  const app = createApp(ctx);

  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV, otpProvider: config.OTP_PROVIDER }, "Illuminize API listening");
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
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
