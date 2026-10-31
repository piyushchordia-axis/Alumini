import { PgTransaction } from "drizzle-orm/pg-core";
import type { Db, DbClient, Tx } from "../db/client";
import type { Logger } from "./logger";

type Hook = () => Promise<unknown>;

/** After-commit hooks per open transaction started with runInTransaction. */
const pendingHooks = new WeakMap<object, Hook[]>();

/**
 * Runs `fn` in a transaction. Work registered with afterCommit() inside it (queueing jobs, sending events) runs only
 * once the transaction has committed, and is dropped if it rolls back. Use this instead of `db.transaction`.
 */
export async function runInTransaction<T>(ctx: { db: Db; logger: Logger }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const hooks: Hook[] = [];
  // The ban on db.transaction() (eslint) exempts this file only.
  const result = await ctx.db.transaction(async (tx) => {
    pendingHooks.set(tx, hooks);
    try {
      return await fn(tx);
    } finally {
      pendingHooks.delete(tx);
    }
  });
  for (const hook of hooks) await runHook(ctx.logger, hook);
  return result;
}

/**
 * Runs `hook` after the work done through `db` is committed: immediately for the root handle (its statements have
 * already auto-committed), on commit for a runInTransaction() transaction. A transaction opened any other way throws,
 * because there would be no way to know when it commits. Hook errors are logged, never thrown: the data is already
 * saved and background work must not fail the request.
 */
export async function afterCommit(ctx: { logger: Logger }, db: DbClient, hook: Hook): Promise<void> {
  if (db instanceof PgTransaction) {
    const hooks = pendingHooks.get(db);
    if (!hooks) throw new Error("This transaction was not started with runInTransaction(); use it so background work runs after commit.");
    hooks.push(hook);
    return;
  }
  await runHook(ctx.logger, hook);
}

async function runHook(logger: Logger, hook: Hook): Promise<void> {
  try {
    await hook();
  } catch (err) {
    logger.error({ err }, "After-commit work failed");
  }
}
