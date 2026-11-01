import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import pg from "pg";
import { loadDotenvFiles } from "../config/env";

/**
 * Creates the development database (DATABASE_URL in .env) and the test database (DATABASE_URL in .env.test) when they
 * don't exist yet. Docker's Postgres creates both on its first start; a native PostgreSQL install or a CI runner may
 * not. Safe to run again. Used by `node scripts/setup-local.mjs`; run on its own with `pnpm db:create`.
 */

const redact = (url: string) => url.replace(/\/\/([^:/@]+):[^@]*@/, "//$1:***@");

async function ensureDatabase(url: string): Promise<"created" | "exists"> {
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ""));
  if (!name) throw new Error(`no database name in ${redact(url)}`);
  // Connect to the server's maintenance database to look for (and create) the target.
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString(), connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const found = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (found.rowCount) return "exists";
    await client.query(`create database "${name.replace(/"/g, '""')}"`);
    return "created";
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  loadDotenvFiles();
  const devUrl = process.env.DATABASE_URL;
  if (!devUrl) throw new Error("DATABASE_URL is not set (copy apps/api/.env.example to apps/api/.env)");
  const devName = new URL(devUrl).pathname.slice(1);
  console.log(`Development database ${devName}: ${await ensureDatabase(devUrl)}`);

  const testEnv = resolve(process.cwd(), ".env.test");
  const testUrl = process.env.TEST_DATABASE_URL ?? (existsSync(testEnv) ? parse(readFileSync(testEnv)).DATABASE_URL : undefined);
  if (!testUrl) return;
  try {
    const testName = new URL(testUrl).pathname.slice(1);
    console.log(`Test database ${testName}: ${await ensureDatabase(testUrl)}`);
  } catch (err) {
    // Not fatal: the app runs without it. Tests then need DATABASE_URL pointing at a reachable test database.
    console.warn(`Could not prepare the test database at ${redact(testUrl)}: ${(err as Error).message}`);
  }
}

main().catch((err: Error) => {
  console.error(`Could not prepare the development database: ${err.message}`);
  process.exitCode = 1;
});
