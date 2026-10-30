import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the root database handle or a transaction – repositories accept both. */
export type DbClient = Db | Tx;

export function createDb(connectionString: string): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { pool, db };
}

export { schema };
