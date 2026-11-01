import { z } from "zod";
import { CONFIGURABLE_CATEGORIES, NOTIFICATION_LEVELS, type ConfigurableCategory } from "../lib/notifications";
import { booleanQuerySchema, cursorQuerySchema } from "./common";

export const notificationsQuerySchema = cursorQuerySchema.extend({
  unreadOnly: booleanQuerySchema.optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const notificationPrefsUpdateSchema = z
  .object({
    categories: z
      .object(Object.fromEntries(CONFIGURABLE_CATEGORIES.map((c) => [c, z.enum(NOTIFICATION_LEVELS)])) as Record<ConfigurableCategory, z.ZodEnum<{ OFF: "OFF"; IN_APP: "IN_APP"; IN_APP_PUSH: "IN_APP_PUSH" }>>)
      .partial(),
    digestEmail: z.boolean(),
    announcementMessages: z.boolean(),
    /** Set to true to record that the celebrations notice was seen. */
    celebrationsNoticeSeen: z.literal(true),
  })
  .partial();
export type NotificationPrefsUpdate = z.infer<typeof notificationPrefsUpdateSchema>;

/** Query for the public unsubscribe endpoints (the token comes from an email link). */
export const unsubscribeQuerySchema = z.object({ token: z.string().trim().min(20).max(300) });
