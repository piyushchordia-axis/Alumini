import { z } from "zod";
import { JOB_TYPES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, isoDateTimeSchema, optionalTrimmed, trimmedString } from "./common";

export const jobCreateSchema = z.object({
  title: trimmedString(150, 3),
  companyName: trimmedString(120, 1),
  location: optionalTrimmed(120),
  isRemote: z.boolean().optional(),
  jobType: z.enum(JOB_TYPES),
  description: trimmedString(5000, 10),
  applyUrl: httpUrlSchema.nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: optionalTrimmed(24),
  salaryRange: optionalTrimmed(80),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  /** "I can refer people for this job". Ignored while referrals are off here, or from a poster who is a current pupil. */
  canRefer: z.boolean().optional(),
});
export type JobCreateInput = z.infer<typeof jobCreateSchema>;

export const jobUpdateSchema = jobCreateSchema.partial();
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;

export const jobListQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  remote: booleanQuerySchema.optional(),
  location: z.string().trim().max(80).optional(),
  includeClosed: booleanQuerySchema.optional(),
  mine: booleanQuerySchema.optional(),
  /** Jobs whose poster can refer people, as the list shows `canRefer`. */
  canRefer: booleanQuerySchema.optional(),
});
export type JobListQuery = z.infer<typeof jobListQuerySchema>;

export const jobSeekerUpsertSchema = z.object({
  note: trimmedString(500, 1),
  preferredRoles: optionalTrimmed(200),
  preferredLocations: optionalTrimmed(200),
  isActive: z.boolean().optional(),
});
export type JobSeekerUpsertInput = z.infer<typeof jobSeekerUpsertSchema>;
