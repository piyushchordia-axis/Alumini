import type { PushMessage } from "../services/notifications/NotificationChannel";

/**
 * Every background job and its payload. Payloads are plain JSON (they are stored in Redis), so pass ids and small
 * values, never rows or class instances. Add new jobs here, give them a policy below and a handler in handlers.ts.
 */
export interface JobPayloads {
  /** Deliver freshly stored notifications to devices (push now; realtime from B3). */
  "notifications.dispatch": {
    tenantId: string;
    notificationIds: string[];
    /** One realtime broadcast for all recipients instead of a message each (announcements). */
    bulk?: boolean;
    /** false: realtime only, no push (a merged notification that was already pushed). */
    push?: boolean;
  };
  /** One Expo push request (at most 100 messages). */
  "push.send": { messages: PushMessage[] };
  /** Read Expo delivery receipts and drop tokens of uninstalled apps. */
  "push.checkReceipts": Record<string, never>;
  /** Send one outbound WhatsApp/SMS/email message (outbound_messages row). */
  "messages.send": { messageId: string };
  /** Re-queue outbound messages a crash left behind. */
  "messages.sweep": Record<string, never>;
  /** Apply one stored payment webhook (payment_webhook_events row). */
  "payments.webhook": { webhookEventId: string };
  /** Send (or resend) a batch of invitations over the channels the institution's plan allows. */
  "invitations.send": { tenantId: string; invitationIds: string[] };
  /** Deliver an announcement to one page of members (each page queues the next). */
  "announcements.fanout": { tenantId: string; postId: string; afterMembershipId?: string | null };
  /** Every 15 minutes: queue per-institution scheduled work whose local time has come (celebrations, digest). */
  "engagement.tick": { at?: string };
  /** Birthday and anniversary greetings in one institution for one local day. */
  "celebrations.tenant": { tenantId: string; day: string };
}

export type JobName = keyof JobPayloads;

/** Queues are split by workload so slow provider calls (messages) never hold up internal jobs. */
export const QUEUE_NAMES = ["jobs", "messages"] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

export interface JobPolicy {
  queue: QueueName;
  /** Total tries, including the first. */
  attempts: number;
  backoff?: { type: "exponential" | "fixed"; delayMs: number };
}

export const JOB_POLICIES: { [N in JobName]: JobPolicy } = {
  "notifications.dispatch": { queue: "jobs", attempts: 3, backoff: { type: "exponential", delayMs: 5_000 } },
  "push.send": { queue: "jobs", attempts: 5, backoff: { type: "exponential", delayMs: 10_000 } },
  "push.checkReceipts": { queue: "jobs", attempts: 1 },
  // Retries at roughly 30s, 1m, 2m and 4m before the message is marked FAILED.
  "messages.send": { queue: "messages", attempts: 5, backoff: { type: "exponential", delayMs: 30_000 } },
  "messages.sweep": { queue: "jobs", attempts: 1 },
  "payments.webhook": { queue: "jobs", attempts: 8, backoff: { type: "exponential", delayMs: 10_000 } },
  "invitations.send": { queue: "jobs", attempts: 3, backoff: { type: "exponential", delayMs: 10_000 } },
  "announcements.fanout": { queue: "jobs", attempts: 5, backoff: { type: "exponential", delayMs: 10_000 } },
  "engagement.tick": { queue: "jobs", attempts: 1 },
  "celebrations.tenant": { queue: "jobs", attempts: 3, backoff: { type: "exponential", delayMs: 30_000 } },
};
