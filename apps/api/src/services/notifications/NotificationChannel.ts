import type { NotificationRow } from "../../repositories/notifications.repo";

export interface NotificationRecipient {
  membershipId: string;
  userId: string;
}

export interface DeliveryContext {
  /** The institution the notifications belong to, so a tap on the device can open the right one. */
  tenantSlug: string;
}

/** Secondary delivery channel (push, email…) invoked after the in-app row is stored. */
export interface NotificationChannel {
  readonly name: string;
  deliver(rows: NotificationRow[], recipients: NotificationRecipient[], context: DeliveryContext): Promise<void>;
}
