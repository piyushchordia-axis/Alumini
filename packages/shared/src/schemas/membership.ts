import { z } from "zod";
import {
  CELEBRATION_KINDS,
  INDUSTRIES,
  MARITAL_STATUSES,
  MEMBER_BACKDROPS,
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  MIN_BATCH_YEAR,
  OPEN_TO,
  PROFESSION_TYPES,
  PROFILE_DEGREE_MAX_LENGTH,
  PROFILE_EDUCATION_YEARS_AHEAD,
  PROFILE_HEADLINE_MAX_LENGTH,
  PROFILE_HISTORY_NAME_MAX_LENGTH,
  PROFILE_MAX_EDUCATION,
  PROFILE_MAX_EXPERIENCES,
  PROFILE_MAX_SKILLS,
  PROFILE_MIN_YEAR,
  SKILL_MAX_LENGTH,
} from "../constants";
import type { ProfileEducationDto, ProfileExperienceDto } from "../types/dto";
import {
  dateOnlySchema,
  hostUrlSchema,
  httpUrlSchema,
  isoCountrySchema,
  linkUrlSchema,
  optionalTrimmed,
  pageQuerySchema,
  skillListSchema,
  tenantSlugSchema,
  trimmedString,
  uuidSchema,
} from "./common";
import { profileFieldAnswersSchema } from "./profileFields";

const currentYear = new Date().getFullYear();

const dateOfBirthSchema = dateOnlySchema.refine((d) => {
  const dob = new Date(d);
  if (Number.isNaN(dob.getTime())) return false;
  const tenYearsAgo = new Date();
  tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
  return dob <= tenYearsAgo && dob.getFullYear() >= 1900;
}, "Enter a valid date of birth");

/**
 * A year from PROFILE_MIN_YEAR to `ahead` years from now. "Now" is when the input is parsed, not when this module loaded,
 * which in a server that runs for months would be a year or more ago.
 */
const profileYearSchema = (ahead = 0) =>
  z
    .number()
    .int("Enter a year")
    .min(PROFILE_MIN_YEAR, `Use a year from ${PROFILE_MIN_YEAR} on`)
    .refine((y) => y <= new Date().getFullYear() + ahead, ahead === 0 ? "This year at the latest" : "Too far in the future");

const endNotBeforeStart = (v: { startYear?: number | null; endYear?: number | null }, c: z.RefinementCtx) => {
  if (v.startYear != null && v.endYear != null && v.endYear < v.startYear) c.addIssue({ code: "custom", path: ["endYear"], message: "Can't be before the start year" });
};

/** A past role. The current one is the profile's company and designation. */
export const profileExperienceSchema = z
  .object({
    company: trimmedString(PROFILE_HISTORY_NAME_MAX_LENGTH),
    title: trimmedString(PROFILE_HISTORY_NAME_MAX_LENGTH),
    startYear: profileYearSchema().nullish(),
    endYear: profileYearSchema().nullish(),
  })
  .superRefine(endNotBeforeStart)
  .transform((v): ProfileExperienceDto => ({ company: v.company, title: v.title, startYear: v.startYear ?? null, endYear: v.endYear ?? null }));
export type ProfileExperienceInput = z.input<typeof profileExperienceSchema>;

/** Studies elsewhere, which may still be under way (an end year up to PROFILE_EDUCATION_YEARS_AHEAD ahead). */
export const profileEducationSchema = z
  .object({
    institution: trimmedString(PROFILE_HISTORY_NAME_MAX_LENGTH),
    degree: optionalTrimmed(PROFILE_DEGREE_MAX_LENGTH),
    fieldOfStudy: optionalTrimmed(PROFILE_DEGREE_MAX_LENGTH),
    startYear: profileYearSchema().nullish(),
    endYear: profileYearSchema(PROFILE_EDUCATION_YEARS_AHEAD).nullish(),
  })
  .superRefine(endNotBeforeStart)
  .transform(
    (v): ProfileEducationDto => ({ institution: v.institution, degree: v.degree, fieldOfStudy: v.fieldOfStudy, startYear: v.startYear ?? null, endYear: v.endYear ?? null }),
  );
export type ProfileEducationInput = z.input<typeof profileEducationSchema>;

/**
 * The links on a profile, each checked by its URL's own hostname and stored as the URL parser read it (see
 * linkUrlSchema). Links are full URLs: the forms turn a typed "@handle" into one (socialUrlFromInput).
 */
export const profileLinkSchemas = {
  linkedinUrl: hostUrlSchema(["linkedin.com"]),
  websiteUrl: linkUrlSchema,
  githubUrl: hostUrlSchema(["github.com"]),
  instagramUrl: hostUrlSchema(["instagram.com"]),
  xUrl: hostUrlSchema(["x.com", "twitter.com"]),
} as const;
export type ProfileLinkKey = keyof typeof profileLinkSchemas;

/** Stored in OPEN_TO's order, each once. */
const openToSchema = z
  .array(z.enum(OPEN_TO))
  .max(10)
  .transform((list) => OPEN_TO.filter((v) => list.includes(v)));

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
  linkedinUrl: profileLinkSchemas.linkedinUrl.nullable().optional(),
  websiteUrl: profileLinkSchemas.websiteUrl.nullable().optional(),
  githubUrl: profileLinkSchemas.githubUrl.nullable().optional(),
  instagramUrl: profileLinkSchemas.instagramUrl.nullable().optional(),
  xUrl: profileLinkSchemas.xUrl.nullable().optional(),
  interests: z.array(trimmedString(40)).max(20).optional(),
  // Each of these left out leaves what's stored alone, on registering again as on an edit.
  /** One line: runs of spaces and line breaks become one space. */
  headline: optionalTrimmed(PROFILE_HEADLINE_MAX_LENGTH)
    .transform((v) => (v === null ? null : v.replace(/\s+/g, " ")))
    .optional(),
  industry: z.enum(INDUSTRIES).nullable().optional(),
  careerStartYear: profileYearSchema().nullable().optional(),
  skills: skillListSchema(PROFILE_MAX_SKILLS, SKILL_MAX_LENGTH).optional(),
  /** Always empty at schools, which don't ask: a save there clears both. */
  degree: optionalTrimmed(PROFILE_DEGREE_MAX_LENGTH).optional(),
  fieldOfStudy: optionalTrimmed(PROFILE_DEGREE_MAX_LENGTH).optional(),
  /** Cleared for a current pupil. */
  openTo: openToSchema.optional(),
  /** Each list replaces the stored one whole, and is stored newest first. */
  experiences: z.array(profileExperienceSchema).max(PROFILE_MAX_EXPERIENCES, `Add at most ${PROFILE_MAX_EXPERIENCES} past roles`).optional(),
  education: z.array(profileEducationSchema).max(PROFILE_MAX_EDUCATION, `Add at most ${PROFILE_MAX_EDUCATION} places of study`).optional(),
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

/**
 * A change to the member's background here. A key left out stays as stored, so choosing a backdrop keeps the photo for
 * later. A new photo must be one they uploaded here with purpose "backdrop"; "PHOTO" needs a photo.
 */
export const memberAppearanceUpdateSchema = z
  .object({
    backdrop: z.enum(MEMBER_BACKDROPS).optional(),
    photoUrl: linkUrlSchema.nullable().optional(),
  })
  .strict();
export type MemberAppearanceUpdate = z.infer<typeof memberAppearanceUpdateSchema>;

export const memberReasonSchema = z.object({ reason: trimmedString(500, 3) });
export type MemberReasonInput = z.infer<typeof memberReasonSchema>;

/**
 * Approving or rejecting can carry the status the admin acted on (a new-member notice sends PENDING): the API then refuses
 * it (409, with the status now) once the membership has moved on, so an approval can't overturn another admin's
 * rejection. Without it, approving someone rejected stays possible, as the members list offers on purpose.
 */
export const memberApproveSchema = z.object({ expectedStatus: z.enum(MEMBERSHIP_STATUSES).optional() });
export type MemberApproveInput = z.infer<typeof memberApproveSchema>;
export const memberRejectSchema = memberReasonSchema.extend(memberApproveSchema.shape);
export type MemberRejectInput = z.infer<typeof memberRejectSchema>;

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

/** GET /me/profile-copy: `exclude` is the institution being joined, whose own profile isn't a source. */
export const profileCopyQuerySchema = z.object({ exclude: tenantSlugSchema.optional() });
export type ProfileCopyQuery = z.infer<typeof profileCopyQuerySchema>;
