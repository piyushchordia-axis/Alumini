import { sql, type SQL } from "drizzle-orm";
import type { TestContext } from "./testContext";

/** Runs `fn` with a trigger in place, for what can't be arranged through the API: a slow write, or one that fails. */
export async function withTrigger<T>(ctx: TestContext, when: string, body: string, fn: () => Promise<T>): Promise<T> {
  await ctx.db.execute(sql.raw(`create or replace function test_trigger() returns trigger as $$ begin ${body} end $$ language plpgsql`));
  await ctx.db.execute(sql.raw(`create trigger test_trigger ${when} for each row execute function test_trigger()`));
  try {
    return await fn();
  } finally {
    const table = when.split(" on ")[1]!;
    await ctx.db.execute(sql.raw(`drop trigger test_trigger on ${table}`));
    await ctx.db.execute(sql.raw("drop function test_trigger()"));
  }
}

/** Runs `fn` while audit rows that fail `check` can't be written, as when the audit log is unreachable. */
export async function refusingAuditWhere(ctx: TestContext, check: string, fn: () => Promise<void>): Promise<void> {
  await ctx.db.execute(sql.raw(`alter table audit_log add constraint test_refuse_audit check (${check}) not valid`));
  try {
    await fn();
  } finally {
    await ctx.db.execute(sql.raw("alter table audit_log drop constraint test_refuse_audit"));
  }
}

/** Runs `fn` while audit rows of this action can't be written. */
export const refusingAudit = (ctx: TestContext, action: string, fn: () => Promise<void>) => refusingAuditWhere(ctx, `action <> '${action}'`, fn);

/** Polls until `count` (a query returning n) reaches atLeast, or fails the test after timeoutMs. */
async function until(ctx: TestContext, count: SQL, atLeast: number, what: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await ctx.db.execute<{ n: number }>(count);
    if ((rows[0]?.n ?? 0) >= atLeast) return;
    if (Date.now() > deadline) throw new Error(`Never saw ${atLeast} ${what} in time`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Waits until other connections are inside pg_sleep, which a trigger from withTrigger put there, so a test can start a
 * second request while the first is known to hold its locks. With atLeast 2, shows that two transactions got that far
 * at the same time, so neither waited for the other's locks.
 */
export const untilSomeoneSleeps = (ctx: TestContext, atLeast = 1, timeoutMs = 10_000) =>
  until(ctx, sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event = 'PgSleep'`, atLeast, "connections in pg_sleep", timeoutMs);

/** Waits until another connection is waiting for a lock of this type ('advisory', 'transactionid', 'tuple', …). */
export const untilSomeoneWaitsFor = (ctx: TestContext, locktype: string, timeoutMs = 10_000) =>
  until(
    ctx,
    sql`select count(*)::int as n from pg_locks l join pg_stat_activity a on a.pid = l.pid where a.datname = current_database() and l.locktype = ${locktype} and not l.granted`,
    1,
    `connections waiting for a ${locktype} lock`,
    timeoutMs,
  );
