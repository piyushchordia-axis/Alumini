import { z } from "zod";
import { PROFESSION_TYPES } from "../constants";
import { cursorQuerySchema, isoCountrySchema } from "./common";

export const directoryQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  batchYear: z.coerce.number().int().optional(),
  city: z.string().trim().max(80).optional(),
  country: isoCountrySchema.optional(),
  professionType: z.enum(PROFESSION_TYPES).optional(),
  company: z.string().trim().max(120).optional(),
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
