import type { ProfileFieldType, ProfileFieldVisibility } from "../constants";
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
