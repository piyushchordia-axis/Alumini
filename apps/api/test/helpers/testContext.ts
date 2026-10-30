import { sql } from "drizzle-orm";
import RedisMock from "ioredis-mock";
import pg from "pg";
import { createApp } from "../../src/app";
import { loadConfig, type Config } from "../../src/config/env";
import type { AppContext } from "../../src/context";
import { createDb, type Db } from "../../src/db/client";
import { runMigrations } from "../../src/db/migrate";
import { createLogger } from "../../src/lib/logger";
import type { RedisClient } from "../../src/redis/client";

export interface TestContext extends AppContext {
  app: ReturnType<typeof createApp>;
  pool: pg.Pool;
  truncateAll: () => Promise<void>;
  dispose: () => Promise<void>;
}

let migrated = false;

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

export async function createTestContext(overrides: Record<string, string | undefined> = {}): Promise<TestContext> {
  const config: Config = loadConfig({ NODE_ENV: "test", ...overrides });
  if (!migrated) {
    await runMigrations(config.DATABASE_URL);
    migrated = true;
  }
  const { pool, db } = createDb(config.DATABASE_URL);
  const redis = new RedisMock() as unknown as RedisClient;
  const logger = createLogger("silent", false);
  const base: AppContext = { config, db, redis, logger };
  const app = createApp(base);

  const truncateAll = async () => {
    await truncateAllTables(db);
    await redis.flushall();
  };

  return {
    ...base,
    app,
    pool,
    truncateAll,
    dispose: async () => {
      await pool.end();
    },
  };
}

export async function truncateAllTables(db: Db): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'`,
  );
  const names = rows.rows.map((r) => `"${r.tablename}"`);
  if (names.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE TABLE ${names.join(", ")} RESTART IDENTITY CASCADE`));
}
