import type { NotificationType } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import { afterCommit } from "../../lib/transaction";
import { listTenantAdmins } from "../../repositories/memberships.repo";
import { insertNotifications } from "../../repositories/notifications.repo";

export interface NotifyInput {
  tenantId: string;
  recipientMembershipIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  data?: Record<string, unknown>;
}

/** Max notification ids per dispatch job (keeps job payloads small). */
const DISPATCH_CHUNK = 500;

/**
 * Stores in-app notifications, then queues their delivery to devices once the data is committed. Works with the root
 * handle or a runInTransaction() transaction (delivery is dropped if it rolls back). The stored rows are the source of
 * truth: if queueing fails, members still see them in the app.
 */
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
  const notificationIds = rows.map((r) => r.id);
  for (let i = 0; i < notificationIds.length; i += DISPATCH_CHUNK) {
    const chunk = notificationIds.slice(i, i + DISPATCH_CHUNK);
    await afterCommit(ctx, db, () => ctx.jobs.enqueue("notifications.dispatch", { tenantId: input.tenantId, notificationIds: chunk }));
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
