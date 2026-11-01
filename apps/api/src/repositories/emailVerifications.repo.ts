import { and, desc, eq, gt, isNull } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { emailVerifications } from "../db/schema";

export type EmailVerificationRow = typeof emailVerifications.$inferSelect;

export async function insertEmailVerification(db: DbClient, values: typeof emailVerifications.$inferInsert): Promise<EmailVerificationRow> {
  const [row] = await db.insert(emailVerifications).values(values).returning();
  return row!;
}

export async function findEmailVerification(db: DbClient, id: string): Promise<EmailVerificationRow | undefined> {
  const [row] = await db.select().from(emailVerifications).where(eq(emailVerifications.id, id));
  return row;
}

/** The newest confirmation still waiting for its link to be opened. */
export async function findPendingEmailVerification(db: DbClient, userId: string, now = new Date()): Promise<EmailVerificationRow | undefined> {
  const [row] = await db
    .select()
    .from(emailVerifications)
    .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.consumedAt), gt(emailVerifications.expiresAt, now)))
    .orderBy(desc(emailVerifications.createdAt))
    .limit(1);
  return row;
}

/** Marks a token used, only if it is still open. Returns the row when this call consumed it. */
export async function consumeEmailVerification(db: DbClient, tokenHash: string, now = new Date()): Promise<EmailVerificationRow | undefined> {
  const [row] = await db
    .update(emailVerifications)
    .set({ consumedAt: now })
    .where(and(eq(emailVerifications.tokenHash, tokenHash), isNull(emailVerifications.consumedAt), gt(emailVerifications.expiresAt, now)))
    .returning();
  return row;
}

/** Closes every open confirmation for a user (a new request, a confirmed address, or the address removed). */
export async function closeEmailVerifications(db: DbClient, userId: string, now = new Date()): Promise<void> {
  await db
    .update(emailVerifications)
    .set({ consumedAt: now })
    .where(and(eq(emailVerifications.userId, userId), isNull(emailVerifications.consumedAt)));
}
