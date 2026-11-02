import type { AdminSettingsDto, TenantBrandingUpdate, TenantPublicDto, TenantSettingsDto, TenantSettingsUpdate } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toTenantPublicDto, toTenantSettingsDto } from "../dto/tenant.dto";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { findSettings, updateSettings, updateTenant } from "../repositories/tenants.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { tenantOutboundChannels } from "./billing.service";
import { featuresToStore, invalidateTenantCache } from "./tenant.service";

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

export async function getTenantSettings(ctx: AppContext, tenantCtx: TenantContext): Promise<AdminSettingsDto> {
  const [settings, outboundChannels] = await Promise.all([findSettings(ctx.db, tenantCtx.tenant.id), tenantOutboundChannels(ctx, tenantCtx.tenant.id)]);
  const s = settings ?? tenantCtx.settings;
  return { settings: toTenantSettingsDto(s, tenantCtx.tenant.type), branding: toTenantPublicDto(tenantCtx.tenant, s), outboundChannels };
}

export async function updateTenantSettings(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, input: TenantSettingsUpdate): Promise<TenantSettingsDto> {
  // The row stays locked from read to write, because the map written is the stored one plus this change. Without the lock,
  // an overlapping save or retype could be undone by the stale keys this one writes back.
  const row = await runInTransaction(ctx, async (tx) => {
    const current = await findSettings(tx, tenantCtx.tenant.id, true);
    if (!current) throw AppError.notFound("Settings not found");
    const minBatchYear = input.minBatchYear ?? current.minBatchYear;
    const maxBatchYear = input.maxBatchYear ?? current.maxBatchYear;
    if (minBatchYear > maxBatchYear) throw AppError.badRequest("minBatchYear must be <= maxBatchYear");
    return (await updateSettings(tx, tenantCtx.tenant.id, {
      ...(input.memberApprovalMode !== undefined ? { memberApprovalMode: input.memberApprovalMode } : {}),
      ...(input.contentModerationMode !== undefined ? { contentModerationMode: input.contentModerationMode } : {}),
      ...(input.allowSelfRegistration !== undefined ? { allowSelfRegistration: input.allowSelfRegistration } : {}),
      minBatchYear,
      maxBatchYear,
      ...(input.features ? { features: featuresToStore(tenantCtx.tenant.type, current.features, input.features) } : {}),
      ...(input.inviteAutoApprove !== undefined ? { inviteAutoApprove: input.inviteAutoApprove } : {}),
      updatedByUserId: actor.userId,
    }))!;
  });
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
  return toTenantSettingsDto(row, tenantCtx.tenant.type);
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
