import { z } from "zod";
import { FUNDING_KINDS, FUNDING_STAGES } from "../constants";
import { booleanQuerySchema, cursorQuerySchema, httpUrlSchema, optionalTrimmed, trimmedString } from "./common";

const fundingBase = {
  title: trimmedString(150, 2),
  pitch: trimmedString(5000, 10),
  amountMinMinor: z.number().int().nonnegative().nullable().optional(),
  amountMaxMinor: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  sectors: z.array(trimmedString(40)).max(10).optional(),
  websiteUrl: httpUrlSchema.nullable().optional(),
  contactEmail: z.email().nullable().optional(),
  contactPhone: optionalTrimmed(24),
};

const amountsConsistent = (v: { amountMinMinor?: number | null; amountMaxMinor?: number | null }) =>
  v.amountMinMinor == null || v.amountMaxMinor == null || v.amountMaxMinor >= v.amountMinMinor;

export const fundingCreateSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("SEEKING"), stage: z.enum(FUNDING_STAGES), ...fundingBase }),
    z.object({ kind: z.literal("OFFERING"), stage: z.enum(FUNDING_STAGES).nullable().optional(), ...fundingBase }),
  ])
  .refine(amountsConsistent, { message: "Maximum amount must be greater than or equal to the minimum", path: ["amountMaxMinor"] });
export type FundingCreateInput = z.infer<typeof fundingCreateSchema>;

export const fundingUpdateSchema = z
  .object({ stage: z.enum(FUNDING_STAGES).nullable().optional(), ...fundingBase })
  .partial()
  .refine(amountsConsistent, { message: "Maximum amount must be greater than or equal to the minimum", path: ["amountMaxMinor"] });
export type FundingUpdateInput = z.infer<typeof fundingUpdateSchema>;

export const fundingListQuerySchema = cursorQuerySchema.extend({
  kind: z.enum(FUNDING_KINDS).optional(),
  stage: z.enum(FUNDING_STAGES).optional(),
  q: z.string().trim().max(80).optional(),
  includeClosed: booleanQuerySchema.optional(),
  mine: booleanQuerySchema.optional(),
});
export type FundingListQuery = z.infer<typeof fundingListQuerySchema>;
