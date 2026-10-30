import { z } from "zod";
import { COUNTRIES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants";

export const uuidSchema = z.uuid();
export const phoneE164Schema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Phone must be in international format, e.g. +919876543210");
export const tenantSlugSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9]([a-z0-9-]{1,48}[a-z0-9])?$/, "Slug may contain lowercase letters, digits and hyphens");
export const isoCountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2)
  .refine((c) => COUNTRIES.some((x) => x.code === c), "Unknown country code");
export const hexColorSchema = z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour");
export const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "URL must start with http:// or https://");
export const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const cursorQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((v) => v === true || v === "true" || v === "1");

export const tenantSlugParamsSchema = z.object({ slug: tenantSlugSchema });
export const idParamsSchema = z.object({ id: uuidSchema });

export const trimmedString = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v === "" ? null : (v ?? null)));
