import type { DbClient } from "../../db/client";
import type { Logger } from "../../lib/logger";
import type { RedisClient } from "../../redis/client";
import { keys } from "../../redis/keys";
import type { NotificationRow } from "../../repositories/notifications.repo";
import { deletePushTokensByValue, listPushTokensForUsers } from "../../repositories/users.repo";
import type { DeliveryContext, NotificationChannel, NotificationRecipient } from "./NotificationChannel";

const SEND_URL = "https://exp.host/--/api/v2/push/send";
const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
/** Expo publishes receipts within ~15 minutes and keeps them for a day. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default";
  channelId?: string;
}

/** A ticket (send response) or receipt: https://docs.expo.dev/push-notifications/sending-notifications/#push-tickets */
interface ExpoStatus {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

const isExpoToken = (t: string) => t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[");

/**
 * Delivers notifications through the Expo push service. Tokens Expo reports as DeviceNotRegistered (app
 * uninstalled, permission revoked) are deleted straight away from the send tickets, and again later from the
 * delivery receipts, which `checkReceipts` reads.
 */
export class ExpoPushChannel implements NotificationChannel {
  readonly name = "expo-push";

  constructor(
    private readonly db: DbClient,
    private readonly redis: RedisClient,
    private readonly logger: Logger,
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  async deliver(rows: NotificationRow[], recipients: NotificationRecipient[], context: DeliveryContext): Promise<void> {
    if (rows.length === 0) return;
    const userByMembership = new Map(recipients.map((r) => [r.membershipId, r.userId]));
    const tokens = await listPushTokensForUsers(this.db, [...new Set(recipients.map((r) => r.userId))]);
    if (tokens.length === 0) return;
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokens) {
      if (!isExpoToken(t.token)) continue;
      tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);
    }
    const messages: ExpoPushMessage[] = [];
    for (const row of rows) {
      const userId = userByMembership.get(row.recipientMembershipId);
      if (!userId) continue;
      for (const token of tokensByUser.get(userId) ?? []) {
        messages.push({
          to: token,
          title: row.title,
          body: row.body ?? undefined,
          data: { ...row.data, notificationId: row.id, type: row.type, tenantSlug: context.tenantSlug },
          sound: "default",
          channelId: "default",
        });
      }
    }
    for (let i = 0; i < messages.length; i += 100) await this.sendBatch(messages.slice(i, i + 100));
  }

  private async sendBatch(batch: ExpoPushMessage[]): Promise<void> {
    let tickets: ExpoStatus[] = [];
    try {
      const res = await this.fetchImpl(SEND_URL, { method: "POST", headers: this.headers(), body: JSON.stringify(batch), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, "Expo push send failed");
        return;
      }
      tickets = ((await res.json()) as { data?: ExpoStatus[] }).data ?? [];
    } catch (err) {
      this.logger.warn({ err }, "Expo push send errored");
      return;
    }
    // Tickets come back in the same order as the messages.
    const dead: string[] = [];
    const now = Date.now();
    const pending: Array<string | number> = [];
    tickets.forEach((ticket, i) => {
      const token = batch[i]?.to;
      if (!token) return;
      if (ticket.status === "ok" && ticket.id) pending.push(now, `${ticket.id}|${token}`);
      else if (ticket.details?.error === "DeviceNotRegistered") dead.push(token);
      else if (ticket.status === "error") this.logger.warn({ error: ticket.details?.error, message: ticket.message }, "Expo push ticket error");
    });
    if (pending.length) await this.redis.zadd(keys.pushReceipts(), ...pending);
    await this.removeTokens(dead);
  }

  private async removeTokens(tokens: string[]): Promise<void> {
    if (!tokens.length) return;
    const removed = await deletePushTokensByValue(this.db, [...new Set(tokens)]);
    this.logger.info({ removed }, "Removed push tokens Expo reported as not registered");
  }

  /**
   * Reads delivery receipts for tickets sent at least RECEIPT_DELAY_MS ago and removes dead tokens. Safe to call from
   * several processes; each call handles up to 1000 receipts. Returns what it processed.
   */
  async checkReceipts(now = Date.now()): Promise<{ checked: number; removedTokens: number }> {
    const key = keys.pushReceipts();
    await this.redis.zremrangebyscore(key, "-inf", now - RECEIPT_MAX_AGE_MS);
    const due = await this.redis.zrangebyscore(key, "-inf", now - RECEIPT_DELAY_MS, "LIMIT", 0, 1000);
    if (due.length === 0) return { checked: 0, removedTokens: 0 };
    const tokenByTicket = new Map(due.map((m) => m.split("|") as [string, string]));
    let receipts: Record<string, ExpoStatus> = {};
    try {
      const res = await this.fetchImpl(RECEIPTS_URL, { method: "POST", headers: this.headers(), body: JSON.stringify({ ids: [...tokenByTicket.keys()] }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        this.logger.warn({ status: res.status }, "Expo receipts request failed");
        return { checked: 0, removedTokens: 0 };
      }
      receipts = ((await res.json()) as { data?: Record<string, ExpoStatus> }).data ?? {};
    } catch (err) {
      this.logger.warn({ err }, "Expo receipts request errored");
      return { checked: 0, removedTokens: 0 };
    }
    const dead: string[] = [];
    for (const [ticketId, receipt] of Object.entries(receipts)) {
      if (receipt.status !== "error") continue;
      if (receipt.details?.error === "DeviceNotRegistered") dead.push(tokenByTicket.get(ticketId)!);
      else this.logger.warn({ error: receipt.details?.error, message: receipt.message }, "Expo push receipt error");
    }
    // Receipts not yet published stay queued until they age out; the rest are done.
    const done = due.filter((m) => m.split("|")[0]! in receipts);
    if (done.length) await this.redis.zrem(key, ...done);
    await this.removeTokens(dead.filter(Boolean));
    return { checked: done.length, removedTokens: new Set(dead).size };
  }
}
