import type {
  AdminMemberDto,
  AssignAdminInput,
  PlatformTenantCreateInput,
  PlatformTenantDto,
  PlatformTenantRowDto,
  PlatformTenantUpdateInput,
  PlatformTenantsQuery,
  PlatformUserDto,
  PlatformUsersQuery,
  TenantSettingsUpdate,
  TenantSettingsDto,
} from "@illuminize/shared";
import { DEFAULT_TENANT_FEATURES } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { memberships, users } from "../db/schema";
import { toAdminMemberDto } from "../dto/membership.dto";
import { toBillingPlanDto } from "../dto/platform.dto";
import { toPlatformTenantRowDto, toPlatformUserDto, toTenantCountsDto } from "../dto/platform.dto";
import { toTenantPublicDto, toTenantSettingsDto } from "../dto/tenant.dto";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import { normalizePhone } from "../lib/phone";
import { findPlanEffectiveOn } from "../repositories/billing.repo";
import { findMembership, findMembershipWithUser, insertMembership, listMembershipsForUser, listTenantAdmins, updateMembership } from "../repositories/memberships.repo";
import {
  findSettings,
  findTenantBySlug,
  findTenantWithSettingsById,
  insertTenant,
  listTenantsForPlatform,
  tenantCounts,
  updateSettings,
  updateTenant,
  upsertSettings,
} from "../repositories/tenants.repo";
import { findOrCreateUserByPhone, findUserById, searchUsers, updateUser } from "../repositories/users.repo";
import type { AuthContext, MembershipRow, TenantRow } from "../types/request";
import { recordAudit } from "./audit.service";
import { invalidateTenantCache } from "./tenant.service";

interface PlatformActor extends AuthContext {
  ip?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function listPlatformTenants(ctx: AppContext, query: PlatformTenantsQuery): Promise<Page<PlatformTenantRowDto>> {
  const { rows, total } = await listTenantsForPlatform(ctx.db, query);
  return buildPage(
    rows.map((r) => toPlatformTenantRowDto(r.tenant, r)),
    query.page,
    query.pageSize,
    total,
  );
}

async function loadTenant(ctx: AppContext, tenantId: string) {
  const row = await findTenantWithSettingsById(ctx.db, tenantId);
  if (!row) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
  return row;
}

async function adminsOf(db: DbClient, tenantId: string): Promise<AdminMemberDto[]> {
  const admins = await listTenantAdmins(db, tenantId);
  const out: AdminMemberDto[] = [];
  for (const m of admins) {
    const user = await findUserById(db, m.userId);
    if (user) out.push(toAdminMemberDto(m, user));
  }
  return out;
}

export async function getPlatformTenant(ctx: AppContext, tenantId: string): Promise<PlatformTenantDto> {
  const { tenant, settings } = await loadTenant(ctx, tenantId);
  const [counts, plan, admins] = await Promise.all([tenantCounts(ctx.db, tenantId), findPlanEffectiveOn(ctx.db, tenantId, today()), adminsOf(ctx.db, tenantId)]);
  return {
    tenant: { ...toTenantPublicDto(tenant, settings), createdAt: tenant.createdAt.toISOString(), updatedAt: tenant.updatedAt.toISOString() },
    settings: toTenantSettingsDto(settings),
    counts: toTenantCountsDto(counts),
    currentPlan: plan ? toBillingPlanDto(plan) : null,
    admins,
  };
}

function settingsColumns(input: TenantSettingsUpdate | undefined, currentFeatures = DEFAULT_TENANT_FEATURES) {
  if (!input) return {};
  return {
    ...(input.memberApprovalMode !== undefined ? { memberApprovalMode: input.memberApprovalMode } : {}),
    ...(input.contentModerationMode !== undefined ? { contentModerationMode: input.contentModerationMode } : {}),
    ...(input.allowSelfRegistration !== undefined ? { allowSelfRegistration: input.allowSelfRegistration } : {}),
    ...(input.minBatchYear !== undefined ? { minBatchYear: input.minBatchYear } : {}),
    ...(input.maxBatchYear !== undefined ? { maxBatchYear: input.maxBatchYear } : {}),
    ...(input.features ? { features: { ...DEFAULT_TENANT_FEATURES, ...currentFeatures, ...input.features } } : {}),
  };
}

async function ensureAdminMembership(
  db: DbClient,
  tenant: TenantRow,
  input: AssignAdminInput,
  actorUserId: string,
  fallbackBatchYear: number,
): Promise<{ membership: MembershipRow; created: boolean }> {
  const { e164, region } = normalizePhone(input.phone);
  const user = await findOrCreateUserByPhone(db, e164, region);
  if (!user.displayName) await updateUser(db, user.id, { displayName: input.fullName });
  const existing = await findMembership(db, tenant.id, user.id);
  if (existing) {
    const membership = (await updateMembership(db, tenant.id, existing.id, {
      role: "TENANT_ADMIN",
      status: "APPROVED",
      statusReason: null,
      statusChangedAt: existing.status === "APPROVED" ? existing.statusChangedAt : new Date(),
      statusChangedByUserId: existing.status === "APPROVED" ? existing.statusChangedByUserId : actorUserId,
    }))!;
    return { membership, created: false };
  }
  const membership = await insertMembership(db, {
    tenantId: tenant.id,
    userId: user.id,
    role: "TENANT_ADMIN",
    status: "APPROVED",
    statusChangedAt: new Date(),
    statusChangedByUserId: actorUserId,
    fullName: input.fullName,
    batchYear: input.batchYear ?? fallbackBatchYear,
    professionType: "OTHER",
    city: tenant.city,
    country: tenant.country,
  });
  return { membership, created: true };
}

export async function createPlatformTenant(ctx: AppContext, actor: PlatformActor, input: PlatformTenantCreateInput): Promise<PlatformTenantDto> {
  if (await findTenantBySlug(ctx.db, input.slug)) throw AppError.conflict("An institution with this slug already exists");
  const tenantId = await ctx.db.transaction(async (tx) => {
    const tenant = await insertTenant(tx, {
      slug: input.slug,
      name: input.name,
      shortName: input.shortName ?? null,
      type: input.type,
      city: input.city ?? null,
      country: input.country ?? null,
      tagline: input.tagline ?? null,
      welcomeMessage: input.welcomeMessage ?? null,
      websiteUrl: input.websiteUrl ?? null,
      logoUrl: input.logoUrl ?? null,
      ...(input.primaryColor ? { primaryColor: input.primaryColor } : {}),
      ...(input.secondaryColor ? { secondaryColor: input.secondaryColor } : {}),
    });
    const settings = await upsertSettings(tx, {
      tenantId: tenant.id,
      maxBatchYear: new Date().getFullYear() + 6,
      ...settingsColumns(input.settings),
      updatedByUserId: actor.userId,
    });
    if (input.initialAdmin) {
      await ensureAdminMembership(tx, tenant, input.initialAdmin, actor.userId, Math.min(settings.maxBatchYear, new Date().getFullYear()));
    }
    await recordAudit(
      ctx,
      {
        tenantId: tenant.id,
        actorUserId: actor.userId,
        action: "platform.tenant.create",
        targetType: "tenant",
        targetId: tenant.id,
        metadata: { slug: tenant.slug, initialAdmin: input.initialAdmin ? normalizePhone(input.initialAdmin.phone).e164 : null },
        ip: actor.ip,
      },
      tx,
    );
    return tenant.id;
  });
  await invalidateTenantCache(ctx, input.slug);
  return getPlatformTenant(ctx, tenantId);
}

export async function updatePlatformTenant(ctx: AppContext, actor: PlatformActor, tenantId: string, input: PlatformTenantUpdateInput): Promise<PlatformTenantDto> {
  const { tenant } = await loadTenant(ctx, tenantId);
  await updateTenant(ctx.db, tenantId, input);
  await invalidateTenantCache(ctx, tenant.slug);
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    action: "platform.tenant.update",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { fields: Object.keys(input), status: input.status ?? null },
    ip: actor.ip,
  });
  return getPlatformTenant(ctx, tenantId);
}

export async function updatePlatformTenantSettings(ctx: AppContext, actor: PlatformActor, tenantId: string, input: TenantSettingsUpdate): Promise<TenantSettingsDto> {
  const { tenant } = await loadTenant(ctx, tenantId);
  const current = (await findSettings(ctx.db, tenantId))!;
  const next = { minBatchYear: input.minBatchYear ?? current.minBatchYear, maxBatchYear: input.maxBatchYear ?? current.maxBatchYear };
  if (next.minBatchYear > next.maxBatchYear) throw AppError.badRequest("minBatchYear must be <= maxBatchYear");
  const row = (await updateSettings(ctx.db, tenantId, { ...settingsColumns(input, current.features), updatedByUserId: actor.userId }))!;
  await invalidateTenantCache(ctx, tenant.slug);
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    action: "platform.tenant.settings.update",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { changes: input },
    ip: actor.ip,
  });
  return toTenantSettingsDto(row);
}

export async function listPlatformTenantAdmins(ctx: AppContext, tenantId: string): Promise<AdminMemberDto[]> {
  await loadTenant(ctx, tenantId);
  return adminsOf(ctx.db, tenantId);
}

export async function assignTenantAdmin(ctx: AppContext, actor: PlatformActor, tenantId: string, input: AssignAdminInput): Promise<AdminMemberDto> {
  const { tenant, settings } = await loadTenant(ctx, tenantId);
  const { membership, created } = await ensureAdminMembership(ctx.db, tenant, input, actor.userId, Math.min(settings.maxBatchYear, new Date().getFullYear()));
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    action: "platform.tenant.admin.assign",
    targetType: "membership",
    targetId: membership.id,
    metadata: { created },
    ip: actor.ip,
  });
  const { user } = (await findMembershipWithUser(ctx.db, tenantId, membership.id))!;
  return toAdminMemberDto(membership, user);
}

export async function removeTenantAdmin(ctx: AppContext, actor: PlatformActor, tenantId: string, membershipId: string): Promise<void> {
  await loadTenant(ctx, tenantId);
  const found = await findMembershipWithUser(ctx.db, tenantId, membershipId);
  if (!found) throw AppError.notFound("Member not found");
  if (found.membership.role !== "TENANT_ADMIN") return;
  await updateMembership(ctx.db, tenantId, membershipId, { role: "MEMBER" });
  await recordAudit(ctx, {
    tenantId,
    actorUserId: actor.userId,
    action: "platform.tenant.admin.remove",
    targetType: "membership",
    targetId: membershipId,
    ip: actor.ip,
  });
}

export async function listPlatformUsers(ctx: AppContext, query: PlatformUsersQuery): Promise<Page<PlatformUserDto>> {
  const { rows, total } = await searchUsers(ctx.db, query);
  const data: PlatformUserDto[] = [];
  for (const u of rows) data.push(toPlatformUserDto(u, await listMembershipsForUser(ctx.db, u.id)));
  return buildPage(data, query.page, query.pageSize, total);
}

export async function setPlatformAdmin(ctx: AppContext, actor: PlatformActor, userId: string, enabled: boolean): Promise<PlatformUserDto> {
  if (userId === actor.userId) throw AppError.forbidden("You cannot change your own platform admin flag");
  const user = await findUserById(ctx.db, userId);
  if (!user) throw AppError.notFound("User not found");
  const updated = (await updateUser(ctx.db, userId, { isPlatformAdmin: enabled }))!;
  await recordAudit(ctx, {
    actorUserId: actor.userId,
    action: enabled ? "platform.admin.grant" : "platform.admin.revoke",
    targetType: "user",
    targetId: userId,
    ip: actor.ip,
  });
  return toPlatformUserDto(updated, await listMembershipsForUser(ctx.db, userId));
}

/** Convenience used by tests/seeds: direct role flip without audit. */
export async function _setMembershipRole(db: DbClient, membershipId: string, role: MembershipRow["role"]): Promise<void> {
  await db.update(memberships).set({ role }).where(eq(memberships.id, membershipId));
}

export async function _touchUser(db: DbClient, userId: string): Promise<void> {
  await db.update(users).set({ updatedAt: new Date() }).where(eq(users.id, userId));
}
