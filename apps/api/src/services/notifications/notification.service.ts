import type { NotificationType } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import { findMembershipsByIds, listTenantAdmins } from "../../repositories/memberships.repo";
import { insertNotifications } from "../../repositories/notifications.repo";

export interface NotifyInput {
  tenantId: string;
  recipientMembershipIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

/** Stores in-app notifications and forwards them to the optional push channel. */
export async function notify(ctx: AppContext, input: NotifyInput, db: DbClient = ctx.db): Promise<void> {
  const ids = [...new Set(input.recipientMembershipIds)];
  if (ids.length === 0) return;
  const rows = await insertNotifications(
    db,
    ids.map((recipientMembershipId) => ({
      tenantId: input.tenantId,
      recipientMembershipId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
    })),
  );
  if (ctx.push) {
    const recipients = await findMembershipsByIds(db, input.tenantId, ids);
    const push = ctx.push;
    void push
      .deliver(
        rows,
        recipients.map((m) => ({ membershipId: m.id, userId: m.userId })),
      )
      .catch((err) => ctx.logger.warn({ err }, "push delivery failed"));
  }
}

export async function notifyTenantAdmins(
  ctx: AppContext,
  input: Omit<NotifyInput, "recipientMembershipIds"> & { excludeMembershipId?: string },
  db: DbClient = ctx.db,
): Promise<void> {
  const admins = await listTenantAdmins(db, input.tenantId);
  const recipientMembershipIds = admins.map((a) => a.id).filter((id) => id !== input.excludeMembershipId);
  await notify(ctx, { ...input, recipientMembershipIds }, db);
}
