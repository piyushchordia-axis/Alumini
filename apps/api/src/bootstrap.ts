import type { Config } from "./config/env";
import type { AppContext } from "./context";
import { createDb } from "./db/client";
import { BullJobQueue } from "./jobs/BullJobQueue";
import { createBullConnection } from "./jobs/connection";
import { createJwtSigner } from "./lib/jwt";
import type { Logger } from "./lib/logger";
import { Emitter } from "@socket.io/redis-emitter";
import { NoopRealtimePublisher, RedisEmitterPublisher } from "./realtime/publisher";
import { createRedis } from "./redis/client";
import { createMessageSenders } from "./services/messages";
import { ExpoPushChannel } from "./services/notifications/ExpoPushChannel";
import { createPaymentProvider, paymentPurposeHandlers } from "./services/payments";
import { createOtpSender } from "./services/otp";
import { createStorage } from "./services/storage";

export interface Runtime {
  ctx: AppContext;
  close(): Promise<void>;
}

/** Builds the shared runtime (database, Redis, job queue and providers) for the API or the worker process. */
export async function createRuntime(o: { role: "api" | "worker"; config: Config; logger: Logger }): Promise<Runtime> {
  const { config, logger } = o;
  if (config.isProduction && !config.webAppUrl && o.role === "api") {
    logger.warn("WEB_APP_URL is not set: email confirmation, invites and digests are off until it points at the web app");
  }
  const { pool, db } = createDb(config.DATABASE_URL);
  const redis = createRedis(config.REDIS_URL);
  redis.on("error", (err) => logger.error({ err }, "Redis error"));
  const producer = createBullConnection(config.REDIS_URL, "producer");
  producer.on("error", (err) => logger.error({ err }, "Job queue Redis error"));
  const jobs = new BullJobQueue({ connection: producer });
  // The API attaches its Socket.IO server and swaps in its publisher; a separate worker publishes through Redis.
  const emitterRedis = o.role === "worker" ? createRedis(config.REDIS_URL) : null;
  emitterRedis?.on("error", (err) => logger.error({ err }, "Realtime emitter Redis error"));

  const ctx: AppContext = {
    config,
    db,
    redis,
    logger,
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: createOtpSender(config, logger),
    storage: createStorage(config),
    jobs,
    push: new ExpoPushChannel(db, redis, logger, config.EXPO_ACCESS_TOKEN),
    messageSenders: createMessageSenders(config, logger),
    realtime: emitterRedis ? new RedisEmitterPublisher(new Emitter(emitterRedis)) : new NoopRealtimePublisher(),
    payments: { provider: createPaymentProvider(config, logger), purposes: paymentPurposeHandlers },
  };

  return {
    ctx,
    async close() {
      await jobs.close().catch(() => undefined);
      await producer.quit().catch(() => undefined);
      await emitterRedis?.quit().catch(() => undefined);
      await redis.quit().catch(() => undefined);
      await pool.end();
    },
  };
}
