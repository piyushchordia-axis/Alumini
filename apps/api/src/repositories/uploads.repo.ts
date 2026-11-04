import { and, asc, eq, inArray, like, lt, notExists, or, sql, type SQL } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { memberships, uploads } from "../db/schema";
import { escapeLike } from "./content.common";

export type UploadRow = typeof uploads.$inferSelect;
export type UploadInsert = typeof uploads.$inferInsert;

export async function insertUpload(db: DbClient, values: UploadInsert): Promise<UploadRow> {
  const [row] = await db.insert(uploads).values(values).returning();
  return row!;
}

/**
 * `lock: "share"` holds the row until the transaction ends, so that a photo being set can't be deleted under the
 * change that sets it (the deletion locks the row for update); `"update"` is that deletion's lock.
 */
export async function findUploadByKey(db: DbClient, storageKey: string, { lock }: { lock?: "share" | "update" } = {}): Promise<UploadRow | undefined> {
  const query = db.select().from(uploads).where(eq(uploads.storageKey, storageKey));
  const [row] = lock ? await query.for(lock) : await query;
  return row;
}

export async function deleteUploadById(db: DbClient, id: string): Promise<void> {
  await db.delete(uploads).where(eq(uploads.id, id));
}

/**
 * Whether a membership of the institution shows the photo. A membership refers to a photo by URL, which ends with the
 * key whatever the provider's address.
 */
function showsPhoto(tenantId: SQL | string, storageKey: SQL | string): SQL {
  const key = typeof storageKey === "string" ? `%/${escapeLike(storageKey)}` : sql`'%/' || ${storageKey}`;
  return and(eq(memberships.tenantId, tenantId), like(memberships.avatarUrl, key))!;
}

export async function isPhotoShown(db: DbClient, tenantId: string, storageKey: string): Promise<boolean> {
  const rows = await db.select({ id: memberships.id }).from(memberships).where(showsPhoto(tenantId, storageKey)).limit(1);
  return rows.length > 0;
}

/** Keys of the avatar uploads among `keys`, plus every avatar the user uploaded. */
export async function listAvatarUploadKeys(db: DbClient, userId: string, keys: string[]): Promise<string[]> {
  const rows = await db
    .select({ key: uploads.storageKey })
    .from(uploads)
    .where(and(eq(uploads.purpose, "avatar"), or(eq(uploads.userId, userId), keys.length > 0 ? inArray(uploads.storageKey, keys) : undefined)));
  return rows.map((r) => r.key);
}

/**
 * Avatar uploads from before `before` that no membership shows: photos picked and never saved, or let go of by a change
 * whose clean-up failed. Oldest first. Keys hold no LIKE wildcards (see STORAGE_KEY_PATTERN), so the key column can go
 * into the pattern as it is.
 */
export async function listUnshownAvatarKeys(db: DbClient, before: Date, limit: number): Promise<string[]> {
  const rows = await db
    .select({ key: uploads.storageKey })
    .from(uploads)
    .where(
      and(
        eq(uploads.purpose, "avatar"),
        lt(uploads.createdAt, before),
        notExists(db.select({ id: memberships.id }).from(memberships).where(showsPhoto(sql`${uploads.tenantId}`, sql`${uploads.storageKey}`))),
      ),
    )
    .orderBy(asc(uploads.createdAt))
    .limit(limit);
  return rows.map((r) => r.key);
}
