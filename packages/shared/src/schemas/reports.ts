import { z } from "zod";
import { CONTENT_TYPES, REPORT_REASONS, REPORT_STATUSES } from "../constants";
import { cursorQuerySchema, optionalTrimmed, pageQuerySchema, uuidSchema } from "./common";

export const reportCreateSchema = z.object({
  contentType: z.enum(CONTENT_TYPES),
  contentId: uuidSchema,
  reason: z.enum(REPORT_REASONS),
  details: optionalTrimmed(1000),
});
export type ReportCreateInput = z.infer<typeof reportCreateSchema>;

export const myReportsQuerySchema = cursorQuerySchema;

export const reportResolveSchema = z.object({
  action: z.enum(["REMOVE_CONTENT", "NONE"]),
  note: optionalTrimmed(500),
});
export type ReportResolveInput = z.infer<typeof reportResolveSchema>;

export const reportDismissSchema = z.object({ note: optionalTrimmed(500) });
export type ReportDismissInput = z.infer<typeof reportDismissSchema>;

export const adminReportsQuerySchema = pageQuerySchema.extend({
  status: z.enum(REPORT_STATUSES).default("OPEN"),
  contentType: z.enum(CONTENT_TYPES).optional(),
});
export type AdminReportsQuery = z.infer<typeof adminReportsQuerySchema>;
