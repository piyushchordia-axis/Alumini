import { z } from "zod";
import { COMPANY_SIZES, INDUSTRIES, JOB_SENIORITIES, JOB_TYPES, SALARY_CURRENCIES, SALARY_PERIODS, WORK_MODES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, isoDateTimeSchema, optionalTrimmed, skillListSchema, trimmedString } from "./common";

/** The most years of experience a job can ask for, at either end. */
export const JOB_EXPERIENCE_MAX_YEARS = 50;
export const JOB_MAX_SKILLS = 15;
export const JOB_SKILL_MAX_LENGTH = 40;
/** Each optional section of a job: responsibilities, requirements, benefits and how to apply. */
export const JOB_SECTION_MAX_LENGTH = 3000;
export const JOB_ABOUT_COMPANY_MAX_LENGTH = 1500;

const years = z.number().int().min(0).max(JOB_EXPERIENCE_MAX_YEARS).nullable().optional();
const minorAmount = z.number().int().nonnegative().nullable().optional();

/** A host, and no user name or password: "https://google.com@evil.example" goes to evil.example. As rich text's links. */
function withoutCredentials(link: string): boolean {
  try {
    const url = new URL(link);
    return !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}
const linkSchema = httpUrlSchema.max(2048).refine(withoutCredentials, "A link can't hold a user name or password").nullable().optional();

/**
 * Optional text: blank or null clears it, and left out it stays out. Not `optionalTrimmed`, which turns a missing field into
 * null: a form that doesn't show a field would then clear it whenever it saved an edit with what `jobCreateSchema` gave back.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional();

/** Every field of a job, as create and update take them. `description` is "About the role". */
const jobFields = {
  title: trimmedString(150, 3),
  companyName: trimmedString(120, 1),
  location: optionalText(120),
  workMode: z.enum(WORK_MODES),
  jobType: z.enum(JOB_TYPES),
  seniority: z.enum(JOB_SENIORITIES).nullable().optional(),
  experienceMin: years,
  experienceMax: years,
  skills: skillListSchema(JOB_MAX_SKILLS, JOB_SKILL_MAX_LENGTH),
  educationRequirement: optionalText(120),
  openings: z.number().int().min(1).max(1000).nullable().optional(),
  description: trimmedString(5000, 10),
  responsibilities: optionalText(JOB_SECTION_MAX_LENGTH),
  requirements: optionalText(JOB_SECTION_MAX_LENGTH),
  benefits: optionalText(JOB_SECTION_MAX_LENGTH),
  howToApply: optionalText(JOB_SECTION_MAX_LENGTH),
  applyUrl: linkSchema,
  contactEmail: z.email().nullable().optional(),
  contactPhone: optionalText(24),
  /** Pay in minor units (paise, cents) of `salaryCurrency`, per `salaryPeriod`. */
  salaryMinMinor: minorAmount,
  salaryMaxMinor: minorAmount,
  salaryCurrency: z.string().trim().toUpperCase().pipe(z.enum(SALARY_CURRENCIES)),
  salaryPeriod: z.enum(SALARY_PERIODS),
  /** Shown as "Pay note": "plus ESOPs". */
  salaryNote: optionalText(80),
  companyLogoUrl: linkSchema,
  companyWebsite: linkSchema,
  companyIndustry: z.enum(INDUSTRIES).nullable().optional(),
  companySize: z.enum(COMPANY_SIZES).nullable().optional(),
  aboutCompany: optionalText(JOB_ABOUT_COMPANY_MAX_LENGTH),
  expiresAt: isoDateTimeSchema.nullable().optional(),
  /** "I can refer people for this job". Ignored while referrals are off here, or from a poster who is a current pupil. */
  canRefer: z.boolean().optional(),
};

/** The ends of a job's ranges, as sent or as they'll be stored. */
export interface JobRanges {
  experienceMin?: number | null;
  experienceMax?: number | null;
  salaryMinMinor?: number | null;
  salaryMaxMinor?: number | null;
}

const RANGES = [
  { min: "experienceMin", max: "experienceMax", what: "experience" },
  { min: "salaryMinMinor", max: "salaryMaxMinor", what: "pay" },
] as const;

/**
 * What's wrong with a job's ranges. Each issue is on the upper end, unless `changed` (an edit, which the API checks again
 * once merged with what's stored) changed only the lower end: then on that, the field the member just set.
 */
export function jobRangeIssues(v: JobRanges, changed?: JobRanges): Array<{ path: keyof JobRanges; message: string }> {
  const issues: Array<{ path: keyof JobRanges; message: string }> = [];
  for (const { min, max, what } of RANGES) {
    const low = v[min];
    const high = v[max];
    if (low == null || high == null || high >= low) continue;
    if (changed && changed[max] === undefined && changed[min] !== undefined) issues.push({ path: min, message: `Minimum ${what} must be at most the maximum` });
    else issues.push({ path: max, message: `Maximum ${what} must be at least the minimum` });
  }
  return issues;
}

const checkRanges = (v: JobRanges, ctx: { addIssue: (issue: { code: "custom"; path: string[]; message: string }) => void }) => {
  for (const issue of jobRangeIssues(v)) ctx.addIssue({ code: "custom", path: [issue.path], message: issue.message });
};

export const jobCreateSchema = z
  .object({
    ...jobFields,
    workMode: jobFields.workMode.optional(),
    skills: jobFields.skills.optional(),
    salaryCurrency: jobFields.salaryCurrency.optional(),
    salaryPeriod: jobFields.salaryPeriod.optional(),
  })
  .superRefine(checkRanges);
export type JobCreateInput = z.infer<typeof jobCreateSchema>;

/** Built from the fields rather than from create, which a refinement can't be made partial from. Null clears a field, [] the skills. */
export const jobUpdateSchema = z.object(jobFields).partial().superRefine(checkRanges);
export type JobUpdateInput = z.infer<typeof jobUpdateSchema>;

export const jobListQuerySchema = cursorQuerySchema.extend({
  /** Matches the title, the company and the skills. */
  q: z.string().trim().max(80).optional(),
  jobType: z.enum(JOB_TYPES).optional(),
  workMode: z.enum(WORK_MODES).optional(),
  seniority: z.enum(JOB_SENIORITIES).optional(),
  /**
   * Jobs that fit this many years of experience: neither end of their range excludes it. Blank ("?experience=", an empty
   * box) is no filter, rather than the 0 that `Number("")` would make it.
   */
  experience: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.coerce.number().int().min(0).max(JOB_EXPERIENCE_MAX_YEARS).optional()),
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
