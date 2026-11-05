import { and, eq, ilike, inArray, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { pushTokens, users } from "../db/schema";
import { escapeLike } from "./content.common";

export type UserRow = typeof users.$inferSelect;
export type PushTokenRow = typeof pushTokens.$inferSelect;

export async function findUserById(db: DbClient, id: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export async function findUserByPhone(db: DbClient, phoneE164: string): Promise<UserRow | undefined> {
  const [row] = await db.select().from(users).where(eq(users.phoneE164, phoneE164)).limit(1);
  return row;
}

export async function upsertUserOnLogin(
  db: DbClient,
  input: { phoneE164: string; phoneRegion: string | null; forcePlatformAdmin: boolean },
): Promise<UserRow> {
  const now = new Date();
  const [row] = await db
    .insert(users)
    .values({
      phoneE164: input.phoneE164,
      phoneRegion: input.phoneRegion,
      isPlatformAdmin: input.forcePlatformAdmin,
      lastLoginAt: now,
    })
    .onConflictDoUpdate({
      target: users.phoneE164,
      set: {
        lastLoginAt: now,
        updatedAt: now,
        ...(input.forcePlatformAdmin ? { isPlatformAdmin: true } : {}),
      },
    })
    .returning();
  return row!;
}

export async function findOrCreateUserByPhone(db: DbClient, phoneE164: string, phoneRegion: string | null): Promise<UserRow> {
  const existing = await findUserByPhone(db, phoneE164);
  if (existing) return existing;
  const [row] = await db.insert(users).values({ phoneE164, phoneRegion }).onConflictDoNothing().returning();
  return row ?? (await findUserByPhone(db, phoneE164))!;
}

export async function updateUser(db: DbClient, id: string, values: Partial<typeof users.$inferInsert>): Promise<UserRow | undefined> {
  const [row] = await db
    .update(users)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return row;
}

export async function deleteUser(db: DbClient, id: string): Promise<void> {
  await db.delete(users).where(eq(users.id, id));
}

export async function upsertPushToken(
  db: DbClient,
  input: { userId: string; token: string; platform: PushTokenRow["platform"] },
): Promise<void> {
  await db
    .insert(pushTokens)
    .values({ userId: input.userId, token: input.token, platform: input.platform })
    .onConflictDoUpdate({
      target: pushTokens.token,
      set: { userId: input.userId, platform: input.platform, lastSeenAt: new Date() },
    });
}

export async function deletePushToken(db: DbClient, userId: string, token: string): Promise<void> {
  await db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.token, token)));
}

/** Every device of a user, for when all their sessions end. */
export async function deletePushTokensForUser(db: DbClient, userId: string): Promise<void> {
  await db.delete(pushTokens).where(eq(pushTokens.userId, userId));
}

/** Deletes tokens by value regardless of owner (Expo reported the device as gone). Returns how many were removed. */
export async function deletePushTokensByValue(db: DbClient, tokens: string[]): Promise<number> {
  if (tokens.length === 0) return 0;
  const rows = await db.delete(pushTokens).where(inArray(pushTokens.token, tokens)).returning({ id: pushTokens.id });
  return rows.length;
}

export async function listPushTokensForUsers(db: DbClient, userIds: string[]): Promise<PushTokenRow[]> {
  if (userIds.length === 0) return [];
  return db.select().from(pushTokens).where(inArray(pushTokens.userId, userIds));
}

export async function searchUsers(
  db: DbClient,
  opts: { phone?: string; page: number; pageSize: number },
): Promise<{ rows: UserRow[]; total: number }> {
  const where = opts.phone ? ilike(users.phoneE164, `%${escapeLike(opts.phone)}%`) : undefined;
  const [rows, [count]] = await Promise.all([
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(sql`${users.createdAt} desc`)
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize),
    db.select({ count: sql<number>`count(*)::int` }).from(users).where(where),
  ]);
  return { rows, total: count?.count ?? 0 };
}

export async function countUsers(db: DbClient): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  return row?.count ?? 0;
}
