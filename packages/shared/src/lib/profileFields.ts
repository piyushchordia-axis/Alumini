import { MAX_PROFILE_FIELDS, PROFILE_FIELD_TYPE_LABELS, type ProfileFieldType, type ProfileFieldVisibility } from "../constants";
import { isValidCalendarDate } from "./time";

/** A stored answer: text, number, date ("YYYY-MM-DD"), choice value(s) or yes/no. */
export type ProfileFieldValue = string | number | boolean | string[];

export interface ProfileFieldOption {
  value: string;
  label: string;
}

/** The parts of a field definition that validation and display need. */
export interface ProfileFieldDef {
  key: string;
  label: string;
  type: ProfileFieldType;
  options: ProfileFieldOption[];
  required: boolean;
  visibility: ProfileFieldVisibility;
  memberEditable: boolean;
}

const TEXT_MAX: Partial<Record<ProfileFieldType, number>> = { TEXT: 200, LONG_TEXT: 2000 };
export const MAX_MULTI_SELECT_VALUES = 20;

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/**
 * Checks one answer against its field. Empty input means "no answer" (null). Choice values that were valid before
 * (an option the admin has since removed) stay valid for the member who already has them.
 */
export function validateProfileFieldValue(def: ProfileFieldDef, raw: unknown, previous?: unknown): { ok: true; value: ProfileFieldValue | null } | { ok: false; message: string } {
  if (isEmpty(raw)) return { ok: true, value: null };
  const optionValues = new Set(def.options.map((o) => o.value));
  const prior = new Set(Array.isArray(previous) ? previous : typeof previous === "string" ? [previous] : []);
  switch (def.type) {
    case "TEXT":
    case "LONG_TEXT": {
      if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, message: "Enter text" };
      const s = String(raw).trim();
      const max = TEXT_MAX[def.type]!;
      return s.length > max ? { ok: false, message: `At most ${max} characters` } : { ok: true, value: s };
    }
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.trim()) : NaN;
      return Number.isFinite(n) && Math.abs(n) <= 1e12 ? { ok: true, value: n } : { ok: false, message: "Enter a number" };
    }
    case "DATE":
      return typeof raw === "string" && isValidCalendarDate(raw.trim()) ? { ok: true, value: raw.trim() } : { ok: false, message: "Enter a valid date" };
    case "BOOLEAN":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (raw === "true" || raw === "false") return { ok: true, value: raw === "true" };
      return { ok: false, message: "Choose yes or no" };
    case "SELECT":
      return typeof raw === "string" && (optionValues.has(raw) || prior.has(raw)) ? { ok: true, value: raw } : { ok: false, message: "Choose one of the options" };
    case "MULTI_SELECT": {
      if (!Array.isArray(raw) || raw.some((v) => typeof v !== "string")) return { ok: false, message: "Choose from the options" };
      const values = [...new Set(raw as string[])];
      if (values.length > MAX_MULTI_SELECT_VALUES) return { ok: false, message: `Choose at most ${MAX_MULTI_SELECT_VALUES}` };
      return values.every((v) => optionValues.has(v) || prior.has(v)) ? { ok: true, value: values } : { ok: false, message: "Choose from the options" };
    }
  }
}

export interface ValidateFieldsOptions {
  /** Registration: every required field needs an answer. Otherwise only clearing a required answer is refused. */
  requireAll: boolean;
  /** Current answers, for "previously valid" choices. */
  previous?: Record<string, unknown>;
  /** Whether the person may change this field (members can't change admin-managed fields). Default: all. */
  canEdit?: (def: ProfileFieldDef) => boolean;
}

/**
 * Validates a set of answers keyed by field key. Returns the cleaned values (null = clear) and errors keyed by field
 * key; unknown keys are errors. Used by the API and, for instant feedback, by the web and mobile forms.
 */
export function validateProfileFieldValues(
  defs: ProfileFieldDef[],
  input: Record<string, unknown> | undefined,
  opts: ValidateFieldsOptions,
): { values: Record<string, ProfileFieldValue | null>; errors: Record<string, string> } {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const values: Record<string, ProfileFieldValue | null> = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input ?? {})) {
    const def = byKey.get(key);
    if (!def) {
      errors[key] = "Unknown field";
      continue;
    }
    if (opts.canEdit && !opts.canEdit(def)) {
      // Sending back the unchanged value (forms post everything) is fine.
      if (JSON.stringify(raw ?? null) !== JSON.stringify(opts.previous?.[key] ?? null)) errors[key] = "Only admins can change this";
      continue;
    }
    const r = validateProfileFieldValue(def, raw, opts.previous?.[key]);
    if (!r.ok) errors[key] = r.message;
    else if (r.value === null && def.required) errors[key] = "This is required";
    else values[key] = r.value;
  }
  if (opts.requireAll) {
    for (const def of defs) {
      if (!def.required || hasOwn(errors, def.key) || values[def.key] != null) continue;
      if (opts.canEdit && !opts.canEdit(def)) continue;
      errors[def.key] = "This is required";
    }
  }
  return { values, errors };
}

const hasOwn = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** The types whose answers are picked from options. */
export const CHOICE_TYPES: readonly ProfileFieldType[] = ["SELECT", "MULTI_SELECT"];
/** The types a directory filter can offer: choices and yes/no. */
export const FILTERABLE_TYPES: readonly ProfileFieldType[] = ["SELECT", "MULTI_SELECT", "BOOLEAN"];

/** Whether a field can be a directory filter: a choice or yes/no that members can see (the directory ignores the rest). */
export function fieldCanFilter(type: ProfileFieldType, visibility: ProfileFieldVisibility): boolean {
  return FILTERABLE_TYPES.includes(type) && visibility === "MEMBERS";
}

/** Said beside the directory-filter switch while the field can't be one. */
export const FIELD_FILTER_HINT = "Only choice and yes/no questions that members can see can be filters";

/** The "Who can see answers" choices. */
export const FIELD_VISIBILITY_OPTIONS: readonly { value: ProfileFieldVisibility; label: string }[] = [
  { value: "MEMBERS", label: "Members, on profiles" },
  { value: "ADMINS", label: "Only admins (and the member)" },
];

/** A label as a field key or option value: "Blood group" → "blood_group", "2nd year" → "f_2nd_year". At most 40 characters; "" when nothing is left. */
export function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(?=[^a-z])/, "f_")
    .slice(0, 40);
}

/** The value for a new option labelled `label`: its slug, made different from the values already there. */
export function uniqueOptionValue(options: readonly ProfileFieldOption[], label: string): string {
  let value = slugifyKey(label) || "option";
  while (options.some((o) => o.value === value)) value = `${value}_`;
  return value;
}

/** What a field editor holds: everything a field is made of, the key included (which only a new field can set). */
export interface ProfileFieldDraft {
  key: string;
  label: string;
  helpText: string | null;
  type: ProfileFieldType;
  options: ProfileFieldOption[];
  required: boolean;
  visibility: ProfileFieldVisibility;
  memberEditable: boolean;
  filterable: boolean;
}

/** The editor's starting point: the field being edited, or a new short-text question members answer. */
export function emptyFieldDraft(field?: ProfileFieldDraft | null): ProfileFieldDraft {
  return {
    key: field?.key ?? "",
    label: field?.label ?? "",
    helpText: field?.helpText ?? null,
    type: field?.type ?? "TEXT",
    options: field?.options ?? [],
    required: field?.required ?? false,
    visibility: field?.visibility ?? "MEMBERS",
    memberEditable: field?.memberEditable ?? true,
    filterable: field?.filterable ?? false,
  };
}

/**
 * What an editor sends: options only for a choice, a directory filter only where one can be (a type changed away, or
 * answers made admin-only, leave the box ticked underneath), and no help text rather than a blank one.
 */
export function normalizeFieldBody(draft: ProfileFieldDraft): ProfileFieldDraft {
  return {
    ...draft,
    helpText: draft.helpText?.trim() ? draft.helpText : null,
    options: CHOICE_TYPES.includes(draft.type) ? draft.options : [],
    filterable: fieldCanFilter(draft.type, draft.visibility) && draft.filterable,
  };
}

/** `ids` with the one at `index` moved `delta` places (-1 up, 1 down); unchanged when that would leave the list. */
export function moveId(ids: readonly string[], index: number, delta: number): string[] {
  const next = [...ids];
  const to = index + delta;
  if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
  const [id] = next.splice(index, 1);
  next.splice(to, 0, id!);
  return next;
}

/**
 * A console list as the API stores a reorder of `ids`, to show it at once: the listed fields first, in that order, then
 * the rest (archived ones, or one added meanwhile) in the order they had.
 */
export function inFieldOrder<T extends { id: string }>(rows: readonly T[], ids: readonly string[]): T[] {
  const at = new Map(ids.map((id, i) => [id, i]));
  const place = (row: T) => at.get(row.id) ?? ids.length;
  // A stable sort: the unlisted keep their order.
  return [...rows].sort((a, b) => place(a) - place(b));
}

export type FieldBadgeTone = "neutral" | "warning" | "info" | "success" | "danger";

/** The badges on a field's row in the console, in order: its type, then what's special about it. */
export function fieldBadges(field: Pick<ProfileFieldDraft, "type" | "required" | "visibility" | "memberEditable" | "filterable"> & { archivedAt: string | null }): { label: string; tone: FieldBadgeTone }[] {
  const badges: { label: string; tone: FieldBadgeTone }[] = [{ label: PROFILE_FIELD_TYPE_LABELS[field.type], tone: "neutral" }];
  if (field.required) badges.push({ label: "Required", tone: "warning" });
  if (field.visibility === "ADMINS") badges.push({ label: "Admins only", tone: "info" });
  if (!field.memberEditable) badges.push({ label: "Set by admins", tone: "info" });
  // Only where it filters: an admin-only field may still have the flag stored from before.
  if (field.filterable && fieldCanFilter(field.type, field.visibility)) badges.push({ label: "Directory filter", tone: "success" });
  if (field.archivedAt) badges.push({ label: "Archived", tone: "danger" });
  return badges;
}

/** The profile-fields page's line under its title, with how many of the allowed questions are in use. */
export function profileFieldsSubtitle(activeCount: number): string {
  return `Your own questions on member profiles, such as house, roll number or hostel (${activeCount} of ${MAX_PROFILE_FIELDS}).`;
}

/** What the console asks before archiving a field. */
export function archiveFieldConfirm(label: string): { title: string; body: string; confirmLabel: string } {
  return {
    title: `Archive “${label}”?`,
    body: "Members stop seeing it on profiles and forms, and it stops being a directory filter. Their answers are kept, and you can restore it from Show archived fields.",
    confirmLabel: "Archive",
  };
}

/** Answers keyed by field key, as the forms hold them and the API takes them. */
export type ProfileFieldAnswers = Record<string, ProfileFieldValue | null>;

/** A membership's answers as a form's values, keyed by field. */
export function answersToValues(answers: ReadonlyArray<{ key: string; value: ProfileFieldValue | null }> | undefined): ProfileFieldAnswers {
  return Object.fromEntries((answers ?? []).map((a) => [a.key, a.value]));
}

/** Who fills in a member's answers: the member, or an admin, who can also change the ones set by admins. */
export type ProfileFieldAudience = "member" | "admin";

/**
 * The hint under a question's input: its help text, then who sees the answer, worded for whoever is filling it in. An
 * admin-managed question an admin answers is hidden from the member unless everyone may see it.
 */
export function profileFieldHint(f: { helpText?: string | null; visibility: ProfileFieldVisibility; memberEditable: boolean }, audience: ProfileFieldAudience = "member"): string | undefined {
  let who: string | null = null;
  if (audience === "member") who = f.visibility === "ADMINS" ? "Only you and the admins see this." : null;
  else if (f.visibility === "ADMINS") who = f.memberEditable ? "Only the member and the admins see this." : "Only admins see this answer.";
  else if (!f.memberEditable) who = "Set by the admins: the member can't change it.";
  return [f.helpText, who].filter(Boolean).join(" ") || undefined;
}

/**
 * A choice question's options, with any saved answer no longer among them (an option removed since) added as itself, so
 * an edit shows it rather than a blank, and doesn't drop it unasked.
 */
export function choiceOptionsWithCurrent(options: readonly ProfileFieldOption[], current: ProfileFieldValue | null | undefined): ProfileFieldOption[] {
  const saved = Array.isArray(current) ? current : typeof current === "string" && current !== "" ? [current] : [];
  const missing = [...new Set(saved)].filter((v) => !options.some((o) => o.value === v));
  return [...options, ...missing.map((v) => ({ value: v, label: v }))];
}

/** How an answer reads on a profile: option labels, "Yes"/"No", dates as given. */
export function formatProfileFieldValue(def: Pick<ProfileFieldDef, "type" | "options">, value: ProfileFieldValue | null | undefined): string {
  if (value === null || value === undefined) return "";
  const label = (v: string) => def.options.find((o) => o.value === v)?.label ?? v;
  switch (def.type) {
    case "BOOLEAN":
      return value === true ? "Yes" : value === false ? "No" : String(value);
    case "SELECT":
      return label(String(value));
    case "MULTI_SELECT":
      return (Array.isArray(value) ? value : [String(value)]).map(label).join(", ");
    default:
      return Array.isArray(value) ? value.join(", ") : String(value);
  }
}
