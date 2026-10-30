import type { DbClient } from "../../db/client";
import type { Logger } from "../../lib/logger";
import { listPushTokensForUsers } from "../../repositories/users.repo";
import type { NotificationRow } from "../../repositories/notifications.repo";
import type { NotificationChannel, NotificationRecipient } from "./NotificationChannel";

interface ExpoPushMessage {
  to: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  sound?: "default";
}

/** Delivers notifications through the Expo push service (https://docs.expo.dev/push-notifications/sending-notifications/). */
export class ExpoPushChannel implements NotificationChannel {
  readonly name = "expo-push";

  constructor(
    private readonly db: DbClient,
    private readonly logger: Logger,
    private readonly accessToken?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(rows: NotificationRow[], recipients: NotificationRecipient[]): Promise<void> {
    if (rows.length === 0) return;
    const userByMembership = new Map(recipients.map((r) => [r.membershipId, r.userId]));
    const tokens = await listPushTokensForUsers(this.db, [...new Set(recipients.map((r) => r.userId))]);
    if (tokens.length === 0) return;
    const tokensByUser = new Map<string, string[]>();
    for (const t of tokens) {
      if (!t.token.startsWith("ExponentPushToken[") && !t.token.startsWith("ExpoPushToken[")) continue;
      tokensByUser.set(t.userId, [...(tokensByUser.get(t.userId) ?? []), t.token]);
    }
    const messages: ExpoPushMessage[] = [];
    for (const row of rows) {
      const userId = userByMembership.get(row.recipientMembershipId);
      if (!userId) continue;
      for (const token of tokensByUser.get(userId) ?? []) {
        messages.push({ to: token, title: row.title, body: row.body ?? undefined, data: { ...row.data, notificationId: row.id, type: row.type }, sound: "default" });
      }
    }
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      try {
        const res = await this.fetchImpl("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) this.logger.warn({ status: res.status }, "Expo push send failed");
      } catch (err) {
        this.logger.warn({ err }, "Expo push send errored");
      }
    }
  }
}
