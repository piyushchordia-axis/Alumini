import { and, asc, eq, sql } from "drizzle-orm";
import type { DbClient } from "../db/client";
import { chatBlocks, deletedAccountBlocks, deletedAccountSuspensions, memberships, users } from "../db/schema";

/** What a deleted account held at one institution, as takeHolds hands it back. */
export interface HeldSanctions {
  suspendedAt: Date | null;
  blocks: Array<{ blockerMembershipId: string; blockedAt: Date }>;
}

/**
 * Inside the deletion's transaction, before saveHolds: takes the locks deleting the user would take anyway, in the same
 * order (their row, then their memberships), so nothing about them can still be committing while the holds are read. A
 * membership a rejoin is inserting holds a key-share lock on the user's row, and a suspension or a block still being
 * written holds one on the membership's: this waits for each to commit, and the statements after it see them. Anything
 * later waits for the deletion and then finds the user gone. Returns how many memberships they have.
 */
export async function lockAccountForDeletion(tx: DbClient, userId: string): Promise<number> {
  await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
  const rows = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId)).orderBy(asc(memberships.id)).for("update");
  return rows.length;
}

/**
 * Inside the deletion's transaction, after lockAccountForDeletion and before the user goes: keeps each SUSPENDED
 * membership of theirs and each block placed on them, under `hash`. Blocks they placed go with them. A hold already kept
 * for the same institution or blocker keeps the earlier time. Selected fields are in the tables' column order, as
 * Drizzle's insert-select needs.
 */
export async function saveHolds(tx: DbClient, input: { hash: string; userId: string }): Promise<{ suspensions: number; blocks: number }> {
  const hash = sql<string>`${input.hash}::text`.as("phone_hash");
  const suspensions = await tx
    .insert(deletedAccountSuspensions)
    .select(
      tx
        .select({ phoneHash: hash, tenantId: memberships.tenantId, suspendedAt: sql<Date>`coalesce(${memberships.statusChangedAt}, ${memberships.updatedAt})`.as("suspended_at") })
        .from(memberships)
        .where(and(eq(memberships.userId, input.userId), eq(memberships.status, "SUSPENDED"))),
    )
    .onConflictDoUpdate({
      target: [deletedAccountSuspensions.phoneHash, deletedAccountSuspensions.tenantId],
      set: { suspendedAt: sql`least(${deletedAccountSuspensions.suspendedAt}, excluded.suspended_at)` },
    })
    .returning({ tenantId: deletedAccountSuspensions.tenantId });
  const blocks = await tx
    .insert(deletedAccountBlocks)
    .select(
      tx
        .select({ phoneHash: hash, tenantId: chatBlocks.tenantId, blockerMembershipId: chatBlocks.blockerMembershipId, blockedAt: chatBlocks.createdAt })
        .from(chatBlocks)
        .innerJoin(memberships, eq(memberships.id, chatBlocks.blockedMembershipId))
        .where(eq(memberships.userId, input.userId)),
    )
    .onConflictDoUpdate({
      target: [deletedAccountBlocks.phoneHash, deletedAccountBlocks.blockerMembershipId],
      set: { blockedAt: sql`least(${deletedAccountBlocks.blockedAt}, excluded.blocked_at)` },
    })
    .returning({ tenantId: deletedAccountBlocks.tenantId });
  return { suspensions: suspensions.length, blocks: blocks.length };
}

/** Removes and returns what `hash` held at this institution, inside the transaction that gives it back. */
export async function takeHolds(tx: DbClient, hash: string, tenantId: string): Promise<HeldSanctions> {
  const [suspension] = await tx
    .delete(deletedAccountSuspensions)
    .where(and(eq(deletedAccountSuspensions.phoneHash, hash), eq(deletedAccountSuspensions.tenantId, tenantId)))
    .returning({ suspendedAt: deletedAccountSuspensions.suspendedAt });
  const blocks = await tx
    .delete(deletedAccountBlocks)
    .where(and(eq(deletedAccountBlocks.phoneHash, hash), eq(deletedAccountBlocks.tenantId, tenantId)))
    .returning({ blockerMembershipId: deletedAccountBlocks.blockerMembershipId, blockedAt: deletedAccountBlocks.blockedAt });
  return { suspendedAt: suspension?.suspendedAt ?? null, blocks };
}
