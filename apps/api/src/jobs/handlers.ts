import { checkPushReceipts, dispatchNotifications, sendPushBatch } from "../services/notifications/dispatch";
import type { JobHandlers } from "./JobQueue";

/** The one registry of job handlers; every name in JobPayloads must have one (the type enforces it). */
export const jobHandlers: JobHandlers = {
  "notifications.dispatch": dispatchNotifications,
  "push.send": sendPushBatch,
  "push.checkReceipts": checkPushReceipts,
};
