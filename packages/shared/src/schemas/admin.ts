import { z } from "zod";
import { pageQuerySchema, uuidSchema } from "./common";

export const auditQuerySchema = pageQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  actorUserId: uuidSchema.optional(),
  tenantId: uuidSchema.optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;
