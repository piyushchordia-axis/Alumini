import type { z } from "zod";
import { booleanQuerySchema, cursorQuerySchema } from "./common";

export const notificationsQuerySchema = cursorQuerySchema.extend({
  unreadOnly: booleanQuerySchema.optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
