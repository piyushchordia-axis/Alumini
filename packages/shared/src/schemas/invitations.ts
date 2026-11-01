import { z } from "zod";
import { INVITATION_STATUSES, MAX_INVITE_IMPORT_ROWS } from "../constants";
import { pageQuerySchema, uuidSchema } from "./common";
import { profileFieldAnswersSchema } from "./profileFields";

/**
 * One imported row as the browser parsed it. Deliberately loose: each row is checked by the API and reported back
 * (created, updated, already a member, or invalid with a reason) instead of failing the whole file.
 */
export const invitationImportRowSchema = z.object({
  phone: z.string().max(40),
  name: z.string().max(200).nullish(),
  batchYear: z.union([z.number(), z.string().max(10)]).nullish(),
  email: z.string().max(254).nullish(),
  fields: profileFieldAnswersSchema.optional(),
});
export type InvitationImportRow = z.infer<typeof invitationImportRowSchema>;

export const invitationImportSchema = z.object({
  rows: z.array(invitationImportRowSchema).min(1).max(MAX_INVITE_IMPORT_ROWS),
  /** Send the invitations right away (when the plan includes a channel). */
  send: z.boolean().default(false),
  /** Rows already sent in earlier chunks of the same file, so reported row numbers match the file. */
  rowOffset: z.number().int().min(0).max(1_000_000).default(0),
});
export type InvitationImportInput = z.infer<typeof invitationImportSchema>;

export const invitationsQuerySchema = pageQuerySchema.extend({
  status: z.enum([...INVITATION_STATUSES, "EXPIRED"]).optional(),
  q: z.string().trim().max(80).optional(),
});
export type InvitationsQuery = z.infer<typeof invitationsQuerySchema>;

export const invitationIdParamsSchema = z.object({ invitationId: uuidSchema });
export const invitationSendSchema = z.object({ ids: z.array(uuidSchema).min(1).max(MAX_INVITE_IMPORT_ROWS) });
export type InvitationSendInput = z.infer<typeof invitationSendSchema>;

/** The token in an invite link (/i/:token). */
export const inviteTokenParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) });
