import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { auditLog } from "../db/schema";

export interface AuditEntry {
  tenantId?: string | null;
  actorUserId?: string | null;
  actorMembershipId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

export async function recordAudit(ctx: AppContext, entry: AuditEntry, db: DbClient = ctx.db): Promise<void> {
  try {
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
  } catch (err) {
    ctx.logger.error({ err, action: entry.action }, "Failed to write audit log");
  }
}
