import { Writable } from "node:stream";
import { sql } from "drizzle-orm";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, type Db } from "../../src/db/client";
import { createLogger } from "../../src/lib/logger";
import { runInTransaction } from "../../src/lib/transaction";
import { isDatabaseAvailable } from "../helpers/testContext";

const dbAvailable = await isDatabaseAvailable();

describe.skipIf(!dbAvailable)("the database pool", () => {
  const url = () => process.env.DATABASE_URL!;
  const logger = createLogger("silent", false);
  const uncaught = vi.fn();
  beforeEach(() => {
    uncaught.mockClear();
    process.on("uncaughtException", uncaught);
  });
  afterEach(() => {
    process.off("uncaughtException", uncaught);
  });

  /** What Postgres does to its connections when it restarts or fails over. */
  async function terminate(pid: number) {
    const admin = new pg.Client({ connectionString: url() });
    await admin.connect();
    await admin.query("select pg_terminate_backend($1)", [pid]);
    await admin.end();
  }
  const backendPid = async (db: Pick<Db, "execute">) => (await db.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0]!.pid;

  it("survives Postgres ending an idle connection, logs it once and keeps working", async () => {
    const error = vi.fn();
    const { pool, db } = createDb(url(), { error });
    try {
      const pid = await backendPid(db);
      await terminate(pid);
      await vi.waitFor(() => expect(error).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 100));
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]![0].err).toBeInstanceOf(Error);
      expect(uncaught).not.toHaveBeenCalled();

      // The pool drops the dead connection and opens a new one.
      expect(await backendPid(db)).not.toBe(pid);
    } finally {
      await pool.end();
    }
  });

  it("survives Postgres ending a connection held by a transaction between queries, and the transaction fails", async () => {
    const error = vi.fn();
    const { pool, db } = createDb(url(), { error });
    try {
      const run = runInTransaction({ db, logger }, async (tx) => {
        await terminate(await backendPid(tx));
        // Like a send waiting on Redis: nothing is running on the connection when it goes.
        await vi.waitFor(() => expect(error).toHaveBeenCalled());
        return tx.execute(sql`select 1`);
      });
      await expect(run).rejects.toThrow();
      expect(uncaught).not.toHaveBeenCalled();
      expect(await backendPid(db)).toBeGreaterThan(0);
      expect(pool.totalCount).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it("survives Postgres ending a connection in the middle of a transaction's query, and the query fails", async () => {
    const error = vi.fn();
    const { pool, db } = createDb(url(), { error });
    try {
      const run = runInTransaction({ db, logger }, async (tx) => {
        const pid = await backendPid(tx);
        const asleep = tx.execute(sql`select pg_sleep(30)`);
        await terminate(pid);
        return asleep;
      });
      await expect(run).rejects.toThrow();
      expect(uncaught).not.toHaveBeenCalled();
      expect(await backendPid(db)).toBeGreaterThan(0);
    } finally {
      await pool.end();
    }
  });

  it("has listeners even with no logger, because without them the process dies", async () => {
    const { pool } = createDb(url());
    const printed = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(pool.listenerCount("error")).toBeGreaterThan(0);
      const client = await pool.connect();
      expect(client.listenerCount("error")).toBe(1);
      client.emit("error", new Error("Connection terminated"));
      expect(printed).toHaveBeenCalledTimes(1);
      expect(uncaught).not.toHaveBeenCalled();
      client.release(true);
    } finally {
      printed.mockRestore();
      await pool.end();
    }
  });

  it("logs a failed connection without the client pg-pool hangs on the error", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const { pool, db } = createDb(url(), createLogger("error", false, stream));
    try {
      await terminate(await backendPid(db));
      await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0));
      await new Promise((r) => setTimeout(r, 100));
      expect(lines.join("")).toContain("A database connection failed");
      expect(lines.join("")).not.toContain("connectionParameters");
    } finally {
      await pool.end();
    }
  });

  it("sets a connection timeout, so a request behind a full pool fails rather than hangs", async () => {
    const { pool } = createDb(url());
    expect(pool.options.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(pool.options.max).toBe(10);
    await pool.end();
  });
});
