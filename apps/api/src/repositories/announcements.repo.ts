import type { NotificationPrefs } from "@illuminize/shared";
import { and, asc, eq, gt, ne, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { memberships, notificationPrefs, postAnnouncements, users } from "../db/schema";

export type AnnouncementRow = typeof postAnnouncements.$inferSelect;

export async function insertAnnouncement(db: DbClient, values: typeof postAnnouncements.$inferInsert): Promise<void> {
  await db.insert(postAnnouncements).values(values).onConflictDoNothing();
}

export async function findAnnouncement(db: DbClient, postId: string): Promise<AnnouncementRow | undefined> {
  const [row] = await db.select().from(postAnnouncements).where(eq(postAnnouncements.postId, postId));
  return row;
}

export async function updateAnnouncement(db: DbClient, postId: string, values: Partial<typeof postAnnouncements.$inferInsert> & { addNotified?: number; addMessaged?: number }): Promise<void> {
  const { addNotified, addMessaged, ...rest } = values;
  await db
    .update(postAnnouncements)
    .set({
      ...rest,
      ...(addNotified ? { notifiedCount: sql`${postAnnouncements.notifiedCount} + ${addNotified}` } : {}),
      ...(addMessaged ? { messagedCount: sql`${postAnnouncements.messagedCount} + ${addMessaged}` } : {}),
    })
    .where(eq(postAnnouncements.postId, postId));
}

export interface AudienceMember {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  email: string | null;
  prefs: NotificationPrefs | null;
}

/** One page of an institution's approved members (except one), in id order, with what's needed to message them. */
export async function audiencePage(db: DbClient, tenantId: string, excludeMembershipId: string, afterId: string | null, limit: number): Promise<AudienceMember[]> {
  const conds = [eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), ne(memberships.id, excludeMembershipId)];
  if (afterId) conds.push(gt(memberships.id, afterId));
  return db
    .select({ id: memberships.id, userId: memberships.userId, fullName: memberships.fullName, phone: users.phoneE164, email: users.email, prefs: notificationPrefs.prefs })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(notificationPrefs, eq(notificationPrefs.membershipId, memberships.id))
    .where(and(...conds))
    .orderBy(asc(memberships.id))
    .limit(limit);
}

/** How many members an announcement reaches in the app, and by email/phone when sent that way too. */
export async function audienceCounts(db: DbClient, tenantId: string, excludeMembershipId: string): Promise<{ members: number; withEmail: number; withPhone: number }> {
  const messagesOn = sql`coalesce((${notificationPrefs.prefs}->>'announcementMessages')::boolean, true)`;
  const [row] = await db
    .select({
      members: sql<number>`count(*)::int`,
      withEmail: sql<number>`(count(*) filter (where ${messagesOn} and ${users.email} is not null))::int`,
      withPhone: sql<number>`(count(*) filter (where ${messagesOn}))::int`,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .leftJoin(notificationPrefs, eq(notificationPrefs.membershipId, memberships.id))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.status, "APPROVED"), ne(memberships.id, excludeMembershipId)));
  return row ?? { members: 0, withEmail: 0, withPhone: 0 };
}
