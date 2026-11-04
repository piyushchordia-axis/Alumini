import { JOB_SENIORITY_LABELS, JOB_TYPE_LABELS, WORK_MODE_LABELS, type ModerationStatus, type WorkMode } from "../constants";
import type { JobCardDto, JobDto } from "../types/dto";
import { formatSalary } from "./salary";
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
