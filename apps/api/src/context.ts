import type { Config } from "./config/env";
import type { Db } from "./db/client";
import type { JwtSigner } from "./lib/jwt";
import type { Logger } from "./lib/logger";
import type { RedisClient } from "./redis/client";
import type { OtpSender } from "./services/otp";

export interface AppContext {
  config: Config;
  db: Db;
  redis: RedisClient;
  logger: Logger;
  jwt: JwtSigner;
  otpSender: OtpSender;
}
