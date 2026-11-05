import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { phoneHash } from "../lib/phoneHash";
import { insertBlock } from "../repositories/chat.repo";
import { saveHolds, takeHolds, type HeldSanctions } from "../repositories/deletedAccounts.repo";
import type { UserRow } from "../repositories/users.repo";
import type { MembershipRow } from "../types/request";
import { recordAuditStrict } from "./audit.service";

/** Shown to the member and in the admins' Suspended tab when a suspension comes back with a deleted account's number. */
export const RESTORED_SUSPENSION_REASON = "Suspended before this account was deleted";

const NOTHING_HELD: HeldSanctions = { suspendedAt: null, blocks: [] };

/**
 * Keeps, under a keyed hash of their phone, what others need to outlast an account's deletion: its suspensions, and the
 * blocks members placed on it. Inside the deletion's transaction, once lockAccountForDeletion has waited out anything
 * about them still being committed, and before the user row goes.
 */
export async function keepHoldsOfDeletedAccount(ctx: AppContext, tx: DbClient, user: Pick<UserRow, "id" | "phoneE164">): Promise<{ phoneHash: string; suspensions: number }> {
  const hash = phoneHash(ctx.config, user.phoneE164);
  const { suspensions } = await saveHolds(tx, { hash, userId: user.id });
  return { phoneHash: hash, suspensions };
}

/** What this number held at the institution when its account was deleted, taken for a membership about to be inserted. */
export async function takeHeldSanctions(ctx: AppContext, tx: DbClient, tenantId: string, phoneE164: string | undefined): Promise<HeldSanctions> {
  return phoneE164 ? takeHolds(tx, phoneHash(ctx.config, phoneE164), tenantId) : NOTHING_HELD;
}

/** The status columns of a membership inserted with a held suspension, which nothing at joining (an invitation, auto-approval) lifts. */
export function heldSuspensionColumns(): Pick<MembershipRow, "status" | "statusReason" | "statusChangedAt" | "statusChangedByUserId"> {
  return { status: "SUSPENDED", statusReason: RESTORED_SUSPENSION_REASON, statusChangedAt: new Date(), statusChangedByUserId: null };
}

/**
 * Puts back the rest for the new membership, in its transaction. The blocks keep their first time and are invisible
 * (CLAUDE.md, Invisible blocks): nobody is told, and the institution's audit log doesn't count them. A suspension, which
 * the membership was inserted with, is audited.
 */
export async function restoreHeldSanctions(
  tx: DbClient,
  membership: MembershipRow,
  held: HeldSanctions,
  by: { actorUserId: string; actorMembershipId: string | null; ip?: string },
): Promise<void> {
  for (const block of held.blocks) {
    await insertBlock(tx, { tenantId: membership.tenantId, blockerMembershipId: block.blockerMembershipId, blockedMembershipId: membership.id, createdAt: block.blockedAt });
  }
  if (!held.suspendedAt) return;
  await recordAuditStrict(tx, {
    tenantId: membership.tenantId,
    actorUserId: by.actorUserId,
    actorMembershipId: by.actorMembershipId,
    action: "membership.suspension_restored",
    targetType: "membership",
    targetId: membership.id,
    metadata: { suspendedAt: held.suspendedAt.toISOString() },
    ip: by.ip,
  });
}
