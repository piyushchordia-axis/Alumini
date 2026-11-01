import { sql } from "drizzle-orm";
import RedisMock from "ioredis-mock";
import pg from "pg";
import { createApp } from "../../src/app";
import { loadConfig, type Config } from "../../src/config/env";
import type { AppContext } from "../../src/context";
import { createDb, type Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { MemoryJobQueue } from "../../src/jobs/MemoryJobQueue";
import { createJwtSigner } from "../../src/lib/jwt";
import { NoopRealtimePublisher } from "../../src/realtime/publisher";
import { createLogger } from "../../src/lib/logger";
import type { RedisClient } from "../../src/redis/client";
import type { OtpSender, OtpSendResult } from "../../src/services/otp";
import type { MessageSenders } from "../../src/services/messages/types";
import { ConsoleChannelSender } from "../../src/services/messages/providers/ConsoleChannelSender";
import { createStorage } from "../../src/services/storage";

/** Records every OTP so tests can read the code that was "sent". */
export class CapturingOtpSender implements OtpSender {
  readonly name = "capture";
  readonly codes = new Map<string, string>();
  failNext = false;
  async send(phone: string, code: string): Promise<OtpSendResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated delivery failure");
    }
    this.codes.set(phone, code);
    return { channel: "console" };
  }
}

export interface TestContext extends AppContext {
  jobs: MemoryJobQueue;
  app: ReturnType<typeof createApp>;
  otpCapture: CapturingOtpSender;
  pool: pg.Pool;
  truncateAll: () => Promise<void>;
  dispose: () => Promise<void>;
}

let migrated = false;
let redisDbCounter = 1;

/** ioredis-mock shares one store per host:port/db, so each instance gets its own db index. */
export function newRedisMock(): RedisClient {
  return new RedisMock({ db: redisDbCounter++ }) as unknown as RedisClient;
}

export async function isDatabaseAvailable(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 2000 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

/** Providers a test can swap in (fakes with injectable fetch, capturing senders, …). */
export type TestProviders = Partial<Pick<AppContext, "push" | "storage" | "messageSenders" | "realtime">>;

/** Console senders for every channel, so message flows run in tests without providers. */
export function consoleMessageSenders(logger: AppContext["logger"]): MessageSenders {
  return { WHATSAPP: new ConsoleChannelSender("WHATSAPP", logger), SMS: new ConsoleChannelSender("SMS", logger), EMAIL: new ConsoleChannelSender("EMAIL", logger) };
}

export async function createTestContext(overrides: Record<string, string | undefined> = {}, providers: TestProviders = {}): Promise<TestContext> {
  const config: Config = loadConfig({ NODE_ENV: "test", ...overrides });
  if (!migrated) {
    await runMigrations(config.DATABASE_URL);
    migrated = true;
  }
  const { pool, db } = createDb(config.DATABASE_URL);
  const redis = newRedisMock();
  const logger = createLogger("silent", false);
  const otpCapture = new CapturingOtpSender();
  // One object is handed to createApp and returned, so fields a test sets later are seen by the routes too.
  const ctx = {
    config,
    db,
    redis,
    logger,
    jwt: createJwtSigner(config.JWT_SECRET, config.ACCESS_TOKEN_TTL_SEC),
    otpSender: otpCapture,
    storage: providers.storage ?? createStorage(config),
    push: providers.push,
    messageSenders: providers.messageSenders ?? consoleMessageSenders(logger),
    realtime: providers.realtime ?? new NoopRealtimePublisher(),
    otpCapture,
    pool,
  } as unknown as TestContext;
  ctx.jobs = new MemoryJobQueue(() => ctx);
  ctx.app = createApp(ctx);
  ctx.truncateAll = async () => {
    await truncateAllTables(db);
    await redis.flushall();
    ctx.jobs.clear();
  };
  ctx.dispose = async () => {
    await pool.end();
  };
  return ctx;
}

export async function truncateAllTables(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}
