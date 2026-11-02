import { NOTIFICATION_CATEGORY, notificationLevelFor } from "@illuminize/shared";
import type { JobHandler } from "../../jobs/JobQueue";
import { PermanentJobError } from "../../jobs/JobQueue";
import { findMembershipsByIds } from "../../repositories/memberships.repo";
import { toNotificationDto } from "../../dto/membership.dto";
import { rooms } from "../../realtime/rooms";
import { countUnreadByMemberships, findNotificationPrefsByMemberships, findNotificationsByIds } from "../../repositories/notifications.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { PUSH_BATCH_SIZE } from "./ExpoPushChannel";
import { PushSendError } from "./NotificationChannel";

/** User rooms per realtime broadcast (each room name rides in the one adapter message). */
const BROADCAST_ROOMS = 1000;

/**
 * Delivers stored notifications to devices: tells open apps, then (for members whose preferences include push)
 * resolves push tokens and queues one push request per 100 messages so each can be retried on its own. Rows deleted
 * in the meantime are simply skipped.
 */
export const dispatchNotifications: JobHandler<"notifications.dispatch"> = async (ctx, { tenantId, notificationIds, bulk, push }) => {
  const stored = await findNotificationsByIds(ctx.db, tenantId, notificationIds);
  if (stored.length === 0) return;
  const tenant = await findTenantById(ctx.db, tenantId);
  if (!tenant) return;
  const recipients = await findMembershipsByIds(ctx.db, tenantId, [...new Set(stored.map((r) => r.recipientMembershipId))]);
  // Someone suspended, pending or rejected still hears about their own account, and nothing else.
  const statusOf = new Map(recipients.map((m) => [m.id, m.status]));
  const rows = stored.filter((r) => NOTIFICATION_CATEGORY[r.type] === "ACCOUNT" || statusOf.get(r.recipientMembershipId) === "APPROVED");
  if (rows.length === 0) return;

  // Open apps update the bell straight away.
  const userByMembership = new Map(recipients.map((m) => [m.id, m.userId]));
  if (bulk) {
    // One notification to many members: one broadcast per batch of rooms; apps refetch their own counts.
    const first = rows[0]!;
    const postId = typeof first.data.postId === "string" ? first.data.postId : undefined;
    const userRooms = [...new Set(rows.map((r) => userByMembership.get(r.recipientMembershipId)).filter((u): u is string => !!u))].map((u) => rooms.user(u));
    for (let i = 0; i < userRooms.length; i += BROADCAST_ROOMS) {
      ctx.realtime.emit(userRooms.slice(i, i + BROADCAST_ROOMS), "notification:bulk", { tenantSlug: tenant.slug, type: first.type, ...(postId ? { postId } : {}) });
    }
  } else {
    const unread = await countUnreadByMemberships(ctx.db, [...userByMembership.keys()]);
    for (const row of rows) {
      const userId = userByMembership.get(row.recipientMembershipId);
      if (!userId) continue;
      ctx.realtime.emit(rooms.user(userId), "notification:new", {
        tenantSlug: tenant.slug,
        membershipId: row.recipientMembershipId,
        notification: toNotificationDto(row),
        unreadCount: unread.get(row.recipientMembershipId) ?? 0,
      });
    }
  }

  if (!ctx.push || push === false) return;
  // Preferences are read again here: a member may have turned push off since the notification was stored.
  const prefs = await findNotificationPrefsByMemberships(ctx.db, [...userByMembership.keys()]);
  const pushRows = rows.filter((r) => notificationLevelFor(r.type, prefs.get(r.recipientMembershipId)) === "IN_APP_PUSH");
  if (pushRows.length === 0) return;
  const messages = await ctx.push.prepare(
    pushRows,
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
