import type { NotificationRow } from "../../repositories/notifications.repo";

export interface NotificationRecipient {
  membershipId: string;
  userId: string;
}

/** Secondary delivery channel (push, email…) invoked after the in-app row is stored. */
export interface NotificationChannel {
  readonly name: string;
  deliver(rows: NotificationRow[], recipients: NotificationRecipient[]): Promise<void>;
}
