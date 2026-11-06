import type { TenantType } from "../constants";
import type { MembershipProfileInput } from "../schemas/membership";
import type { MembershipDto, PortableProfileDto, ProfileFieldDto } from "../types/dto";
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

/** Each section's name, as the edit screen's headings, the registration steps and the profile checklist say it. */
export const PROFILE_SECTION_TITLES: Record<ProfileSection, string> = { basics: "Basics", work: "Work", about: "About you" };

/** What each registration step asks for, under its heading. */
export const REGISTRATION_STEP_HINTS: Record<ProfileSection, string> = {
  basics: "Your photo, name and years here, so people know it's you.",
  work: "What you do now and what you did before. You can skip this and add it later.",
  about: "Your story, studies, links and what you're open to. All of it is optional.",
};

/** What leaving registration from Basics asks first when anything has been typed, word for word on web and mobile. */
export const REGISTRATION_LEAVE_CONFIRM = {
  title: "Leave registration?",
  body: "What you've entered here won't be kept.",
  confirm: "Leave",
} as const;

/** What "Use a different number" asks first on Basics when anything has been typed. */
export const REGISTRATION_NUMBER_CONFIRM = {
  title: "Use a different number?",
  body: "You'll be signed out, and what you've entered here won't be kept.",
  confirm: "Sign out",
} as const;

/** The section a registration step holds: step 1 is "basics". */
export const profileSectionOfStep = (step: ProfileStep): ProfileSection => PROFILE_SECTIONS[step - 1] ?? "basics";

/** A registration step's heading: "Step 2 of 3 · Work". */
export const registrationStepHeading = (step: ProfileStep) => `Step ${step} of ${PROFILE_SECTIONS.length} · ${PROFILE_SECTION_TITLES[profileSectionOfStep(step)]}`;

/** A profile input: a key of the profile body other than the institution's own questions (`fields`). */
export type ProfileInputKey = Exclude<keyof MembershipProfileInput, "fields">;

const SECTION_OF: Record<ProfileInputKey, ProfileSection> = {
  avatarUrl: "basics",
  fullName: "basics",
  startYear: "basics",
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

/** The profile inputs in `section` (not the institution's questions, which profileSectionOf places), for checking a step. */
export function profileSectionFields(section: ProfileSection): ProfileInputKey[] {
  return [...SECTION_BY_FIELD].filter(([, s]) => s === section).map(([key]) => key as ProfileInputKey);
}

/** Inputs the profile forms leave out for some members. See hiddenProfileKeys. */
export type HiddenProfileKey = "careerStartYear" | "degree" | "fieldOfStudy" | "linkedinUrl" | "websiteUrl" | "githubUrl" | "instagramUrl" | "xUrl" | "openTo";

/**
 * The inputs the profile forms don't show this member, judged from the form as it stands: the year they started working
 * to a student, degree and field of study here at a school, and links and Open to to a current pupil. A form neither
 * checks nor sends these (withoutHiddenProfileKeys), so a value the member can't see can't block a save; the API keeps
 * what's stored for a key that isn't sent.
 */
export function hiddenProfileKeys(
  tenant: { type: TenantType; timezone: string },
  m: { professionType: string; batchYear: number | null; dateOfBirth: string | null },
  now: Date = new Date(),
): HiddenProfileKey[] {
  const hidden: HiddenProfileKey[] = [];
  if (m.professionType === "STUDENT") hidden.push("careerStartYear");
  if (tenant.type === "SCHOOL") hidden.push("degree", "fieldOfStudy");
  if (isCurrentPupil(tenant, m, now)) hidden.push("linkedinUrl", "websiteUrl", "githubUrl", "instagramUrl", "xUrl", "openTo");
  return hidden;
}

/** A copy of a form's values without the `hidden` keys, each of which the profile schema treats as optional. */
export function withoutHiddenProfileKeys<T extends Partial<Record<HiddenProfileKey, unknown>>>(values: T, hidden: readonly HiddenProfileKey[]): T {
  if (hidden.length === 0) return values;
  const out = { ...values };
  for (const key of hidden) delete out[key];
  return out;
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

/**
 * yearsOfExperience as both apps say it: "8 years of experience", "1 year of experience", and "Started working in 2026"
 * in the year they started, when "0 years" would undersell it. Null when they haven't said.
 */
export function yearsOfExperienceLabel(careerStartYear: number | null | undefined, now: Date = new Date()): string | null {
  const years = yearsOfExperience(careerStartYear, now);
  if (years === null) return null;
  if (years === 0) return `Started working in ${careerStartYear}`;
  return `${years} ${years === 1 ? "year" : "years"} of experience`;
}

/**
 * A past role's or a course's years as both apps show them: "2015–2019", "2019" when it began and ended that year,
 * "From 2015" or "Until 2019" with one of them, and "" with neither.
 */
export function profileYearsLabel(startYear: number | null | undefined, endYear: number | null | undefined): string {
  if (startYear != null && endYear != null) return startYear === endYear ? String(startYear) : `${startYear}–${endYear}`;
  if (startYear != null) return `From ${startYear}`;
  if (endYear != null) return `Until ${endYear}`;
  return "";
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

/** How many missing items the feed's profile-strength card suggests. */
export const PROFILE_NUDGE_ITEMS = 3;

/** The heaviest items still missing, for the feed's card to suggest; ties keep the checklist's order. */
export const missingProfileItems = (strength: ProfileStrength, limit = PROFILE_NUDGE_ITEMS): ProfileStrengthItem[] => strength.items.filter((i) => !i.done).slice(0, limit);

/** A detail "Use details from …" can fill in: a key of PortableProfileDto other than its source. */
export type PortableProfileKey = Exclude<keyof PortableProfileDto, "source">;

/**
 * Each portable detail as a sentence names it ("Kept what you'd entered for your city"), in the order the registration
 * steps ask for them.
 */
export const PORTABLE_PROFILE_LABELS: Record<PortableProfileKey, string> = {
  city: "city",
  country: "country",
  dateOfBirth: "date of birth",
  headline: "headline",
  companyName: "company",
  designation: "role",
  industry: "industry",
  careerStartYear: "year you started working",
  skills: "skills",
  experiences: "past roles",
  bio: "bio",
  interests: "interests",
  education: "studies elsewhere",
  linkedinUrl: "LinkedIn",
  websiteUrl: "website",
  githubUrl: "GitHub",
  instagramUrl: "Instagram",
  xUrl: "X",
  openTo: "Open to",
};
export const PORTABLE_PROFILE_KEYS = Object.keys(PORTABLE_PROFILE_LABELS) as PortableProfileKey[];

const isBlank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
const sameValue = (a: unknown, b: unknown) => (isBlank(a) && isBlank(b)) || JSON.stringify(a) === JSON.stringify(b);

export interface PortableProfileFill<V> {
  /** The new value of each input to fill in. */
  values: Partial<V>;
  /** The details filled in, in PORTABLE_PROFILE_KEYS order. */
  filled: PortableProfileKey[];
  /** Details the member had already entered differently, which stay as they are. */
  kept: PortableProfileKey[];
}

/**
 * What "Use details from …" does to a registration form: each detail the other profile has fills its input, unless
 * the member has changed that input from how the form started (`start`) to something else, which is kept, so nothing
 * they typed is replaced. A detail the other profile lacks never clears an input, and `skip` (the inputs the form
 * hides, hiddenProfileKeys) are left alone. `copy`, `current` and `start` are in the form's own shape, whatever that is.
 */
export function fillFromPortableProfile<V extends Partial<Record<PortableProfileKey, unknown>>>(copy: V, current: V, start: V, skip: readonly string[] = []): PortableProfileFill<V> {
  const out: PortableProfileFill<V> = { values: {}, filled: [], kept: [] };
  for (const key of PORTABLE_PROFILE_KEYS) {
    if (skip.includes(key) || isBlank(copy[key]) || sameValue(copy[key], current[key])) continue;
    if (!isBlank(current[key]) && !sameValue(current[key], start[key])) out.kept.push(key);
    else {
      out.values[key] = copy[key];
      out.filled.push(key);
    }
  }
  return out;
}

export interface PortableProfileUndo<V> {
  /** What to put back in each input: its value from before "Use details from …". */
  values: Partial<V>;
  /** Details filled in that the member has changed since, which stay as they are. */
  kept: PortableProfileKey[];
}

/**
 * What Undo does after "Use details from …": each detail it filled (`fill`) goes back to what it was before (`before`),
 * unless the member has changed it since (it no longer holds what the fill put there), which is kept, so Undo never
 * throws away what they typed. `current` is the form as it is now, in the same shape as `fill.values`.
 */
export function undoPortableProfileFill<V extends Partial<Record<PortableProfileKey, unknown>>>(
  fill: Pick<PortableProfileFill<V>, "values" | "filled">,
  before: Partial<V>,
  current: V,
): PortableProfileUndo<V> {
  const out: PortableProfileUndo<V> = { values: {}, kept: [] };
  for (const key of fill.filled) {
    // Changed back to what it was before is no change of theirs to keep.
    if (sameValue(current[key], fill.values[key]) || sameValue(current[key], before[key])) out.values[key] = before[key];
    else out.kept.push(key);
  }
  return out;
}

/** "a", "a and b", "a, b and c". */
const inWords = (words: readonly string[]) => (words.length < 2 ? (words[0] ?? "") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);
const named = (keys: readonly PortableProfileKey[]) => keys.map((k) => PORTABLE_PROFILE_LABELS[k]);

/**
 * What the banner offers before it's used, under "You have a profile at …". The date of birth is named when it comes too,
 * as the one personal detail it brings.
 */
export function portableProfileOfferText(copy: Pick<PortableProfileDto, "dateOfBirth">): string {
  const what = copy.dateOfBirth ? "city, date of birth, work, skills, links and bio" : "city, work, skills, links and bio";
  return `Bring over your ${what} from there. Nothing you've typed here is replaced, and you can change any of it.`;
}

/**
 * What the banner says once "Use details from …" has filled the form: "Filled in your city, headline, company and 6
 * more from Demo University. Kept what you'd entered for your country."
 */
export function portableProfileFillMessage(sourceName: string, fill: Pick<PortableProfileFill<unknown>, "filled" | "kept">): string {
  const shown = named(fill.filled.slice(0, 3));
  const more = fill.filled.length - shown.length;
  const filled = fill.filled.length ? `Filled in your ${inWords(more ? [...shown, `${more} more`] : shown)} from ${sourceName}.` : `Nothing new to add from ${sourceName}.`;
  return fill.kept.length ? `${filled} Kept what you'd entered for your ${inWords(named(fill.kept))}.` : filled;
}

/**
 * What the banner says after Undo when it left something the member changed after the fill: "Took out the details from
 * Demo University. Kept your changes to your headline and skills." Null when it put everything back.
 */
export function portableProfileUndoMessage(sourceName: string, undo: Pick<PortableProfileUndo<unknown>, "kept">): string | null {
  return undo.kept.length ? `Took out the details from ${sourceName}. Kept your changes to your ${inWords(named(undo.kept))}.` : null;
}
