import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { notifications } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

export async function insertNotifications(db: DbClient, values: NotificationInsert[]): Promise<NotificationRow[]> {
  if (values.length === 0) return [];
  return db.insert(notifications).values(values).returning();
}

export async function listNotifications(
  db: DbClient,
  recipientMembershipId: string,
  opts: { cursor?: string; limit: number; unreadOnly?: boolean },
): Promise<CursorPage<NotificationRow>> {
  const cursor = decodeCursor(opts.cursor);
  const conds = [eq(notifications.recipientMembershipId, recipientMembershipId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  const keyset = keysetCondition(notifications.createdAt, notifications.id, cursor, "desc");
  if (keyset) conds.push(keyset);
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(opts.limit + 1);
  return buildCursorPage(rows, opts.limit, (r) => ({ v: r.createdAt.toISOString(), id: r.id }), (r) => r);
}

export async function countUnread(db: DbClient, recipientMembershipId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.recipientMembershipId, recipientMembershipId), isNull(notifications.readAt)));
  return row?.count ?? 0;
}

export async function markRead(db: DbClient, recipientMembershipId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientMembershipId, recipientMembershipId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

export async function markAllRead(db: DbClient, recipientMembershipId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.recipientMembershipId, recipientMembershipId), isNull(notifications.readAt)));
}

/** Rows by id within one tenant (background delivery reloads what the request stored). */
export async function findNotificationsByIds(db: DbClient, tenantId: string, ids: string[]): Promise<NotificationRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), inArray(notifications.id, ids)));
}
