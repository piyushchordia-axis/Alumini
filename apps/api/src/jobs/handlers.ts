import { checkPushReceipts, dispatchNotifications, sendPushBatch } from "../services/notifications/dispatch";
import { processMessage, sweepMessages } from "../services/messages/message.service";
import { processPaymentWebhook } from "../services/payments/payment.service";
import { sendInvitationBatch } from "../services/invitations.service";
import { fanoutAnnouncement } from "../services/announcements.service";
import { engagementTick, runCelebrations } from "../services/celebrations.service";
import { runDigest, sendDigestBatch } from "../services/digest.service";
import { pushConversation, pushEvent, pushGroupInvite } from "../services/chat/push";
import type { JobHandlers } from "./JobQueue";

/** The one registry of job handlers; every name in JobPayloads must have one (the type enforces it). */
export const jobHandlers: JobHandlers = {
  "notifications.dispatch": dispatchNotifications,
  "push.send": sendPushBatch,
  "push.checkReceipts": checkPushReceipts,
  "messages.send": (ctx, { messageId }, meta) => processMessage(ctx, messageId, meta),
  "messages.sweep": async (ctx) => {
    await sweepMessages(ctx);
  },
  "payments.webhook": (ctx, { webhookEventId }) => processPaymentWebhook(ctx, webhookEventId),
  "invitations.send": sendInvitationBatch,
  "announcements.fanout": fanoutAnnouncement,
  "engagement.tick": engagementTick,
  "celebrations.tenant": runCelebrations,
  "digest.tenant": runDigest,
  "digest.batch": sendDigestBatch,
  "chat.pushConversation": pushConversation,
  "chat.pushEvent": pushEvent,
  "chat.pushGroupInvite": pushGroupInvite,
};
