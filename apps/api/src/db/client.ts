import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import type { Logger } from "../lib/logger";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either the root database handle or a transaction – repositories accept both. */
export type DbClient = Db | Tx;

/** A request that can't get a connection fails after this rather than waiting forever behind a saturated pool. */
const CONNECTION_TIMEOUT_MS = 10_000;

export function createDb(connectionString: string, logger?: Pick<Logger, "error">): { pool: pg.Pool; db: Db } {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS });
  const report = (err: Error) => {
    if (logger) logger.error({ err }, "A database connection failed");
    else console.error("A database connection failed:", err.message);
  };
  // Postgres ending a connection (a restart, a failover) emits an error on its client, and with no listener Node treats that
  // as uncaught and the process dies. pg-pool listens only while a client is idle or running pool.query, which leaves one
  // checked out for a transaction uncovered, so each client gets a listener for life. The transaction's next query still
  // fails, and the pool drops the client when it's released.
  pool.on("connect", (client) => client.on("error", report));
  // pg-pool passes an idle client's error on to the pool, which has to listen too. The client's listener has logged it.
  pool.on("error", () => undefined);
  const db = drizzle({ client: pool, schema });
  return { pool, db };
}

export { schema };
