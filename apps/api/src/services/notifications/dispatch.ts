import type { JobHandler } from "../../jobs/JobQueue";
import { PermanentJobError } from "../../jobs/JobQueue";
import { findMembershipsByIds } from "../../repositories/memberships.repo";
import { findNotificationsByIds } from "../../repositories/notifications.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { PUSH_BATCH_SIZE } from "./ExpoPushChannel";
import { PushSendError } from "./NotificationChannel";

/**
 * Delivers stored notifications to devices: resolves recipients and push tokens, then queues one push request per
 * 100 messages so each can be retried on its own. Rows deleted in the meantime are simply skipped.
 */
export const dispatchNotifications: JobHandler<"notifications.dispatch"> = async (ctx, { tenantId, notificationIds }) => {
  const rows = await findNotificationsByIds(ctx.db, tenantId, notificationIds);
  if (rows.length === 0) return;
  const tenant = await findTenantById(ctx.db, tenantId);
  if (!tenant) return;
  const recipients = await findMembershipsByIds(ctx.db, tenantId, [...new Set(rows.map((r) => r.recipientMembershipId))]);
  if (!ctx.push) return;
  const messages = await ctx.push.prepare(
    rows,
    recipients.map((m) => ({ membershipId: m.id, userId: m.userId })),
    { tenantSlug: tenant.slug },
  );
  for (let i = 0; i < messages.length; i += PUSH_BATCH_SIZE) {
    await ctx.jobs.enqueue("push.send", { messages: messages.slice(i, i + PUSH_BATCH_SIZE) });
  }
};

export const sendPushBatch: JobHandler<"push.send"> = async (ctx, { messages }) => {
  if (!ctx.push) return;
  try {
    await ctx.push.sendBatch(messages);
  } catch (err) {
    if (err instanceof PushSendError && !err.retryable) throw new PermanentJobError(err.message, { cause: err });
    throw err;
  }
};

export const checkPushReceipts: JobHandler<"push.checkReceipts"> = async (ctx) => {
  if (!ctx.push) return;
  const result = await ctx.push.checkReceipts();
  if (result.checked) ctx.logger.info(result, "Checked Expo push receipts");
};
