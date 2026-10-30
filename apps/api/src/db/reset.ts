import { loadDotenvFiles } from "../config/env";
import { createDb } from "./client";
import { sql } from "drizzle-orm";

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
resetDatabase(url)
  .then(() => console.log("Database reset"))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
