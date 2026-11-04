import { JOB_SENIORITY_LABELS, JOB_TYPE_LABELS, WORK_MODE_LABELS, type ModerationStatus, type WorkMode } from "../constants";
import type { JobCardDto, JobDto } from "../types/dto";
import { formatSalary } from "./salary";
import { skillKey, type SkillMatch } from "./skills";
import { localTimeZone, wallPartsInZone } from "./time";

const instant = (at: number | Date | string): number => (typeof at === "number" ? at : typeof at === "string" ? Date.parse(at) : at.getTime());

/**
 * Whether a job has stopped taking applications: its poster closed it, or its closing date has passed. The apps hide its
 * apply link and contacts then; one still in review keeps them, as only its poster and admins see it.
 */
export function applicationsClosed(job: { isClosed: boolean; expiresAt: string | Date | null }, now: number | Date): boolean {
  return job.isClosed || (!!job.expiresAt && instant(job.expiresAt) <= instant(now));
}

/**
 * Whether a job takes applications now: published, not closed, and not past its closing date. The API decides with it
 * whether a job's contact details are shown, and whether it takes referral requests.
 */
export function jobIsOpen(job: { moderationStatus: ModerationStatus; isClosed: boolean; expiresAt: string | Date | null }, now: number | Date): boolean {
  return job.moderationStatus === "APPROVED" && !applicationsClosed(job, now);
}

/** A job's pay as `formatSalary` writes it ("₹25–40 LPA"), or null when it gives no amount. */
export function jobSalaryText(job: Pick<JobCardDto, "salaryMinMinor" | "salaryMaxMinor" | "salaryCurrency" | "salaryPeriod">): string | null {
  return formatSalary({ minMinor: job.salaryMinMinor, maxMinor: job.salaryMaxMinor, currency: job.salaryCurrency, period: job.salaryPeriod });
}

/**
 * Where a job is done, in one line: its location, with the work mode after it unless it's on-site ("Mumbai · Remote"), or
 * the work mode alone ("Remote"). Null for an on-site job with no location. The digest email, both digest pages, the cards
 * and the job's own page all write it this way.
 */
export function jobPlaceLabel(job: { workMode: WorkMode; location: string | null }): string | null {
  const location = job.location?.trim() || null;
  if (job.workMode === "ON_SITE") return location;
  return location ? `${location} · ${WORK_MODE_LABELS[job.workMode]}` : WORK_MODE_LABELS[job.workMode];
}

const yearsText = (n: number) => `${n} year${n === 1 ? "" : "s"}`;

/** The experience a job asks for: "3–6 years", "3+ years", "Up to 2 years", "Open to freshers". Null when it doesn't say. */
export function experienceLabel(min: number | null | undefined, max: number | null | undefined): string | null {
  const low = min ?? null;
  const high = max ?? null;
  if (low == null && high == null) return null;
  if (high == null) return low === 0 ? "Open to freshers" : `${low}+ years`;
  if (high === 0) return "Open to freshers";
  if (low == null) return `Up to ${yearsText(high)}`;
  if (low === high) return yearsText(low);
  return `${low}–${high} years`;
}

export type JobFactKey = "jobType" | "workMode" | "location" | "salary" | "salaryNote" | "experience" | "seniority" | "openings" | "education";
export interface JobFact {
  key: JobFactKey;
  label: string;
  value: string;
}

/** What `jobFacts` reads: a card has all but the last two, which only a full job has. */
export type JobFactsSource = Pick<
  JobCardDto,
  "jobType" | "workMode" | "location" | "salaryMinMinor" | "salaryMaxMinor" | "salaryCurrency" | "salaryPeriod" | "salaryNote" | "experienceMin" | "experienceMax" | "seniority"
> &
  Partial<Pick<JobDto, "openings" | "educationRequirement">>;

/**
 * A job's facts in the order both apps show them, each with its label, leaving out what the job doesn't say. An
 * internship's pay is its stipend.
 */
export function jobFacts(job: JobFactsSource): JobFact[] {
  const facts: JobFact[] = [
    { key: "jobType", label: "Job type", value: JOB_TYPE_LABELS[job.jobType] },
    { key: "workMode", label: "Work mode", value: WORK_MODE_LABELS[job.workMode] },
  ];
  const add = (key: JobFactKey, label: string, value: string | null | undefined) => {
    if (value) facts.push({ key, label, value });
  };
  add("location", "Location", job.location?.trim());
  add("salary", job.jobType === "INTERNSHIP" ? "Stipend" : "Salary", jobSalaryText(job));
  add("salaryNote", "Pay note", job.salaryNote);
  add("experience", "Experience", experienceLabel(job.experienceMin, job.experienceMax));
  add("seniority", "Seniority", job.seniority ? JOB_SENIORITY_LABELS[job.seniority] : null);
  add("openings", "Openings", job.openings != null ? String(job.openings) : null);
  add("education", "Education", job.educationRequirement);
  return facts;
}

/**
 * On a job's page, under its skills: how many of them the viewer has (skillMatch), "You have 3 of 5 skills". Neither app
 * shows it to the job's poster.
 */
export function skillMatchText(match: Pick<SkillMatch, "count" | "total">): string {
  return `You have ${match.count} of ${match.total} skill${match.total === 1 ? "" : "s"}`;
}
/** Said of a job's skill the viewer has: after it on web for screen readers only, and in its label on mobile. */
export const YOU_HAVE_THIS_TEXT = "(you have this)";
/** In place of skillMatchText when the viewer's profile lists no skills, linking to its Work section. */
export const ADD_SKILLS_TO_MATCH_TEXT = "Add your skills to see which you match";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Dec" in `timeZone`, with the year when it isn't `now`'s. Written by hand, as Hermes may lack Intl date formatting. */
function shortDate(at: number, now: number, timeZone: string): string {
  let day: { year: number; month: number; day: number };
  let thisYear: number;
  try {
    day = wallPartsInZone(new Date(at), timeZone);
    thisYear = wallPartsInZone(new Date(now), timeZone).year;
  } catch {
    const d = new Date(at);
    day = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
    thisYear = new Date(now).getUTCFullYear();
  }
  return `${day.day} ${MONTHS[day.month - 1]}${day.year === thisYear ? "" : ` ${day.year}`}`;
}

/** What a job says about its company beyond the name, which a new job at the same company can copy. */
export const COMPANY_DETAIL_KEYS = ["companyLogoUrl", "companyWebsite", "companyIndustry", "companySize", "aboutCompany"] as const;
export type CompanyDetails = Pick<JobDto, (typeof COMPANY_DETAIL_KEYS)[number]>;

/** Whether two company names are one company, compared as skills are: "Zylo Labs" and " zylo  labs" are. */
export function sameCompany(a: string, b: string): boolean {
  const key = skillKey(a);
  return key !== "" && key === skillKey(b);
}

/**
 * The poster's latest job at `company`, from their own jobs newest first (as `mine=true` lists them), so a new job can reuse
 * its company details. Skips a removed job, whose page even its poster can't open, and `excludeId`, the job being edited.
 */
export function latestJobAtCompany<T extends Pick<JobCardDto, "id" | "companyName" | "moderationStatus">>(jobs: readonly T[], company: string, excludeId?: string): T | null {
  return jobs.find((job) => job.id !== excludeId && job.moderationStatus !== "REMOVED" && sameCompany(job.companyName, company)) ?? null;
}

/** A job's company details, or null when it gives none worth copying. */
export function companyDetailsOf(job: CompanyDetails): CompanyDetails | null {
  const details: CompanyDetails = {
    companyLogoUrl: job.companyLogoUrl,
    companyWebsite: job.companyWebsite,
    companyIndustry: job.companyIndustry,
    companySize: job.companySize,
    aboutCompany: job.aboutCompany?.trim() ? job.aboutCompany : null,
  };
  return COMPANY_DETAIL_KEYS.some((key) => details[key]) ? details : null;
}

/**
 * What an earlier job's company details can fill in on a form: the fields it gives that the form holds nothing in yet. A
 * field the poster has filled is never in it, so using it can't replace what they typed, and an empty result means there
 * is nothing left to offer.
 */
export function companyDetailsToFill(from: CompanyDetails, current: CompanyDetails): Partial<CompanyDetails> {
  const fill: Record<string, string> = {};
  for (const key of COMPANY_DETAIL_KEYS) {
    const given = from[key];
    if (given?.trim() && !current[key]?.trim()) fill[key] = given;
  }
  return fill as Partial<CompanyDetails>;
}

const COMPANY_DETAIL_NAMES: Record<(typeof COMPANY_DETAIL_KEYS)[number], string> = {
  companyLogoUrl: "logo",
  companyWebsite: "website",
  companyIndustry: "industry",
  companySize: "size",
  aboutCompany: "about",
};

/** The offer to reuse an earlier job's company details, naming only the fields it would fill: "Its logo and website can fill in here." */
export function companyReuseText(companyName: string, fill: Partial<CompanyDetails>): string {
  const names = COMPANY_DETAIL_KEYS.filter((key) => fill[key] != null).map((key) => COMPANY_DETAIL_NAMES[key]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "details");
  return `You've posted a job at ${companyName} before. Its ${list} can fill in here.`;
}

/**
 * When a job stops taking applications: "Applications close 12 Dec", "Applications closed 3 Nov" once its closing date has
 * passed, or "Applications closed" once its poster closed it, which keeps no date. Null for an open job with no closing
 * date. Dates are in `timeZone`, the device's own unless given.
 */
export function applicationsLine(job: Pick<JobCardDto, "isClosed" | "expiresAt">, now: number | Date, timeZone: string = localTimeZone()): string | null {
  if (job.isClosed) return "Applications closed";
  if (!job.expiresAt) return null;
  const at = instant(job.expiresAt);
  const today = instant(now);
  if (Number.isNaN(at)) return null;
  return `${at <= today ? "Applications closed" : "Applications close"} ${shortDate(at, today, timeZone)}`;
}
