import { z } from "zod";
import { BILLING_CYCLES, BILLING_MODELS, MIN_BATCH_YEAR, TENANT_STATUSES, TENANT_TYPES } from "../constants";
import { phoneInputSchema } from "./auth";
import { dateOnlySchema, hexColorSchema, httpUrlSchema, isoCountrySchema, optionalTrimmed, pageQuerySchema, tenantSlugSchema, trimmedString, uuidSchema } from "./common";
import { tenantBrandingUpdateSchema, tenantSettingsUpdateSchema } from "./tenant";

const currentYear = new Date().getFullYear();

export const tenantIdParamsSchema = z.object({ tenantId: uuidSchema });
export const planIdParamsSchema = z.object({ planId: uuidSchema });
export const userIdParamsSchema = z.object({ userId: uuidSchema });
export const tenantAdminParamsSchema = z.object({ tenantId: uuidSchema, membershipId: uuidSchema });

export const platformTenantsQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
});
export type PlatformTenantsQuery = z.infer<typeof platformTenantsQuerySchema>;

export const initialAdminSchema = z.object({
  phone: phoneInputSchema,
  fullName: trimmedString(100, 2),
  batchYear: z.number().int().min(MIN_BATCH_YEAR).max(currentYear + 10).optional(),
});
export type InitialAdminInput = z.infer<typeof initialAdminSchema>;

export const platformTenantCreateSchema = z.object({
  slug: tenantSlugSchema,
  name: trimmedString(120, 2),
  shortName: optionalTrimmed(40),
  type: z.enum(TENANT_TYPES).default("COLLEGE"),
  city: optionalTrimmed(80),
  country: isoCountrySchema.nullable().optional(),
  tagline: optionalTrimmed(160),
  welcomeMessage: optionalTrimmed(2000),
  websiteUrl: httpUrlSchema.nullable().optional(),
  logoUrl: httpUrlSchema.nullable().optional(),
  primaryColor: hexColorSchema.optional(),
  secondaryColor: hexColorSchema.optional(),
  settings: tenantSettingsUpdateSchema.optional(),
  initialAdmin: initialAdminSchema.optional(),
});
export type PlatformTenantCreateInput = z.infer<typeof platformTenantCreateSchema>;

export const platformTenantUpdateSchema = tenantBrandingUpdateSchema.safeExtend({
  type: z.enum(TENANT_TYPES).optional(),
  status: z.enum(TENANT_STATUSES).optional(),
});
export type PlatformTenantUpdateInput = z.infer<typeof platformTenantUpdateSchema>;

export const assignAdminSchema = initialAdminSchema;
export type AssignAdminInput = z.infer<typeof assignAdminSchema>;

const planFields = {
  billingCycle: z.enum(BILLING_CYCLES).default("MONTHLY"),
  currency: z.string().trim().toUpperCase().length(3).default("INR"),
  pricePerActiveUserMinor: z.number().int().nonnegative().nullable().optional(),
  flatFeeMinor: z.number().int().nonnegative().nullable().optional(),
  effectiveTo: dateOnlySchema.nullable().optional(),
  notes: optionalTrimmed(1000),
};

const planConsistent = (v: { billingModel?: string; pricePerActiveUserMinor?: number | null; flatFeeMinor?: number | null }) => {
  if (v.billingModel === "PER_ACTIVE_USER") return v.pricePerActiveUserMinor != null;
  if (v.billingModel === "FLAT_FEE") return v.flatFeeMinor != null;
  return true;
};

export const billingPlanCreateSchema = z
  .object({ billingModel: z.enum(BILLING_MODELS), effectiveFrom: dateOnlySchema, ...planFields })
  .refine(planConsistent, { message: "Provide the price for the chosen billing model", path: ["billingModel"] })
  .refine((v) => !v.effectiveTo || v.effectiveTo >= v.effectiveFrom, { message: "effectiveTo must be on or after effectiveFrom", path: ["effectiveTo"] });
export type BillingPlanCreateInput = z.infer<typeof billingPlanCreateSchema>;

/** Partial update: no defaults here, or editing just the notes would reset the cycle and currency. */
export const billingPlanUpdateSchema = z
  .object({
    billingCycle: z.enum(BILLING_CYCLES),
    currency: z.string().trim().toUpperCase().length(3),
    pricePerActiveUserMinor: z.number().int().nonnegative().nullable(),
    flatFeeMinor: z.number().int().nonnegative().nullable(),
    effectiveTo: dateOnlySchema.nullable(),
    notes: optionalTrimmed(1000),
  })
  .partial();
export type BillingPlanUpdateInput = z.infer<typeof billingPlanUpdateSchema>;

export const billingUsageQuerySchema = z
  .object({ from: dateOnlySchema.optional(), to: dateOnlySchema.optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: "from must be on or before to", path: ["from"] });
export type BillingUsageQuery = z.infer<typeof billingUsageQuerySchema>;

export const snapshotCreateSchema = z
  .object({ periodStart: dateOnlySchema, periodEnd: dateOnlySchema, notes: optionalTrimmed(1000) })
  .refine((v) => v.periodStart <= v.periodEnd, { message: "periodStart must be on or before periodEnd", path: ["periodStart"] });
export type SnapshotCreateInput = z.infer<typeof snapshotCreateSchema>;

export const platformUsersQuerySchema = pageQuerySchema.extend({
  phone: z.string().trim().max(24).optional(),
});
export type PlatformUsersQuery = z.infer<typeof platformUsersQuerySchema>;

export const platformAdminToggleSchema = z.object({ enabled: z.boolean() });
export type PlatformAdminToggleInput = z.infer<typeof platformAdminToggleSchema>;
