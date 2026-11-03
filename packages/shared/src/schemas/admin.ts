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

export const moderationActionSchema = z.object({
  note: optionalTrimmed(500),
  /**
   * The name and description the admin approved, as shown to them. Required to approve a group, whose owner can change
   * both while it waits: approving publishes them to its members, so it's refused if they no longer match.
   */
  reviewed: z.object({ name: z.string().max(500), description: z.string().max(5000).nullable() }).optional(),
});
export type ModerationActionInput = z.infer<typeof moderationActionSchema>;

export const contentRefParamsSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  id: uuidSchema,
});
export type ContentRefParams = z.infer<typeof contentRefParamsSchema>;

/** Admin analytics: the last N weeks (Monday-start, in the institution's time zone), including the current week. */
export const analyticsQuerySchema = z.object({ weeks: z.coerce.number().int().min(4).max(104).default(12) });
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;
