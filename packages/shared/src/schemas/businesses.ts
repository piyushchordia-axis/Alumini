import { z } from "zod";
import { BUSINESS_CATEGORIES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, optionalTrimmed, trimmedString, uuidSchema } from "./common";

export const businessCreateSchema = z.object({
  name: trimmedString(120, 2),
  category: z.enum(BUSINESS_CATEGORIES, { error: "Choose a category" }),
  description: trimmedString(2000, 10),
  // These reach an href and an image source on both apps, so only http and https get in. Both URLs go out in every
  // list row as well, so a long one would weigh on everyone who opens the directory.
  logoUrl: httpUrlSchema.max(2048).nullable().optional(),
  websiteUrl: httpUrlSchema.max(2048).nullable().optional(),
  city: optionalTrimmed(80),
  contactEmail: z.email().max(254).nullable().optional(),
  contactPhone: optionalTrimmed(24),
});
export type BusinessCreateInput = z.infer<typeof businessCreateSchema>;

export const businessUpdateSchema = businessCreateSchema.partial();
export type BusinessUpdateInput = z.infer<typeof businessUpdateSchema>;

export const businessListQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  category: z.enum(BUSINESS_CATEGORIES).optional(),
  city: z.string().trim().max(80).optional(),
  author: uuidSchema.optional(),
  mine: booleanQuerySchema.optional(),
});
export type BusinessListQuery = z.infer<typeof businessListQuerySchema>;
