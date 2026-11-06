import { MEMBER_START_MIN_YEAR, type TenantType } from "../constants";
import type { TenantPublicSettings } from "../types/dto";

/**
 * A member's years at an institution: the year they joined, and `batchYear`, the year they left or will leave. Only a
 * community (type OTHER) may leave the end blank, for someone who is still a member.
 */
export interface MemberYears {
  startYear?: number | null;
  batchYear?: number | null;
}

/** What memberYearsIssues needs of an institution: its type, and the range its end years must fall in. */
export interface MemberYearsRules {
  type: TenantType;
  settings: Pick<TenantPublicSettings, "minBatchYear" | "maxBatchYear">;
}

/**
 * A member's years as both apps show them under the name: "2020–2024", "2020" when they joined and left that year,
 * "1996–present" with no end, and a pupil's end year ahead as given. Written by hand, en dash included, for Hermes.
 */
export function memberYearsLabel(m: MemberYears): string {
  const { startYear: start, batchYear: end } = m;
  // No start: a reply cached before the years came in.
  if (start == null) return end == null ? "" : String(end);
  if (end == null) return `${start}–present`;
  return start === end ? String(start) : `${start}–${end}`;
}

/** The grey line under a member's name, the years first: "2020–2024 · Infosys". Blank parts are left out. */
export function memberYearsLine(m: MemberYears, ...parts: Array<string | null | undefined | false>): string {
  return [memberYearsLabel(m), ...parts].filter(Boolean).join(" · ");
}

/** A member's name in a one-line byline, the years after it: "Hetal Shah (2008–2012)", or the name alone with no years. */
export function nameWithYears(m: MemberYears & { fullName: string }): string {
  const years = memberYearsLabel(m);
  return years ? `${m.fullName} (${years})` : m.fullName;
}

export interface MemberYearField {
  label: string;
  /** What a year picker shows when nothing is chosen. */
  blank: string;
}

export interface MemberYearFields {
  start: MemberYearField;
  end: MemberYearField & { required: boolean };
}

const CHOOSE = "Choose a year";

/**
 * The two year inputs, worded for the institution: when a pupil or student joined and left, or, at a community, since
 * when and until when someone is a member, where a blank "Until" means they still are.
 */
export function memberYearFields(type: TenantType): MemberYearFields {
  if (type === "OTHER") {
    return { start: { label: "Member since", blank: CHOOSE }, end: { label: "Until (leave blank if you still are)", blank: "Still a member", required: false } };
  }
  return { start: { label: "Year you joined", blank: CHOOSE }, end: { label: "Year you left (or will leave)", blank: CHOOSE, required: true } };
}

export type MemberYearsIssues = Partial<Record<"startYear" | "batchYear", string>>;

/**
 * A member's years checked as the API checks them, by the field each problem is about, or {}. The start is from
 * MEMBER_START_MIN_YEAR to this year; the end is in the institution's batch range, and at a community not in the future;
 * the end is never before the start. Both are required, but a community's end, unless `required` is false, as for an
 * invitation, where only what's given is checked. "This year" is `now`'s, read on each call.
 */
export function memberYearsIssues(tenant: MemberYearsRules, years: MemberYears, opts: { now?: Date; required?: boolean } = {}): MemberYearsIssues {
  const { now = new Date(), required = true } = opts;
  const thisYear = now.getFullYear();
  const { minBatchYear, maxBatchYear } = tenant.settings;
  const community = tenant.type === "OTHER";
  const { startYear: start, batchYear: end } = years;
  const issues: MemberYearsIssues = {};

  if (start == null) {
    if (required) issues.startYear = "Enter the year you joined";
  } else if (!Number.isInteger(start)) issues.startYear = "Enter a year";
  else if (start < MEMBER_START_MIN_YEAR) issues.startYear = `Use a year from ${MEMBER_START_MIN_YEAR} on`;
  else if (start > thisYear) issues.startYear = "This year at the latest";

  if (end == null) {
    if (required && !community) issues.batchYear = "Enter the year you left, or will leave";
  } else if (!Number.isInteger(end)) issues.batchYear = "Enter a year";
  else if (community && end > thisYear) issues.batchYear = "Leave this blank if you still are";
  else if (end < minBatchYear || end > maxBatchYear) issues.batchYear = `Must be between ${minBatchYear} and ${maxBatchYear}`;
  else if (start != null && !issues.startYear && end < start) issues.batchYear = "Can't be before the year you joined";
  return issues;
}

const yearsDown = (from: number, to: number) => Array.from({ length: Math.max(0, from - to + 1) }, (_, i) => from - i);

/** The years a member may have joined in, for a picker: this year back to MEMBER_START_MIN_YEAR, newest first. */
export function memberStartYearOptions(now: Date = new Date()): number[] {
  return yearsDown(now.getFullYear(), MEMBER_START_MIN_YEAR);
}

/**
 * The years a member may have left (or will leave) in, for a picker: the institution's batch range, newest first, and
 * at a community no later than this year.
 */
export function memberEndYearOptions(tenant: MemberYearsRules, now: Date = new Date()): number[] {
  const { minBatchYear, maxBatchYear } = tenant.settings;
  return yearsDown(tenant.type === "OTHER" ? Math.min(maxBatchYear, now.getFullYear()) : maxBatchYear, minBatchYear);
}

/** An invitation's years, either of which may be blank: "2008–2012", "From 2008", "2012", or "". */
export function invitationYearsLabel(inv: MemberYears): string {
  if (inv.startYear != null && inv.batchYear == null) return `From ${inv.startYear}`;
  return memberYearsLabel(inv);
}
