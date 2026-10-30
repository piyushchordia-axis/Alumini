import { z } from "zod";
import { APPROVAL_MODES, MIN_BATCH_YEAR, TENANT_FEATURES } from "../constants";
import { hexColorSchema, httpUrlSchema, isoCountrySchema, optionalTrimmed, trimmedString } from "./common";

export const tenantListQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
});
export type TenantListQuery = z.infer<typeof tenantListQuerySchema>;

export const featuresSchema = z.object(
  Object.fromEntries(TENANT_FEATURES.map((f) => [f, z.boolean()])) as Record<(typeof TENANT_FEATURES)[number], z.ZodBoolean>,
);

const currentYear = new Date().getFullYear();

export const tenantSettingsUpdateSchema = z
  .object({
    memberApprovalMode: z.enum(APPROVAL_MODES),
    contentModerationMode: z.enum(APPROVAL_MODES),
    allowSelfRegistration: z.boolean(),
    minBatchYear: z.number().int().min(MIN_BATCH_YEAR).max(currentYear + 10),
    maxBatchYear: z.number().int().min(MIN_BATCH_YEAR).max(currentYear + 10),
    features: featuresSchema.partial(),
  })
  .partial()
  .refine((v) => v.minBatchYear === undefined || v.maxBatchYear === undefined || v.minBatchYear <= v.maxBatchYear, {
    message: "minBatchYear must be <= maxBatchYear",
    path: ["minBatchYear"],
  });
export type TenantSettingsUpdate = z.infer<typeof tenantSettingsUpdateSchema>;

export const tenantBrandingUpdateSchema = z
  .object({
    name: trimmedString(120, 2),
    shortName: optionalTrimmed(40),
    tagline: optionalTrimmed(160),
    welcomeMessage: optionalTrimmed(2000),
    logoUrl: httpUrlSchema.nullable(),
    coverImageUrl: httpUrlSchema.nullable(),
    primaryColor: hexColorSchema,
    secondaryColor: hexColorSchema,
    websiteUrl: httpUrlSchema.nullable(),
    city: optionalTrimmed(80),
    country: isoCountrySchema.nullable(),
  })
  .partial();
export type TenantBrandingUpdate = z.infer<typeof tenantBrandingUpdateSchema>;
