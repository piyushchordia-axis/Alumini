import type { Config } from "./config/env";
import type { Db } from "./db/client";
import type { JwtSigner } from "./lib/jwt";
import type { Logger } from "./lib/logger";
import type { RedisClient } from "./redis/client";
import type { NotificationChannel } from "./services/notifications/NotificationChannel";
import type { OtpSender } from "./services/otp";
import type { StorageProvider } from "./services/storage";

export interface AppContext {
  config: Config;
  db: Db;
  redis: RedisClient;
  logger: Logger;
  jwt: JwtSigner;
  otpSender: OtpSender;
  storage: StorageProvider;
  /** Optional secondary notification channel (Expo push). */
  push?: NotificationChannel;
}
