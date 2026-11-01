import { z } from "zod";
import { CONTENT_TYPES, MODERATION_STATUSES } from "../constants";
import { optionalTrimmed, pageQuerySchema, uuidSchema } from "./common";

export const auditQuerySchema = pageQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  actorUserId: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;


export const moderationQuerySchema = pageQuerySchema.extend({
  status: z.enum(MODERATION_STATUSES).default("PENDING"),
  contentType: z.enum(CONTENT_TYPES).optional(),
});
export type ModerationQuery = z.infer<typeof moderationQuerySchema>;

export const moderationActionSchema = z.object({ note: optionalTrimmed(500) });
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const contentRefParamsSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  id: uuidSchema,
});
export type ContentRefParams = z.infer<typeof contentRefParamsSchema>;

/** Admin analytics: the last N weeks (Monday-start, in the institution's time zone), including the current week. */
export const analyticsQuerySchema = z.object({ weeks: z.coerce.number().int().min(4).max(104).default(12) });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
