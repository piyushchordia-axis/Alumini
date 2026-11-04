import { z } from "zod";
import { COUNTRIES, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../constants";
import { normalizeSkills, tidySkill } from "../lib/skills";
import { isValidCalendarDate } from "../lib/time";

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
const urlParts = (u: string): URL | null => {
  try {
    return new URL(u);
  } catch {
    return null;
  }
};

/**
 * An http(s) link a member puts on their profile. No user name or password: "https://linkedin.com@evil.com" reads as
 * one site and opens another. An unparsable link passes that check, which leaves it to the URL check's own message.
 *
 * It's stored as the URL parser read it (`URL.href`), so whatever opens it later goes where the checks looked. Typed
 * text can read differently to other parsers: "https://linkedin.com\@evil.com" is linkedin.com to a browser but
 * evil.com to iOS, and is stored as "https://linkedin.com/@evil.com", linkedin.com to both. That also lower-cases the
 * host, ends a bare host with "/", and percent-encodes spaces, bidi controls and other non-ASCII text in the path.
 */
export const linkUrlSchema = httpUrlSchema
  .refine((u) => {
    const url = urlParts(u);
    return !url || (!url.username && !url.password);
  }, "Remove the user name or password from the link")
  .transform((u) => urlParts(u)?.href ?? u)
  .pipe(z.string().max(500, "Keep the link to 500 characters"));

/**
 * A link to one of `hosts`, or a subdomain of one ("www.linkedin.com", "in.linkedin.com"), judged by the URL's own
 * hostname: a check of the whole text would let "https://evil.com/?linkedin.com/" through. Stored as linkUrlSchema
 * stores it.
 */
export const hostUrlSchema = (hosts: readonly string[], message = `Must be a ${hosts.join(" or ")} link`) =>
  linkUrlSchema.refine((u) => {
    const url = urlParts(u);
    if (!url) return true;
    const host = url.hostname.toLowerCase();
    return hosts.some((h) => host === h || host.endsWith(`.${h}`));
  }, message);

export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isValidCalendarDate, "Not a real date");
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

/**
 * A list of skills, stored normalised (see `normalizeSkills`). Each skill's length is checked as it's sent, tidied, so an
 * error's path is that skill's place in the list sent; the count is checked after normalising, so repeats and blanks don't
 * count. Going over either limit is an error rather than a list silently cut short.
 */
export const skillListSchema = (max: number, maxLength: number) =>
  z
    .array(z.string().transform(tidySkill).pipe(z.string().max(maxLength, `Keep each skill to ${maxLength} characters`)))
    .transform((list) => normalizeSkills(list))
    .pipe(z.array(z.string()).max(max, `Add at most ${max} skills`));
