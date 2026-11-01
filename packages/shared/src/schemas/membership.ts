import { z } from "zod";
import { CELEBRATION_KINDS, MARITAL_STATUSES, MEMBERSHIP_ROLES, MEMBERSHIP_STATUSES, MIN_BATCH_YEAR, PROFESSION_TYPES } from "../constants";
import { dateOnlySchema, httpUrlSchema, isoCountrySchema, optionalTrimmed, pageQuerySchema, trimmedString, uuidSchema } from "./common";
import { profileFieldAnswersSchema } from "./profileFields";

const currentYear = new Date().getFullYear();

const dateOfBirthSchema = dateOnlySchema.refine((d) => {
  const dob = new Date(d);
  if (Number.isNaN(dob.getTime())) return false;
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  return dob <= tenYearsAgo && dob.getFullYear() >= 1900;
}, "Enter a valid date of birth");

const linkedinSchema = httpUrlSchema.refine((u) => /linkedin\.com\//i.test(u), "Must be a linkedin.com profile URL");

export const membershipProfileSchema = z.object({
  fullName: trimmedString(100, 2),
  batchYear: z.coerce.number().int().min(MIN_BATCH_YEAR).max(currentYear + 10),
  dateOfBirth: dateOfBirthSchema.nullable().optional(),
  professionType: z.enum(PROFESSION_TYPES),
  companyName: optionalTrimmed(120),
  designation: optionalTrimmed(120),
  city: optionalTrimmed(80),
  country: isoCountrySchema.nullable().optional(),
  maritalStatus: z.enum(MARITAL_STATUSES).nullable().optional(),
  kidsCount: z.number().int().min(0).max(20).nullable().optional(),
  bio: optionalTrimmed(1000),
  linkedinUrl: linkedinSchema.nullable().optional(),
  interests: z.array(trimmedString(40)).max(20).optional(),
  avatarUrl: httpUrlSchema.nullable().optional(),
  isPhoneVisible: z.boolean().optional(),
  /** Show my birthday (day and month only) on the feed on the day. */
  celebrateBirthday: z.boolean().optional(),
  /** Show my membership anniversary on the feed. */
  celebrateAnniversary: z.boolean().optional(),
  /** Answers to the institution's own profile questions, by field key. */
  fields: profileFieldAnswersSchema.optional(),
});
export type MembershipProfileInput = z.infer<typeof membershipProfileSchema>;

export const membershipProfileUpdateSchema = membershipProfileSchema.partial();
export type MembershipProfileUpdate = z.infer<typeof membershipProfileUpdateSchema>;

export const memberReasonSchema = z.object({ reason: trimmedString(500, 3) });
export type MemberReasonInput = z.infer<typeof memberReasonSchema>;

export const memberRoleSchema = z.object({ role: z.enum(MEMBERSHIP_ROLES) });
export type MemberRoleInput = z.infer<typeof memberRoleSchema>;

export const membershipIdParamsSchema = z.object({ membershipId: uuidSchema });

export const adminMembersQuerySchema = pageQuerySchema.extend({
  status: z.enum(MEMBERSHIP_STATUSES).optional(),
  role: z.enum(MEMBERSHIP_ROLES).optional(),
  batchYear: z.coerce.number().int().optional(),
  q: z.string().trim().max(80).optional(),
});
export type AdminMembersQuery = z.infer<typeof adminMembersQuerySchema>;

export const celebrationWishSchema = z.object({ kind: z.enum(CELEBRATION_KINDS) });
export type CelebrationWishInput = z.infer<typeof celebrationWishSchema>;
