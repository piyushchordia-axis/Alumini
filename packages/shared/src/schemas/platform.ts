import { z } from "zod";
import { BILLING_CYCLES, BILLING_MODELS, MESSAGE_CHANNELS, MIN_BATCH_YEAR, TENANT_STATUSES, TENANT_TYPES } from "../constants";
import { phoneInputSchema } from "./auth";
import { dateOnlySchema, hexColorSchema, httpUrlSchema, isoCountrySchema, optionalTrimmed, pageQuerySchema, tenantSlugSchema, trimmedString, uuidSchema } from "./common";
import { timezoneSchema } from "./events";
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
  timezone: timezoneSchema.optional(),
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

/** Charge per message by channel, in minor units (paise); fractions allowed (₹0.115 = 11.5). */
export const messageRatesSchema = z.object(Object.fromEntries(MESSAGE_CHANNELS.map((c) => [c, z.number().min(0).max(100_000)])) as Record<(typeof MESSAGE_CHANNELS)[number], z.ZodNumber>).partial();

/** Channels the subscription includes for admin-initiated sends (invites, announcements). */
const includedChannelsSchema = z.array(z.enum(MESSAGE_CHANNELS)).max(MESSAGE_CHANNELS.length).transform((v) => [...new Set(v)]);

const planFields = {
  includedChannels: includedChannelsSchema.default([]),
  messageRatesMinor: messageRatesSchema.default({}),
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
    includedChannels: includedChannelsSchema,
    messageRatesMinor: messageRatesSchema,
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

/** Staff check that a channel is configured: sends the PLATFORM_TEST message to a phone and/or email. */
export const platformTestMessageSchema = z
  .object({
    phone: phoneInputSchema.optional(),
    email: z.email().optional(),
    channels: z.array(z.enum(MESSAGE_CHANNELS)).min(1).max(3).optional(),
  })
  .refine((v) => v.phone || v.email, { message: "Give a phone number or an email address", path: ["phone"] });
export type PlatformTestMessageInput = z.infer<typeof platformTestMessageSchema>;

/** Platform staff: run an institution's scheduled work now (demos, support), instead of waiting for its local time. */
export const PLATFORM_RUNNABLE_JOBS = ["celebrations", "digest"] as const;
export const platformJobRunSchema = z.object({
  job: z.enum(PLATFORM_RUNNABLE_JOBS),
  tenantId: uuidSchema,
  /** Run again even if today's (this week's) run already happened. Members never get the same item twice. */
  force: z.boolean().default(false),
});
export type PlatformJobRunInput = z.infer<typeof platformJobRunSchema>;

/** Cross-institution comparison for a period of calendar days in the billing time zone (default: this month). */
export const platformComparisonQuerySchema = billingUsageQuerySchema;
