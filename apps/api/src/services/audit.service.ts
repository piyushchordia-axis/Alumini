import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { auditLog } from "../db/schema";

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  /** Null for Illuminize staff, who act without a membership. Never a placeholder id, which would fail the foreign key. */
  actorMembershipId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

const insertAudit = async (db: DbClient, entry: AuditEntry) => {
  await db.insert(auditLog).values({
    tenantId: entry.tenantId ?? null,
    actorUserId: entry.actorUserId ?? null,
    actorMembershipId: entry.actorMembershipId ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
};

/**
 * Records an action that has already happened, and logs rather than fails if the row can't be written. Never inside a
 * transaction: swallowing the error would leave it aborted, so it rolls back while its caller reports success. Use
 * recordAuditStrict there.
 */
export async function recordAudit(ctx: AppContext, entry: AuditEntry): Promise<void> {
  try {
    await insertAudit(ctx.db, entry);
  } catch (err) {
    ctx.logger.error({ err, action: entry.action }, "Failed to write audit log");
  }
}

/** For a change that must not happen unrecorded, inside its transaction: a failed insert throws and takes the change with it. */
export async function recordAuditStrict(db: DbClient, entry: AuditEntry): Promise<void> {
  await insertAudit(db, entry);
}
