import { sql } from "drizzle-orm";
import { loadDotenvFiles } from "../config/env";
import { createRedis } from "../redis/client";
import { createDb } from "./client";

/** Drops and recreates the public schema. Development/test only. */
export async function resetDatabase(databaseUrl: string): Promise<void> {
  const { pool, db } = createDb(databaseUrl);
  try {
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
  } finally {
    await pool.end();
  }
}

loadDotenvFiles();
if (process.env.NODE_ENV === "production") {
  console.error("Refusing to reset a production database");
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
/**
 * Clears the app's Redis state too: cached institutions, sessions and counters all point at rows that no longer exist,
 * and a stale tenant cache makes the next registration fail with a foreign-key error.
 */
async function resetRedis(redisUrl: string): Promise<number> {
  const redis = createRedis(redisUrl);
  let removed = 0;
  try {
    for (const pattern of ["cache:*", "session:*", "refresh:*", "user:sessions:*", "otp:*", "rl:*", "active:*"]) {
      let cursor = "0";
      do {
        const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
        cursor = next;
        if (batch.length) removed += await redis.del(...batch);
      } while (cursor !== "0");
    }
  } finally {
    redis.disconnect();
  }
  return removed;
}

resetDatabase(url)
  .then(() => console.log("Database reset"))
  .then(() => resetRedis(process.env.REDIS_URL ?? "redis://localhost:6379/0"))
  .then((n) => console.log(`Redis cleared (${n} keys)`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
