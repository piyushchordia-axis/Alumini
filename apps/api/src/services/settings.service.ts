import type { AdminSettingsDto, TenantBrandingUpdate, TenantPublicDto, TenantSettingsDto, TenantSettingsUpdate } from "@illuminize/shared";
import { DEFAULT_TENANT_FEATURES } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toTenantPublicDto, toTenantSettingsDto } from "../dto/tenant.dto";
import { AppError } from "../lib/errors";
import { findSettings, updateSettings, updateTenant } from "../repositories/tenants.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { tenantOutboundChannels } from "./billing.service";
import { invalidateTenantCache } from "./tenant.service";

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

export async function getTenantSettings(ctx: AppContext, tenantCtx: TenantContext): Promise<AdminSettingsDto> {
  const [settings, outboundChannels] = await Promise.all([findSettings(ctx.db, tenantCtx.tenant.id), tenantOutboundChannels(ctx, tenantCtx.tenant.id)]);
  const s = settings ?? tenantCtx.settings;
  return { settings: toTenantSettingsDto(s), branding: toTenantPublicDto(tenantCtx.tenant, s), outboundChannels };
}

export async function updateTenantSettings(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, input: TenantSettingsUpdate): Promise<TenantSettingsDto> {
  const current = (await findSettings(ctx.db, tenantCtx.tenant.id)) ?? tenantCtx.settings;
  const minBatchYear = input.minBatchYear ?? current.minBatchYear;
  const maxBatchYear = input.maxBatchYear ?? current.maxBatchYear;
  if (minBatchYear > maxBatchYear) throw AppError.badRequest("minBatchYear must be <= maxBatchYear");
  const row = await updateSettings(ctx.db, tenantCtx.tenant.id, {
    ...(input.memberApprovalMode !== undefined ? { memberApprovalMode: input.memberApprovalMode } : {}),
    ...(input.contentModerationMode !== undefined ? { contentModerationMode: input.contentModerationMode } : {}),
    ...(input.allowSelfRegistration !== undefined ? { allowSelfRegistration: input.allowSelfRegistration } : {}),
    minBatchYear,
    maxBatchYear,
    ...(input.features ? { features: { ...DEFAULT_TENANT_FEATURES, ...current.features, ...input.features } } : {}),
    ...(input.inviteAutoApprove !== undefined ? { inviteAutoApprove: input.inviteAutoApprove } : {}),
    updatedByUserId: actor.userId,
  });
  if (!row) throw AppError.notFound("Settings not found");
  await invalidateTenantCache(ctx, tenantCtx.tenant.slug);
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "tenant.settings.update",
    targetType: "tenant",
    targetId: tenantCtx.tenant.id,
    metadata: { changes: input },
    ip: actor.ip,
  });
  return toTenantSettingsDto(row);
}

export async function updateTenantBranding(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, input: TenantBrandingUpdate): Promise<TenantPublicDto> {
  const row = await updateTenant(ctx.db, tenantCtx.tenant.id, input);
  if (!row) throw AppError.notFound("Institution not found");
  await invalidateTenantCache(ctx, tenantCtx.tenant.slug);
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "tenant.branding.update",
    targetType: "tenant",
    targetId: tenantCtx.tenant.id,
    metadata: { fields: Object.keys(input) },
    ip: actor.ip,
  });
  const settings = (await findSettings(ctx.db, tenantCtx.tenant.id)) ?? tenantCtx.settings;
  return toTenantPublicDto(row, settings);
}
