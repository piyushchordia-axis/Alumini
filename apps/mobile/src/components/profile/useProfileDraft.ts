import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_TITLES,
  hiddenProfileKeys,
  isCurrentPupil,
  membershipProfileSchema,
  profileEducationSchema,
  profileExperienceSchema,
  profileSectionFields,
  profileSectionOf,
  socialUrlFromInput,
  validateProfileFieldValues,
  withoutHiddenProfileKeys,
  type Industry,
  type MaritalStatus,
  type MembershipDto,
  type MembershipProfileInput,
  type OpenTo,
  type ProfessionType,
  type ProfileFieldDto,
  type ProfileLinkKey,
  type ProfileSection,
  type SocialLinkKind,
  type TenantPublicDto,
} from "@illuminize/shared";
import { errorMessage, isApiClientError } from "@illuminize/shared/client";
import { useState, type RefObject } from "react";
import { answersToValues, type FieldAnswers } from "@/components/CustomFieldInputs";
import type { SkillsInputHandle } from "@/components/SkillsInput";

/** A past role as typed: years are text until saved. `key` keeps a row's place while others come and go. */
export interface ExperienceDraft {
  key: string;
  title: string;
  company: string;
  startYear: string;
  endYear: string;
}

/** Studies elsewhere as typed. */
export interface EducationDraft {
  key: string;
  institution: string;
  degree: string;
  fieldOfStudy: string;
  startYear: string;
  endYear: string;
}

/** Everything the profile form edits, as its inputs hold it: text as typed, blanks as "". */
export interface ProfileDraft {
  fullName: string;
  batchYear: string;
  dateOfBirth: string;
  professionType: ProfessionType;
  companyName: string;
  designation: string;
  city: string;
  country: string;
  maritalStatus: MaritalStatus | "";
  kidsCount: string;
  bio: string;
  interests: string;
  headline: string;
  industry: Industry | "";
  careerStartYear: string;
  skills: string[];
  degree: string;
  fieldOfStudy: string;
  experiences: ExperienceDraft[];
  education: EducationDraft[];
  linkedinUrl: string;
  websiteUrl: string;
  githubUrl: string;
  instagramUrl: string;
  xUrl: string;
  openTo: OpenTo[];
  avatarUrl: string | null;
  isPhoneVisible: boolean;
  celebrateBirthday: boolean;
  celebrateAnniversary: boolean;
}

export type ProfileListKey = "experiences" | "education";
type ListItem<L extends ProfileListKey> = ProfileDraft[L][number];
/** The fields set one at a time; photo and lists have their own setters. */
type FieldKey = Exclude<keyof ProfileDraft, ProfileListKey | "avatarUrl">;
/** Some of the inputs' values, set together with setValues: anything but the photo, which has its picker. */
export type DraftValues = Partial<Pick<ProfileDraft, FieldKey | ProfileListKey>>;

/** Which site each link field is for, so a typed handle becomes that site's address. */
export const LINK_KINDS: Record<ProfileLinkKey, SocialLinkKind> = { linkedinUrl: "linkedin", websiteUrl: "website", githubUrl: "github", instagramUrl: "instagram", xUrl: "x" };

let rowCount = 0;
const rowKey = () => `row-${++rowCount}`;

const year = (v: number | null | undefined) => (v == null ? "" : String(v));
const blankExperience = (): ExperienceDraft => ({ key: rowKey(), title: "", company: "", startYear: "", endYear: "" });
const blankEducation = (): EducationDraft => ({ key: rowKey(), institution: "", degree: "", fieldOfStudy: "", startYear: "", endYear: "" });

/** A membership (or any part of one, such as PortableProfileDto) as the form's inputs hold it, blanks filled in. */
export const toDraft = (m?: Partial<MembershipDto>): ProfileDraft => ({
  fullName: m?.fullName ?? "",
  batchYear: m?.batchYear ? String(m.batchYear) : "",
  dateOfBirth: m?.dateOfBirth ?? "",
  professionType: m?.professionType ?? "EMPLOYED",
  companyName: m?.companyName ?? "",
  designation: m?.designation ?? "",
  city: m?.city ?? "",
  country: m?.country ?? "IN",
  maritalStatus: m?.maritalStatus ?? "",
  kidsCount: m?.kidsCount != null ? String(m.kidsCount) : "",
  bio: m?.bio ?? "",
  interests: (m?.interests ?? []).join(", "),
  headline: m?.headline ?? "",
  industry: m?.industry ?? "",
  careerStartYear: year(m?.careerStartYear),
  skills: m?.skills ?? [],
  degree: m?.degree ?? "",
  fieldOfStudy: m?.fieldOfStudy ?? "",
  experiences: (m?.experiences ?? []).map((e) => ({ key: rowKey(), title: e.title, company: e.company, startYear: year(e.startYear), endYear: year(e.endYear) })),
  education: (m?.education ?? []).map((e) => ({ key: rowKey(), institution: e.institution, degree: e.degree ?? "", fieldOfStudy: e.fieldOfStudy ?? "", startYear: year(e.startYear), endYear: year(e.endYear) })),
  linkedinUrl: m?.linkedinUrl ?? "",
  websiteUrl: m?.websiteUrl ?? "",
  githubUrl: m?.githubUrl ?? "",
  instagramUrl: m?.instagramUrl ?? "",
  xUrl: m?.xUrl ?? "",
  openTo: m?.openTo ?? [],
  avatarUrl: m?.avatarUrl ?? null,
  isPhoneVisible: m?.isPhoneVisible ?? false,
  celebrateBirthday: m?.celebrateBirthday ?? true,
  celebrateAnniversary: m?.celebrateAnniversary ?? true,
});

/** The form's own fields, so a server error on anything else (which no input would show) is shown in full instead. */
const FORM_FIELDS = new Set<string>(Object.keys(toDraft()));

const nul = (s: string) => (s.trim() ? s.trim() : null);
const yearOrNull = (s: string) => (s.trim() ? Number(s) : null);
/** Digits only, at most four: what a year box takes. */
export const yearDigits = (v: string) => v.replace(/\D/g, "").slice(0, 4);

const experienceInput = (e: ExperienceDraft) => ({ title: e.title, company: e.company, startYear: yearOrNull(e.startYear), endYear: yearOrNull(e.endYear) });
const educationInput = (e: EducationDraft) => ({ institution: e.institution, degree: nul(e.degree), fieldOfStudy: nul(e.fieldOfStudy), startYear: yearOrNull(e.startYear), endYear: yearOrNull(e.endYear) });

/** An empty required box says what's missing rather than the schema's "Too small". */
const WHEN_EMPTY: [RegExp, string][] = [
  [/^fullName$/, "Enter your full name"],
  [/^experiences\.\d+\.title$/, "Enter the job title"],
  [/^experiences\.\d+\.company$/, "Enter the company"],
  [/^education\.\d+\.institution$/, "Enter where you studied"],
];

/**
 * Zod's problems by their full path ("experiences.1.endYear", "skills.3", "fullName"), the first for each, so a problem
 * in a list lands on its row's input rather than on the list.
 */
function issueErrors(issues: readonly { path: readonly PropertyKey[]; code: string; message: string }[], prefix: (string | number)[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const path = [...prefix, ...issue.path].map(String).join(".");
    out[path] ??= issue.code === "too_small" ? (WHEN_EMPTY.find(([re]) => re.test(path))?.[1] ?? issue.message) : issue.message;
  }
  return out;
}

/** `errors`, saying what's missing for a batch left blank, which the schema reads as the year 0. */
function withBlankBatch(errors: Record<string, string>, d: ProfileDraft): Record<string, string> {
  return errors.batchYear && !d.batchYear.trim() ? { ...errors, batchYear: "Enter the year you passed out" } : errors;
}

/**
 * The draft as the profile body, for the schema to check: `skills` with whatever is still typed in the skills box, and
 * the photo only when it changed from `savedAvatar`, as a form opened before the photo changed elsewhere would otherwise
 * put back one that may be gone by now (and be refused).
 */
function draftBody(d: ProfileDraft, skills: string[], savedAvatar: string | null) {
  const link = (key: ProfileLinkKey) => socialUrlFromInput(LINK_KINDS[key], d[key]);
  return {
    fullName: d.fullName,
    batchYear: d.batchYear,
    dateOfBirth: nul(d.dateOfBirth),
    professionType: d.professionType,
    companyName: nul(d.companyName),
    designation: nul(d.designation),
    city: nul(d.city),
    country: nul(d.country),
    maritalStatus: d.maritalStatus || null,
    kidsCount: d.kidsCount.trim() ? Number(d.kidsCount) : null,
    bio: nul(d.bio),
    interests: d.interests
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20),
    headline: nul(d.headline),
    industry: d.industry || null,
    careerStartYear: yearOrNull(d.careerStartYear),
    skills,
    degree: nul(d.degree),
    fieldOfStudy: nul(d.fieldOfStudy),
    experiences: d.experiences.map(experienceInput),
    education: d.education.map(educationInput),
    linkedinUrl: link("linkedinUrl"),
    websiteUrl: link("websiteUrl"),
    githubUrl: link("githubUrl"),
    instagramUrl: link("instagramUrl"),
    xUrl: link("xUrl"),
    openTo: d.openTo,
    ...(d.avatarUrl !== savedAvatar ? { avatarUrl: d.avatarUrl } : {}),
    isPhoneVisible: d.isPhoneVisible,
    celebrateBirthday: d.celebrateBirthday,
    celebrateAnniversary: d.celebrateAnniversary,
  };
}

/** `errors` without `keys`, and without anything under a key ending in "." ("experiences." for every row's). */
function without(errors: Record<string, string>, ...keys: string[]): Record<string, string> {
  const drop = (k: string) => keys.some((key) => (key.endsWith(".") ? k.startsWith(key) : k === key));
  if (!Object.keys(errors).some(drop)) return errors;
  return Object.fromEntries(Object.entries(errors).filter(([k]) => !drop(k)));
}

export interface ProfileDraftOptions {
  tenant: TenantPublicDto;
  initial?: Partial<MembershipDto>;
  /** The institution's own questions (from api.membership.profileFields). */
  customFields?: ProfileFieldDto[];
  /** Registration asks every required question; later edits only refuse clearing one. */
  mode?: "register" | "edit";
  onSubmit: (values: MembershipProfileInput) => Promise<void>;
  /**
   * The skills box, whose half-typed skill is added before saving: on a phone, tapping Save leaves the box focused, so
   * it never adds it itself. Made by the screen, which also hands it to the box.
   */
  skillsRef: RefObject<SkillsInputHandle | null>;
  /**
   * After a refused save or step check: the section holding the first problem, or null for a problem with no input to
   * show it.
   */
  onRefused?: (section: ProfileSection | null) => void;
}

/**
 * The profile form's state, shared by its three sections (Basics, Work, About you) however a screen lays them out. It all
 * lives here, above the sections, so a value stays when its input unmounts (a folded list row, a closed disclosure, a
 * registration step not shown). Also the institution's own questions, and saving: one request for everything, with each
 * error the server sends put on the input it belongs to by its full path ("experiences.1.endYear" included), and the
 * rows and disclosures holding one opened.
 */
export function useProfileDraft({ tenant, initial, customFields = [], mode = "edit", onSubmit, skillsRef, onRefused }: ProfileDraftOptions) {
  // The form as it opened, which registration's "Use details from …" compares with to tell what the member has typed.
  const [start] = useState<ProfileDraft>(() => toDraft(initial));
  const [draft, setDraft] = useState<ProfileDraft>(start);
  const [answers, setAnswers] = useState<FieldAnswers>(() => answersToValues(initial?.fields));
  const [answerErrors, setAnswerErrors] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // While the photo uploads, saving would send the old one and the new one would be lost.
  const [photoBusy, setPhotoBusy] = useState(false);
  // The "Personal" disclosure opens when an error is inside it.
  const [personalOpen, setPersonalOpen] = useState(false);
  // List rows folded into a summary, by key: at first, every saved one. A new row, one opened again and one with an
  // error show their inputs, and an error's row stays open while it's put right.
  const [folded, setFolded] = useState(() => new Set([...draft.experiences.filter((e) => e.title.trim()), ...draft.education.filter((e) => e.institution.trim())].map((r) => r.key)));
  const fold = (key: string, on: boolean) =>
    setFolded((s) => {
      if (s.has(key) === on) return s;
      const next = new Set(s);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const required = customFields.filter((x) => x.required && x.memberEditable);
  const optional = customFields.filter((x) => !x.required || !x.memberEditable);
  // From what's on the form, so changing the batch or date of birth shows or hides what a pupil can't have at once.
  const pupil = isCurrentPupil(tenant, { batchYear: Number(draft.batchYear), dateOfBirth: draft.dateOfBirth || null });

  const set = <K extends FieldKey>(key: K, value: ProfileDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => without(e, key, ...(key === "skills" ? ["skills."] : [])));
  };
  /**
   * Sets several inputs at once (registration's "Use details from …" and its Undo, and Skip for now putting Work back),
   * clearing their errors. Complete list entries arrive folded into their summaries, as saved ones are.
   */
  const setValues = (values: DraftValues) => {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    setDraft((d) => ({ ...d, ...values }));
    setErrors((e) => without(e, ...keys, ...keys.map((k) => `${k}.`)));
    const rows = [...(values.experiences ?? []).filter((r) => r.title.trim()), ...(values.education ?? []).filter((r) => r.institution.trim())];
    if (rows.length) setFolded((s) => new Set([...s, ...rows.map((r) => r.key)]));
  };
  const setAvatar = (url: string | null) => {
    setDraft((d) => ({ ...d, avatarUrl: url }));
    setErrors((e) => without(e, "avatarUrl"));
    setServerError(null);
  };
  const setAnswer = (key: string, value: FieldAnswers[string]) => {
    setAnswers((a) => ({ ...a, [key]: value }));
    setAnswerErrors((e) => ({ ...e, [key]: "" }));
  };

  const updateItem = <L extends ProfileListKey>(list: L, index: number, patch: Partial<Omit<ListItem<L>, "key">>) => {
    setDraft((d) => ({ ...d, [list]: (d[list] as ListItem<L>[]).map((item, i) => (i === index ? { ...item, ...patch } : item)) }));
    setErrors((e) => without(e, list, ...Object.keys(patch).map((k) => `${list}.${index}.${k}`)));
  };
  /** Adds a blank row and gives its key. */
  const addItem = (list: ProfileListKey): string => {
    const item = list === "experiences" ? blankExperience() : blankEducation();
    setDraft((d) => ({ ...d, [list]: [...d[list], item] }));
    setErrors((e) => without(e, list));
    return item.key;
  };
  const removeItem = (list: ProfileListKey, index: number) => {
    setDraft((d) => ({ ...d, [list]: d[list].filter((_, i) => i !== index) }));
    // The rows after it move up, so their errors' paths no longer fit.
    setErrors((e) => without(e, list, `${list}.`));
  };
  /**
   * Checks one row as saving would, marking what's wrong. Gives null when it's fine, or else its first problem: the
   * row's field ("endYear") and what to say.
   */
  const checkItem = (list: ProfileListKey, index: number): { field: string; message: string } | null => {
    const result = list === "experiences" ? profileExperienceSchema.safeParse(experienceInput(draft.experiences[index]!)) : profileEducationSchema.safeParse(educationInput(draft.education[index]!));
    if (result.success) return null;
    const found = issueErrors(result.error.issues, [list, index]);
    setErrors((e) => ({ ...e, ...found }));
    const [path = "", message = ""] = Object.entries(found)[0] ?? [];
    return { field: path.split(".")[2] ?? "", message };
  };

  /** Opens whatever holds a problem at `paths`, says where to look, and has the screen bring the first one into view. */
  const reveal = (paths: string[]) => {
    if (paths.some((p) => p === "maritalStatus" || p === "kidsCount")) setPersonalOpen(true);
    for (const p of paths) {
      const [list, index] = p.split(".");
      const row = list === "experiences" || list === "education" ? draft[list][Number(index)] : undefined;
      if (row) fold(row.key, false);
    }
    const sections = paths.map((p) => profileSectionOf(p, customFields));
    const first = PROFILE_SECTIONS.find((s) => sections.includes(s)) ?? "basics";
    // The marked inputs may be out of sight (the photo is at the very top), so say so beside the button too.
    setServerError(paths.includes("avatarUrl") ? "Check the profile photo at the top." : mode === "edit" ? `Check the details marked in ${PROFILE_SECTION_TITLES[first]}.` : "Check the details marked above.");
    onRefused?.(first);
  };

  /** The answers to `defs` the member can change, checked: registration needs every required one. */
  const checkAnswers = (defs: ProfileFieldDto[]) => {
    const editable = Object.fromEntries(defs.filter((x) => x.memberEditable).map((x) => [x.key, answers[x.key] ?? null]));
    return { editable, ...validateProfileFieldValues(defs, editable, { requireAll: mode === "register", previous: answersToValues(initial?.fields), canEdit: (x) => x.memberEditable }) };
  };

  /**
   * The draft as the schema reads it, with the inputs this member can't see left out: what the form hides (a student's
   * start year, a pupil's links and Open to, studies here at a school) keeps its value for when it shows again, but is
   * neither checked nor sent, so nothing they can't see may block a save.
   */
  const parse = (skills: string[]) => {
    const hidden = hiddenProfileKeys(tenant, { professionType: draft.professionType, batchYear: Number(draft.batchYear), dateOfBirth: draft.dateOfBirth || null });
    return membershipProfileSchema.safeParse(withoutHiddenProfileKeys(draftBody(draft, skills, initial?.avatarUrl ?? null), hidden));
  };
  const batchOutOfRange = (batch: number) =>
    batch < tenant.settings.minBatchYear || batch > tenant.settings.maxBatchYear ? `Must be between ${tenant.settings.minBatchYear} and ${tenant.settings.maxBatchYear}` : null;

  /**
   * Checks one section as saving would, with the institution's questions in it, as registration does before leaving a
   * step: marks what's wrong, says so by the button and reports the section (onRefused), as a refused save does. True
   * when there's nothing wrong. Checking Work first adds the skill still typed in its box, which is about to go.
   */
  const checkSection = (section: ProfileSection): boolean => {
    if (photoBusy || busy) return false;
    setServerError(null);
    const skills = section === "work" ? (skillsRef.current?.commit() ?? draft.skills) : draft.skills;
    const parsed = parse(skills);
    const found: Record<string, string> = parsed.success ? {} : Object.fromEntries(Object.entries(withBlankBatch(issueErrors(parsed.error.issues), draft)).filter(([path]) => profileSectionOf(path) === section));
    const outOfRange = section === "basics" && !("batchYear" in found) ? batchOutOfRange(Number(draft.batchYear)) : null;
    if (outOfRange) found.batchYear = outOfRange;
    const defs = customFields.filter((x) => profileSectionOf(`fields.${x.key}`, customFields) === section);
    const { errors: wrong } = checkAnswers(defs);
    const keys = profileSectionFields(section);
    setErrors((e) => ({ ...without(e, ...keys, ...keys.map((k) => `${k}.`)), ...found }));
    setAnswerErrors((e) => ({ ...e, ...Object.fromEntries(defs.map((x) => [x.key, wrong[x.key] ?? ""])) }));
    const paths = [...Object.keys(found), ...Object.keys(wrong).map((k) => `fields.${k}`)];
    if (paths.length === 0) return true;
    reveal(paths);
    return false;
  };

  const submit = async () => {
    if (photoBusy || busy) return;
    setErrors({});
    setServerError(null);
    const skills = skillsRef.current?.commit() ?? draft.skills;
    const check = checkAnswers(customFields);
    const editable = check.editable;
    setAnswerErrors(check.errors);
    if (Object.keys(check.errors).length) return reveal(Object.keys(check.errors).map((k) => `fields.${k}`));
    const parsed = parse(skills);
    if (!parsed.success) {
      const next = withBlankBatch(issueErrors(parsed.error.issues), draft);
      setErrors(next);
      return reveal(Object.keys(next));
    }
    const outOfRange = batchOutOfRange(parsed.data.batchYear);
    if (outOfRange) {
      setErrors({ batchYear: outOfRange });
      return reveal(["batchYear"]);
    }
    setBusy(true);
    try {
      await onSubmit(customFields.length ? { ...parsed.data, fields: editable } : parsed.data);
    } catch (err) {
      const fieldErrors = isApiClientError(err) ? err.fieldErrors : {};
      const paths = Object.keys(fieldErrors);
      const placed = paths.filter((p) => p.startsWith("fields.") || FORM_FIELDS.has(p.split(".")[0] ?? ""));
      if (placed.length === 0) {
        setServerError(errorMessage(err));
        onRefused?.(null);
        return;
      }
      setErrors(Object.fromEntries(placed.filter((p) => !p.startsWith("fields.")).map((p) => [p, fieldErrors[p]!])));
      setAnswerErrors(Object.fromEntries(placed.filter((p) => p.startsWith("fields.")).map((p) => [p.slice("fields.".length), fieldErrors[p]!])));
      reveal(placed);
      // Anything no input shows is said in full.
      if (placed.length < paths.length) setServerError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  /** A list-valued field's error: on the list, or else on the first of its items (a skill too long). */
  const listError = (key: "skills" | "interests") => errors[key] ?? Object.entries(errors).find(([k]) => k.startsWith(`${key}.`))?.[1];

  return {
    tenant,
    initial,
    mode,
    start,
    draft,
    set,
    setValues,
    setAvatar,
    errors,
    listError,
    answers,
    answerErrors,
    setAnswer,
    required,
    optional,
    pupil,
    serverError,
    /** Drops the note by the button, as registration does on moving to another step. */
    clearServerError: () => setServerError(null),
    busy,
    photoBusy,
    setPhotoBusy,
    personalOpen,
    setPersonalOpen,
    folded,
    fold,
    updateItem,
    addItem,
    removeItem,
    checkItem,
    checkSection,
    submit,
  };
}

export type ProfileDraftController = ReturnType<typeof useProfileDraft>;
