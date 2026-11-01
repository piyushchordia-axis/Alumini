import type { ProfileFieldValue } from "@illuminize/shared";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { memberFieldValues, tenantProfileFields } from "../db/schema";

export type ProfileFieldRow = typeof tenantProfileFields.$inferSelect;
export type ProfileFieldInsert = typeof tenantProfileFields.$inferInsert;

export async function listProfileFields(db: DbClient, tenantId: string, opts: { includeArchived?: boolean } = {}): Promise<ProfileFieldRow[]> {
  const conds = [eq(tenantProfileFields.tenantId, tenantId)];
  if (!opts.includeArchived) conds.push(isNull(tenantProfileFields.archivedAt));
  return db
    .select()
    .from(tenantProfileFields)
    .where(and(...conds))
    .orderBy(asc(tenantProfileFields.position), asc(tenantProfileFields.createdAt));
}

export async function findProfileField(db: DbClient, tenantId: string, id: string): Promise<ProfileFieldRow | undefined> {
  const [row] = await db
    .select()
    .from(tenantProfileFields)
    .where(and(eq(tenantProfileFields.tenantId, tenantId), eq(tenantProfileFields.id, id)));
  return row;
}

export async function countActiveProfileFields(db: DbClient, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(tenantProfileFields)
    .where(and(eq(tenantProfileFields.tenantId, tenantId), isNull(tenantProfileFields.archivedAt)));
  return row?.n ?? 0;
}

/** Inserts a field; returns undefined when the key is taken in this institution. */
export async function insertProfileField(db: DbClient, values: ProfileFieldInsert): Promise<ProfileFieldRow | undefined> {
  const [row] = await db.insert(tenantProfileFields).values(values).onConflictDoNothing().returning();
  return row;
}

export async function updateProfileField(db: DbClient, tenantId: string, id: string, values: Partial<ProfileFieldInsert>): Promise<ProfileFieldRow | undefined> {
  const [row] = await db
    .update(tenantProfileFields)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(tenantProfileFields.tenantId, tenantId), eq(tenantProfileFields.id, id)))
    .returning();
  return row;
}

export async function nextProfileFieldPosition(db: DbClient, tenantId: string): Promise<number> {
  const [row] = await db
    .select({ max: sql<number | null>`max(${tenantProfileFields.position})` })
    .from(tenantProfileFields)
    .where(eq(tenantProfileFields.tenantId, tenantId));
  return (row?.max ?? 0) + 1;
}

export async function fieldHasAnswers(db: DbClient, fieldId: string): Promise<boolean> {
  const [row] = await db.select({ one: sql<number>`1` }).from(memberFieldValues).where(eq(memberFieldValues.fieldId, fieldId)).limit(1);
  return !!row;
}

/** Answers of several members (any field, archived included; callers filter by the fields they show). */
export async function listAnswers(db: DbClient, membershipIds: string[]): Promise<Array<{ membershipId: string; fieldId: string; value: ProfileFieldValue }>> {
  if (membershipIds.length === 0) return [];
  return db
    .select({ membershipId: memberFieldValues.membershipId, fieldId: memberFieldValues.fieldId, value: memberFieldValues.value })
    .from(memberFieldValues)
    .where(inArray(memberFieldValues.membershipId, membershipIds));
}

export async function upsertAnswers(db: DbClient, rows: Array<{ tenantId: string; membershipId: string; fieldId: string; value: ProfileFieldValue }>): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(memberFieldValues)
    .values(rows)
    .onConflictDoUpdate({ target: [memberFieldValues.membershipId, memberFieldValues.fieldId], set: { value: sql`excluded.value`, updatedAt: new Date() } });
}

export async function deleteAnswers(db: DbClient, membershipId: string, fieldIds: string[]): Promise<void> {
  if (fieldIds.length === 0) return;
  await db.delete(memberFieldValues).where(and(eq(memberFieldValues.membershipId, membershipId), inArray(memberFieldValues.fieldId, fieldIds)));
}
