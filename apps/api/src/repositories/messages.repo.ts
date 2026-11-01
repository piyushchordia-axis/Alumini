import { and, eq, inArray, lt, notInArray, or, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { outboundMessages } from "../db/schema";

export type OutboundMessageRow = typeof outboundMessages.$inferSelect;
export type OutboundMessageInsert = typeof outboundMessages.$inferInsert;

/** Inserts a message, or returns null when its dedupe key already exists. */
export async function insertMessage(db: DbClient, values: OutboundMessageInsert): Promise<OutboundMessageRow | null> {
  const [row] = await db.insert(outboundMessages).values(values).onConflictDoNothing().returning();
  return row ?? null;
}

/** Inserts many messages; rows whose dedupe key already exists are skipped. Returns the inserted rows. */
export async function insertMessages(db: DbClient, values: OutboundMessageInsert[]): Promise<OutboundMessageRow[]> {
  if (values.length === 0) return [];
  return db.insert(outboundMessages).values(values).onConflictDoNothing().returning();
}

export async function findMessage(db: DbClient, id: string): Promise<OutboundMessageRow | undefined> {
  const [row] = await db.select().from(outboundMessages).where(eq(outboundMessages.id, id));
  return row;
}

export async function findMessageByDedupeKey(db: DbClient, dedupeKey: string): Promise<OutboundMessageRow | undefined> {
  const [row] = await db.select().from(outboundMessages).where(eq(outboundMessages.dedupeKey, dedupeKey));
  return row;
}

export async function updateMessage(db: DbClient, id: string, values: Partial<OutboundMessageInsert>): Promise<OutboundMessageRow | undefined> {
  const [row] = await db
    .update(outboundMessages)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(outboundMessages.id, id))
    .returning();
  return row;
}

/**
 * Messages a crash or lost job may have left behind: QUEUED or SENDING and untouched since the given times. Bulk types
 * get their own (longer) QUEUED threshold.
 */
export async function findStaleMessages(
  db: DbClient,
  opts: { queuedBefore: Date; bulkQueuedBefore: Date; bulkTypes: string[]; sendingBefore: Date; limit: number },
): Promise<Array<{ id: string; type: string }>> {
  const queued = eq(outboundMessages.status, "QUEUED");
  const conds: SQL[] = [
    and(eq(outboundMessages.status, "SENDING"), lt(outboundMessages.updatedAt, opts.sendingBefore))!,
    opts.bulkTypes.length
      ? or(
          and(queued, notInArray(outboundMessages.type, opts.bulkTypes), lt(outboundMessages.updatedAt, opts.queuedBefore)),
          and(queued, inArray(outboundMessages.type, opts.bulkTypes), lt(outboundMessages.updatedAt, opts.bulkQueuedBefore)),
        )!
      : and(queued, lt(outboundMessages.updatedAt, opts.queuedBefore))!,
  ];
  return db
    .select({ id: outboundMessages.id, type: outboundMessages.type })
    .from(outboundMessages)
    .where(or(...conds))
    .limit(opts.limit);
}

export async function findMessagesByContext(db: DbClient, contextType: string, contextIds: string[]): Promise<OutboundMessageRow[]> {
  if (contextIds.length === 0) return [];
  return db
    .select()
    .from(outboundMessages)
    .where(and(eq(outboundMessages.contextType, contextType), inArray(outboundMessages.contextId, contextIds)));
}
