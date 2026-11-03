import type { NotificationRow } from "../../repositories/notifications.repo";

export interface NotificationRecipient {
  membershipId: string;
  userId: string;
}

export interface DeliveryContext {
  /** The institution the notifications belong to, so a tap on the device can open the right one. */
  tenantSlug: string;
}

/** One push message for one device token (Expo format). Plain JSON so it can travel in a job payload. */
export interface PushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default";
  channelId?: string;
  /** Seconds Expo and the platforms keep trying to reach a device that's off. Left out, it's up to a month. */
  ttl?: number;
}

/** One push to all of a user's devices, for what has no stored notification behind it. */
export interface PushItem {
  userId: string;
  title: string;
  body?: string;
  data: Record<string, unknown>;
}

/**
 * Push delivery, split so the job queue can retry each provider request on its own:
 * prepare() resolves device tokens into messages, sendBatch() sends one request.
 */
export interface PushChannel {
  readonly name: string;
  prepare(rows: NotificationRow[], recipients: NotificationRecipient[], context: DeliveryContext): Promise<PushMessage[]>;
  prepareFor(items: PushItem[], context: DeliveryContext): Promise<PushMessage[]>;
  /** prepareFor, kept apart per item, in the items' order, so a caller can tell whose devices a batch reaches. */
  prepareEach(items: PushItem[], context: DeliveryContext): Promise<PushMessage[][]>;
  sendBatch(batch: PushMessage[]): Promise<void>;
  /** prepare + sendBatch in one go, logging failures. */
  deliver(rows: NotificationRow[], recipients: NotificationRecipient[], context: DeliveryContext): Promise<void>;
  checkReceipts(now?: number): Promise<{ checked: number; removedTokens: number }>;
}

/** A push provider error; retryable errors make the job retry with backoff. */
export class PushSendError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "PushSendError";
  }
}
