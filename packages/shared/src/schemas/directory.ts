import { z } from "zod";
import { INDUSTRIES, OPEN_TO, PROFESSION_TYPES, PROFILE_DEGREE_MAX_LENGTH, SKILL_MAX_LENGTH } from "../constants";
import { tidySkill } from "../lib/skills";
import { cursorQuerySchema, isoCountrySchema } from "./common";

export const directoryQuerySchema = cursorQuerySchema.extend({
  /** Matches part of a name, company, role, headline or skill. */
  q: z.string().trim().max(80).optional(),
  /** Were there in: members who had joined by this year and hadn't left before it, or are still members. */
  year: z.coerce.number().int().min(1).max(9999).optional(),
  city: z.string().trim().max(80).optional(),
  country: isoCountrySchema.optional(),
  professionType: z.enum(PROFESSION_TYPES).optional(),
  company: z.string().trim().max(120).optional(),
  industry: z.enum(INDUSTRIES).optional(),
  /** One skill, matched whole and regardless of case: "node.js" finds "Node.js", "node" doesn't. */
  skill: z.string().trim().max(SKILL_MAX_LENGTH).transform(tidySkill).optional(),
  /** Matched whole and regardless of case, like city. */
  fieldOfStudy: z.string().trim().max(PROFILE_DEGREE_MAX_LENGTH).optional(),
  /** Never finds a current pupil, who is open to nothing. */
  openTo: z.enum(OPEN_TO).optional(),
  /** Custom-field filters, "key:value" (repeat the parameter for several). */
  field: z
    .union([z.string().max(200), z.array(z.string().max(200)).max(10)])
    .optional()
    .transform((v) =>
      (v === undefined ? [] : Array.isArray(v) ? v : [v])
        .map((s) => {
          const i = s.indexOf(":");
          return i > 0 ? { key: s.slice(0, i), value: s.slice(i + 1) } : null;
        })
        .filter((x): x is { key: string; value: string } => !!x && !!x.value),
    ),
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
