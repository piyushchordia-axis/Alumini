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
});
export type DirectoryQuery = z.infer<typeof directoryQuerySchema>;
