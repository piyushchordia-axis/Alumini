import { z } from "zod";
import { MAX_PROFILE_FIELD_OPTIONS, PROFILE_FIELD_TYPES, PROFILE_FIELD_VISIBILITIES, type ProfileFieldType } from "../constants";
import { MAX_MULTI_SELECT_VALUES } from "../lib/profileFields";
import { optionalTrimmed, trimmedString, uuidSchema } from "./common";

/** Stable id of a field in forms, CSV columns and the API: 2–40 of a-z, 0-9 and _, starting with a letter. */
export const profileFieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, "Use 2–40 lowercase letters, numbers or _, starting with a letter");

const optionSchema = z.object({ value: trimmedString(60, 1), label: trimmedString(100, 1) });

const CHOICE_TYPES: ProfileFieldType[] = ["SELECT", "MULTI_SELECT"];
const FILTERABLE_TYPES: ProfileFieldType[] = ["SELECT", "MULTI_SELECT", "BOOLEAN"];

/** Rules that tie type, options and filterable together (applied to creates, and to the merged result of updates). */
export function profileFieldConsistencyIssues(v: { type: ProfileFieldType; options: Array<{ value: string }>; filterable: boolean }): Array<{ path: string; message: string }> {
  const issues: Array<{ path: string; message: string }> = [];
  if (CHOICE_TYPES.includes(v.type)) {
    if (v.options.length === 0) issues.push({ path: "options", message: "Add at least one option" });
    if (new Set(v.options.map((o) => o.value)).size !== v.options.length) issues.push({ path: "options", message: "Options must be different" });
  } else if (v.options.length > 0) issues.push({ path: "options", message: "Only choice fields have options" });
  if (v.filterable && !FILTERABLE_TYPES.includes(v.type)) issues.push({ path: "filterable", message: "Only choice and yes/no fields can be directory filters" });
  return issues;
}

const fieldBase = {
  label: trimmedString(80, 1),
  helpText: optionalTrimmed(200),
  type: z.enum(PROFILE_FIELD_TYPES),
  options: z.array(optionSchema).max(MAX_PROFILE_FIELD_OPTIONS),
  required: z.boolean(),
  visibility: z.enum(PROFILE_FIELD_VISIBILITIES),
  /** false: only admins set it (e.g. "Alumni card verified"). */
  memberEditable: z.boolean(),
  /** Offered as a filter in the member directory (choice and yes/no fields). */
  filterable: z.boolean(),
};

export const profileFieldCreateSchema = z
  .object({
    key: profileFieldKeySchema,
    ...fieldBase,
    options: fieldBase.options.default([]),
    required: fieldBase.required.default(false),
    visibility: fieldBase.visibility.default("MEMBERS"),
    memberEditable: fieldBase.memberEditable.default(true),
    filterable: fieldBase.filterable.default(false),
  })
  .superRefine((v, c) => {
    for (const i of profileFieldConsistencyIssues(v)) c.addIssue({ code: "custom", path: [i.path], message: i.message });
  });
export type ProfileFieldCreateInput = z.infer<typeof profileFieldCreateSchema>;

/** The key can't change (it names the field in CSVs and stored answers). */
export const profileFieldUpdateSchema = z.object(fieldBase).partial();
export type ProfileFieldUpdateInput = z.infer<typeof profileFieldUpdateSchema>;

export const profileFieldReorderSchema = z.object({ ids: z.array(uuidSchema).min(1).max(100) });
export type ProfileFieldReorderInput = z.infer<typeof profileFieldReorderSchema>;

export const profileFieldIdParamsSchema = z.object({ fieldId: uuidSchema });

/** Answers sent with a profile, keyed by field key (validated against the institution's fields by the API). */
export const profileFieldAnswersSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(100)).max(MAX_MULTI_SELECT_VALUES), z.null()]),
);
