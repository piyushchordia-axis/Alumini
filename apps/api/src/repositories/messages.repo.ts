import { and, eq, inArray, lt, or } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { outboundMessages } from "../db/schema";

export type OutboundMessageRow = typeof outboundMessages.$inferSelect;
export type OutboundMessageInsert = typeof outboundMessages.$inferInsert;

/** Inserts a message, or returns null when its dedupe key already exists. */
export async function insertMessage(db: DbClient, values: OutboundMessageInsert): Promise<OutboundMessageRow | null> {
  const [row] = await db.insert(outboundMessages).values(values).onConflictDoNothing().returning();
  return row ?? null;
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

/** Messages a crash or lost job may have left behind: QUEUED or SENDING and untouched since the given times. */
export async function findStaleMessageIds(db: DbClient, queuedBefore: Date, sendingBefore: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: outboundMessages.id })
    .from(outboundMessages)
    .where(
      or(
        and(eq(outboundMessages.status, "QUEUED"), lt(outboundMessages.updatedAt, queuedBefore)),
        and(eq(outboundMessages.status, "SENDING"), lt(outboundMessages.updatedAt, sendingBefore)),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

export async function findMessagesByContext(db: DbClient, contextType: string, contextIds: string[]): Promise<OutboundMessageRow[]> {
  if (contextIds.length === 0) return [];
  return db
    .select()
    .from(outboundMessages)
    .where(and(eq(outboundMessages.contextType, contextType), inArray(outboundMessages.contextId, contextIds)));
}
