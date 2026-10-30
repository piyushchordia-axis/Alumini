import type { Config } from "./config/env";
import type { Db } from "./db/client";
import type { Logger } from "./lib/logger";
import type { RedisClient } from "./redis/client";

export interface AppContext {
  config: Config;
  db: Db;
  redis: RedisClient;
  logger: Logger;
  /** Optional hook used by tests to intercept shutdown. */
  close?: () => Promise<void>;
}
