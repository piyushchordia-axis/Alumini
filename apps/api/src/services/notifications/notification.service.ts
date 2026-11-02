import { NOTIFICATION_CATEGORY, notificationLevelFor, type NotificationType } from "@illuminize/shared";
import type { AppContext } from "../../context";
import type { DbClient } from "../../db/client";
import { afterCommit } from "../../lib/transaction";
import { listTenantAdmins } from "../../repositories/memberships.repo";
import { findNotificationPrefsByMemberships, insertNotifications, upsertMergedNotifications, type NotificationInsert } from "../../repositories/notifications.repo";

export interface NotifyInput {
  tenantId: string;
  recipientMembershipIds: string[];
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Ids only (it travels in push payloads, which are capped at 4 KB). */
  data?: Record<string, unknown>;
  /** Makes the notification idempotent per recipient: a repeat (a retried job) adds nothing. */
  dedupeKey?: string;
  /**
   * With dedupeKey: a repeat updates the existing notification (text, data, unread again, moved to the top) instead
   * of being skipped. Updated notifications reach open apps but are not pushed again.
   */
  merge?: boolean;
  /** Sent to many members at once (announcements): open apps get one broadcast instead of a message each. */
  bulk?: boolean;
}

/** Rows per INSERT, well under Postgres's 65,535 bind parameters. */
const INSERT_CHUNK = 1000;
/** Max notification ids per dispatch job (keeps job payloads small). */
const DISPATCH_CHUNK = 500;

/**
 * Stores in-app notifications for the recipients whose preferences allow them, then queues delivery to devices once
 * the data is committed. Works with the root handle or a runInTransaction() transaction (delivery is dropped if it
 * rolls back). The stored rows are the source of truth: if queueing fails, members still see them in the app.
 */
export async function notify(ctx: AppContext, input: NotifyInput, db: DbClient = ctx.db): Promise<void> {
  const all = [...new Set(input.recipientMembershipIds)];
  const alwaysDelivered = NOTIFICATION_CATEGORY[input.type] === "ACCOUNT";
  const toDispatch: string[] = [];
  const toRefresh: string[] = [];
  for (let i = 0; i < all.length; i += INSERT_CHUNK) {
    let ids = all.slice(i, i + INSERT_CHUNK);
    if (!alwaysDelivered) {
      const prefs = await findNotificationPrefsByMemberships(db, ids);
      ids = ids.filter((id) => notificationLevelFor(input.type, prefs.get(id)) !== "OFF");
    }
    const values: NotificationInsert[] = ids.map((recipientMembershipId) => ({
      tenantId: input.tenantId,
      recipientMembershipId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
      dedupeKey: input.dedupeKey ?? null,
    }));
    if (input.merge && input.dedupeKey) {
      for (const row of await upsertMergedNotifications(db, values)) (row.inserted ? toDispatch : toRefresh).push(row.id);
    } else {
      for (const row of await insertNotifications(db, values)) toDispatch.push(row.id);
    }
  }
  const enqueue = (notificationIds: string[], extra: { bulk?: boolean; push?: boolean }) =>
    afterCommit(ctx, db, () => ctx.jobs.enqueue("notifications.dispatch", { tenantId: input.tenantId, notificationIds, ...extra }));
  for (let i = 0; i < toDispatch.length; i += DISPATCH_CHUNK) await enqueue(toDispatch.slice(i, i + DISPATCH_CHUNK), input.bulk ? { bulk: true } : {});
  for (let i = 0; i < toRefresh.length; i += DISPATCH_CHUNK) await enqueue(toRefresh.slice(i, i + DISPATCH_CHUNK), { push: false });
}

export async function notifyTenantAdmins(
  ctx: AppContext,
  input: Omit<NotifyInput, "recipientMembershipIds"> & { excludeMembershipId?: string; excludeMembershipIds?: Array<string | null> },
  db: DbClient = ctx.db,
): Promise<void> {
  const admins = await listTenantAdmins(db, input.tenantId);
  const excluded = new Set([input.excludeMembershipId, ...(input.excludeMembershipIds ?? [])]);
  const recipientMembershipIds = admins.map((a) => a.id).filter((id) => !excluded.has(id));
  await notify(ctx, { ...input, recipientMembershipIds }, db);
}
