import type { NotificationPrefs, NotificationType } from "@illuminize/shared";
import { and, desc, eq, getTableColumns, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { notificationPrefs, notifications } from "../db/schema";
import { buildCursorPage, decodeCursor, keysetCondition, type CursorPage } from "../lib/pagination";

export type NotificationRow = typeof notifications.$inferSelect;
export type NotificationInsert = typeof notifications.$inferInsert;

/** Inserts notifications; rows whose (recipient, dedupe key) already exists are skipped. Returns the inserted rows. */
export async function insertNotifications(db: DbClient, values: NotificationInsert[]): Promise<NotificationRow[]> {
  if (values.length === 0) return [];
  return db.insert(notifications).values(values).onConflictDoNothing().returning();
}

/**
 * Inserts notifications, or for an existing (recipient, dedupe key) updates its text and data and marks it unread and
 * new again. `inserted` tells the two apart (Postgres sets xmax only on the updated version).
 */
export async function upsertMergedNotifications(db: DbClient, values: NotificationInsert[]): Promise<Array<NotificationRow & { inserted: boolean }>> {
  if (values.length === 0) return [];
  return db
    .insert(notifications)
    .values(values)
    .onConflictDoUpdate({
      target: [notifications.recipientMembershipId, notifications.dedupeKey],
      targetWhere: sql`${notifications.dedupeKey} IS NOT NULL`,
      set: { title: sql`excluded.title`, body: sql`excluded.body`, data: sql`excluded.data`, readAt: null, createdAt: sql`now()` },
    })
    .returning({ ...getTableColumns(notifications), inserted: sql<boolean>`(xmax = 0)` });
}

export async function findNotificationPrefs(db: DbClient, membershipId: string): Promise<NotificationPrefs | undefined> {
  const [row] = await db.select({ prefs: notificationPrefs.prefs }).from(notificationPrefs).where(eq(notificationPrefs.membershipId, membershipId));
  return row?.prefs;
}

/** Stored preferences for several members (members with none are absent: they use the defaults). */
export async function findNotificationPrefsByMemberships(db: DbClient, membershipIds: string[]): Promise<Map<string, NotificationPrefs>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await db
    .select({ membershipId: notificationPrefs.membershipId, prefs: notificationPrefs.prefs })
    .from(notificationPrefs)
    .where(inArray(notificationPrefs.membershipId, membershipIds));
  return new Map(rows.map((r) => [r.membershipId, r.prefs]));
}

export async function saveNotificationPrefs(db: DbClient, tenantId: string, membershipId: string, prefs: NotificationPrefs): Promise<void> {
  await db
    .insert(notificationPrefs)
    .values({ tenantId, membershipId, prefs })
    .onConflictDoUpdate({ target: notificationPrefs.membershipId, set: { prefs, updatedAt: new Date() } });
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

/** Unread counts for several members in one query (members with none are absent from the map). */
export async function countUnreadByMemberships(db: DbClient, membershipIds: string[]): Promise<Map<string, number>> {
  if (membershipIds.length === 0) return new Map();
  const rows = await db
    .select({ membershipId: notifications.recipientMembershipId, count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(inArray(notifications.recipientMembershipId, membershipIds), isNull(notifications.readAt)))
    .groupBy(notifications.recipientMembershipId);
  return new Map(rows.map((r) => [r.membershipId, r.count]));
}

export async function markRead(db: DbClient, recipientMembershipId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, id), eq(notifications.recipientMembershipId, recipientMembershipId), isNull(notifications.readAt)))
    .returning({ id: notifications.id });
  return rows.length > 0;
}

/**
 * Marks read the notifications `where` picks, locking them first in id order. Every statement that marks several of a
 * member's notifications read goes through this, so two can't deadlock (a transaction marking other admins' copies of a
 * handled request, say, and an admin's own Mark all read). `where` applies outside too, so the update can use an index.
 */
function markReadInIdOrder(db: DbClient, where: SQL | undefined) {
  const locked = db.select({ id: notifications.id }).from(notifications).where(where).orderBy(notifications.id).for("no key update");
  return db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(where, inArray(notifications.id, locked)));
}

/**
 * Marks read the unread notifications of `type` these members hold whose data[key] is one of `values`, and returns whose
 * were marked, once per row. By recipient, not by tenant, so it uses the unread index (notifications has no tenant index).
 * One statement however many values (they go as one array), so its locks are taken in one pass.
 */
export async function markUnreadReadByData(db: DbClient, recipientIds: string[], type: NotificationType, key: string, values: string[]): Promise<string[]> {
  if (recipientIds.length === 0 || values.length === 0) return [];
  const picked = and(
    inArray(notifications.recipientMembershipId, recipientIds),
    isNull(notifications.readAt),
    eq(notifications.type, type),
    sql`${notifications.data} ->> ${key}::text = any(${sql.param(values)}::text[])`,
  );
  const rows = await markReadInIdOrder(db, picked).returning({ recipientMembershipId: notifications.recipientMembershipId });
  return rows.map((r) => r.recipientMembershipId);
}

export async function markAllRead(db: DbClient, recipientMembershipId: string): Promise<void> {
  await markReadInIdOrder(db, and(eq(notifications.recipientMembershipId, recipientMembershipId), isNull(notifications.readAt)));
}

/** Rows by id within one tenant (background delivery reloads what the request stored). */
export async function findNotificationsByIds(db: DbClient, tenantId: string, ids: string[]): Promise<NotificationRow[]> {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.tenantId, tenantId), inArray(notifications.id, ids)));
}
