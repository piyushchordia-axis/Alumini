import { resolveFeatures, type TenantPublicDto, type TenantSettingsDto, type TenantSummaryDto, type TenantType } from "@illuminize/shared";
import type { TenantRow, TenantSettingsRow } from "../types/request";

export function toTenantSummaryDto(t: TenantRow): TenantSummaryDto {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    shortName: t.shortName,
    type: t.type,
    city: t.city,
    country: t.country,
    logoUrl: t.logoUrl,
    primaryColor: t.primaryColor,
  };
}

export function toTenantSettingsDto(s: TenantSettingsRow, type: TenantType): TenantSettingsDto {
  return {
    memberApprovalMode: s.memberApprovalMode,
    contentModerationMode: s.contentModerationMode,
    allowSelfRegistration: s.allowSelfRegistration,
    minBatchYear: s.minBatchYear,
    maxBatchYear: s.maxBatchYear,
    features: resolveFeatures(type, s.features),
    inviteAutoApprove: s.inviteAutoApprove,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function toTenantPublicDto(t: TenantRow, s: TenantSettingsRow): TenantPublicDto {
  return {
    ...toTenantSummaryDto(t),
    status: t.status,
    coverImageUrl: t.coverImageUrl,
    secondaryColor: t.secondaryColor,
    tagline: t.tagline,
    welcomeMessage: t.welcomeMessage,
    websiteUrl: t.websiteUrl,
    timezone: t.timezone,
    settings: {
      memberApprovalMode: s.memberApprovalMode,
      allowSelfRegistration: s.allowSelfRegistration,
      minBatchYear: s.minBatchYear,
      maxBatchYear: s.maxBatchYear,
      features: resolveFeatures(t.type, s.features),
    },
  };
}
