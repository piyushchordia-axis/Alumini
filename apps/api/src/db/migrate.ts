import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadDotenvFiles } from "../config/env";
import { createDb } from "./client";

export async function runMigrations(databaseUrl: string): Promise<void> {
  const { pool, db } = createDb(databaseUrl);
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    await migrate(db, { migrationsFolder: resolve(here, "../../drizzle") });
  } finally {
    await pool.end();
  }
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) {
  loadDotenvFiles();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  runMigrations(url)
    .then(() => {
      console.log("Migrations applied");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
