import type { TenantType } from "../constants";
import type { MembershipProfileInput } from "../schemas/membership";
import type { MembershipDto, ProfileFieldDto } from "../types/dto";
import { isCurrentPupil } from "./features";

/** The feed's profile-strength card goes away at this score. */
export const PROFILE_STRENGTH_HIDE_AT = 90;
/** How long dismissing that card keeps it away. */
export const PROFILE_NUDGE_SNOOZE_DAYS = 14;

/**
 * The three parts of a profile: the registration steps, in order, and the sections of the edit screen (`#basics`,
 * `#work`, `#about` on web, `?section=` on mobile). Everything registration requires is in the first.
 */
export const PROFILE_SECTIONS = ["basics", "work", "about"] as const;
export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type ProfileStep = 1 | 2 | 3;

const SECTION_OF: Record<Exclude<keyof MembershipProfileInput, "fields">, ProfileSection> = {
  avatarUrl: "basics",
  fullName: "basics",
  batchYear: "basics",
  professionType: "basics",
  dateOfBirth: "basics",
  city: "basics",
  country: "basics",
  headline: "work",
  companyName: "work",
  designation: "work",
  industry: "work",
  careerStartYear: "work",
  skills: "work",
  experiences: "work",
  bio: "about",
  interests: "about",
  degree: "about",
  fieldOfStudy: "about",
  education: "about",
  linkedinUrl: "about",
  websiteUrl: "about",
  githubUrl: "about",
  instagramUrl: "about",
  xUrl: "about",
  openTo: "about",
  maritalStatus: "about",
  kidsCount: "about",
  isPhoneVisible: "about",
  celebrateBirthday: "about",
  celebrateAnniversary: "about",
};
// A map, so a path such as "constructor" finds nothing rather than something inherited.
const SECTION_BY_FIELD = new Map<string, ProfileSection>(Object.entries(SECTION_OF));

type FieldPlacement = Pick<ProfileFieldDto, "key" | "required" | "memberEditable">;

/**
 * The section that holds the field an error `path` names ("headline", "experiences.1.endYear", "fields.house"). An
 * institution's own question is in the first when the member must answer it, and in the last otherwise; `fields` says
 * which. An unknown path is put in the first.
 */
export function profileSectionOf(path: string, fields: readonly FieldPlacement[] = []): ProfileSection {
  const [head = "", key] = path.split(".");
  if (head === "fields") {
    const field = fields.find((f) => f.key === key);
    return field?.required && field.memberEditable ? "basics" : "about";
  }
  return SECTION_BY_FIELD.get(head) ?? "basics";
}

/** The registration step (1–3) that holds the field an error `path` names, for jumping to it. See profileSectionOf. */
export function profileStepOf(path: string, fields: readonly FieldPlacement[] = []): ProfileStep {
  return (PROFILE_SECTIONS.indexOf(profileSectionOf(path, fields)) + 1) as ProfileStep;
}

export type SocialLinkKind = "linkedin" | "github" | "instagram" | "x" | "website";

const HANDLES: Record<Exclude<SocialLinkKind, "website">, { pattern: RegExp; url: (handle: string) => string }> = {
  linkedin: { pattern: /^[A-Za-z0-9_-]{3,100}$/, url: (h) => `https://www.linkedin.com/in/${h}` },
  github: { pattern: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/, url: (h) => `https://github.com/${h}` },
  instagram: { pattern: /^[A-Za-z0-9._]{1,30}$/, url: (h) => `https://www.instagram.com/${h}` },
  x: { pattern: /^[A-Za-z0-9_]{1,15}$/, url: (h) => `https://x.com/${h}` },
};

/** Something like "github.com/asha" or "asha.dev": a host with a dot, then perhaps a path, and no spaces. */
const SCHEMELESS_LINK = /^[^\s/@:]+\.[^\s/@:.]+(?:[/?#]\S*)?$/;

/**
 * A link field's text as it should be saved, for the forms to apply as the member leaves the field: blank is null, a
 * URL stays as typed, "https://" goes in front of one typed without it ("github.com/asha"), and a handle ("@asha", or
 * "asha" alone) becomes that site's profile URL. Anything else comes back trimmed, for the schema to refuse. The API
 * takes URLs only.
 */
export function socialUrlFromInput(kind: SocialLinkKind, input: string | null | undefined): string | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  if (kind !== "website") {
    const handle = text.startsWith("@") ? text.slice(1) : text;
    const site = HANDLES[kind];
    if (site.pattern.test(handle)) return site.url(handle);
  }
  return SCHEMELESS_LINK.test(text) ? `https://${text}` : text;
}

/** Whole years since they started working, by calendar year; null when they haven't said. Never negative. */
export function yearsOfExperience(careerStartYear: number | null | undefined, now: Date = new Date()): number | null {
  if (careerStartYear == null) return null;
  return Math.max(0, now.getFullYear() - careerStartYear);
}

interface Dated {
  startYear: number | null;
  endYear: number | null;
}

const newerFirst = (a: number | null, b: number | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : b - a);

/**
 * Newest first: by end year (or the start year when the end is blank), then by start year, with entries that have no
 * years last. Ties keep their order. Returns a new list.
 */
function byYears<T extends Dated>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => newerFirst(a.endYear ?? a.startYear, b.endYear ?? b.startYear) || newerFirst(a.startYear, b.startYear));
}

/** Past roles in the order profiles show them and the server stores them. See byYears. */
export const sortExperiences = <T extends Dated>(list: readonly T[]): T[] => byYears(list);
/** Studies elsewhere in the order profiles show them and the server stores them. See byYears. */
export const sortEducation = <T extends Dated>(list: readonly T[]): T[] => byYears(list);

export type ProfileStrengthKey = "photo" | "headline" | "role" | "city" | "skills" | "bio" | "industry" | "careerStart" | "link" | "degree" | "history";

export interface ProfileStrengthItem {
  key: ProfileStrengthKey;
  /** What to do, as a checklist line: "Add a profile photo". */
  label: string;
  weight: number;
  done: boolean;
  /** Where it's edited. */
  section: ProfileSection;
}

export interface ProfileStrength {
  /** 0–100: the weight done out of the weight that applies to this member. */
  score: number;
  /** Only the items that apply to this member, heaviest first. */
  items: ProfileStrengthItem[];
}

export type ProfileStrengthInput = Pick<
  MembershipDto,
  | "avatarUrl"
  | "headline"
  | "companyName"
  | "designation"
  | "city"
  | "skills"
  | "bio"
  | "industry"
  | "careerStartYear"
  | "professionType"
  | "batchYear"
  | "dateOfBirth"
  | "linkedinUrl"
  | "websiteUrl"
  | "githubUrl"
  | "instagramUrl"
  | "xUrl"
  | "degree"
  | "fieldOfStudy"
  | "experiences"
  | "education"
>;

const filled = (v: string | null | undefined) => !!v && v.trim() !== "";

/**
 * How complete a profile is, and what's missing. Some items don't apply to everyone: the year they started working
 * not to students or current pupils, links not to current pupils (who can't add them), and a degree here not at
 * schools (which don't ask).
 */
export function profileStrength(m: ProfileStrengthInput, tenant: { type: TenantType; timezone: string }, now: Date = new Date()): ProfileStrength {
  const pupil = isCurrentPupil(tenant, m, now);
  const items: ProfileStrengthItem[] = [
    { key: "photo", label: "Add a profile photo", weight: 20, section: "basics", done: filled(m.avatarUrl) },
    { key: "headline", label: "Write a headline", weight: 15, section: "work", done: filled(m.headline) },
    { key: "role", label: "Add your current role", weight: 10, section: "work", done: filled(m.designation) || filled(m.companyName) },
    { key: "city", label: "Add the city you live in", weight: 10, section: "basics", done: filled(m.city) },
    { key: "skills", label: "Add at least 3 skills", weight: 10, section: "work", done: m.skills.length >= 3 },
    { key: "bio", label: "Write a short bio", weight: 10, section: "about", done: filled(m.bio) },
    { key: "industry", label: "Choose your industry", weight: 5, section: "work", done: !!m.industry },
  ];
  if (m.professionType !== "STUDENT" && !pupil) items.push({ key: "careerStart", label: "Add the year you started working", weight: 5, section: "work", done: m.careerStartYear != null });
  if (!pupil) items.push({ key: "link", label: "Add a link, such as LinkedIn", weight: 5, section: "about", done: [m.linkedinUrl, m.websiteUrl, m.githubUrl, m.instagramUrl, m.xUrl].some(filled) });
  if (tenant.type !== "SCHOOL") items.push({ key: "degree", label: "Add your degree or field of study", weight: 5, section: "about", done: filled(m.degree) || filled(m.fieldOfStudy) });
  items.push({ key: "history", label: "Add a past role or other studies", weight: 5, section: "work", done: m.experiences.length > 0 || m.education.length > 0 });
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  const done = items.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);
  return { score: total ? Math.round((100 * done) / total) : 100, items };
}

/**
 * Whether the feed shows the profile-strength card: the profile is below PROFILE_STRENGTH_HIDE_AT, and the card wasn't
 * dismissed in the last PROFILE_NUDGE_SNOOZE_DAYS.
 */
export function showProfileNudge(score: number, dismissedAt: string | null, now: Date = new Date()): boolean {
  if (score >= PROFILE_STRENGTH_HIDE_AT) return false;
  if (!dismissedAt) return true;
  const at = Date.parse(dismissedAt);
  return Number.isNaN(at) || now.getTime() - at >= PROFILE_NUDGE_SNOOZE_DAYS * 86_400_000;
}
