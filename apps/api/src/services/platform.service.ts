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
import { defaultFeaturesFor, retypeToSchool, wallPartsInZone } from "@illuminize/shared";
import { eq } from "drizzle-orm";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { memberships, users } from "../db/schema";
import { toAdminMemberDto } from "../dto/membership.dto";
import { toBillingPlanDto } from "../dto/platform.dto";
import { toPlatformTenantRowDto, toPlatformUserDto, toTenantCountsDto } from "../dto/platform.dto";
import { toTenantPublicDto, toTenantSettingsDto } from "../dto/tenant.dto";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { buildPage, type Page } from "../lib/pagination";
import { normalizePhone } from "../lib/phone";
import { findPlanEffectiveOn } from "../repositories/billing.repo";
import {
  clearDegreesAt,
  findMembership,
  findMembershipById,
  findMembershipWithUser,
  insertMembership,
  listMembershipsForUser,
  listTenantAdmins,
  lockMembership,
  updateMembership,
} from "../repositories/memberships.repo";
import { keys } from "../redis/keys";
import {
  findSettings,
  findTenantById,
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
import type { AuthContext, MembershipRow, TenantRow, TenantSettingsRow } from "../types/request";
import { recordAudit, recordAuditStrict } from "./audit.service";
import { heldSuspensionColumns, restoreHeldSanctions, takeHeldSanctions } from "./deletedAccounts.service";
import { assertMemberYears } from "./membership.service";
import { featuresToStore, invalidateTenantCache } from "./tenant.service";

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
    settings: toTenantSettingsDto(settings, tenant.type),
    counts: toTenantCountsDto(counts),
    currentPlan: plan ? toBillingPlanDto(plan) : null,
    admins,
  };
}

/** Every settings column except features, which depend on the tenant type and what is stored. */
function settingsColumns(input: TenantSettingsUpdate | undefined) {
  if (!input) return {};
  return {
    ...(input.memberApprovalMode !== undefined ? { memberApprovalMode: input.memberApprovalMode } : {}),
    ...(input.contentModerationMode !== undefined ? { contentModerationMode: input.contentModerationMode } : {}),
    ...(input.allowSelfRegistration !== undefined ? { allowSelfRegistration: input.allowSelfRegistration } : {}),
    ...(input.minBatchYear !== undefined ? { minBatchYear: input.minBatchYear } : {}),
    ...(input.maxBatchYear !== undefined ? { maxBatchYear: input.maxBatchYear } : {}),
    ...(input.inviteAutoApprove !== undefined ? { inviteAutoApprove: input.inviteAutoApprove } : {}),
  };
}

type BatchRange = Pick<TenantSettingsRow, "minBatchYear" | "maxBatchYear">;

/**
 * The years of an admin given none. At a community, a member since this year who still is. Elsewhere, last year for both,
 * within what the institution allows: not this year, because in a school this year's batch with no date of birth counts as
 * a current pupil, which would shut an adult admin out of private contact.
 */
function fallbackAdminYears(tenant: Pick<TenantRow, "type" | "timezone">, settings: BatchRange): { startYear: number; batchYear: number | null } {
  const thisYear = wallPartsInZone(new Date(), tenant.timezone).year;
  // No later than the server's own year, by which the profile's rules cap a start: around New Year, India's can be ahead,
  // and a start past it would refuse every save of the admin's profile.
  if (tenant.type === "OTHER") return { startYear: Math.min(thisYear, new Date().getFullYear()), batchYear: null };
  const batchYear = Math.max(settings.minBatchYear, Math.min(settings.maxBatchYear, thisYear - 1));
  return { startYear: Math.min(thisYear - 1, batchYear), batchYear };
}

/**
 * A new admin's years: the fallback when none are given, else the ones given, checked as a member's are. So a year
 * given alone needs the other where a member's form would, and the problem is reported on the blank one: a start alone
 * is taken only at a community, an end alone never. Neither is made up from the other.
 */
function adminYears(tenant: Pick<TenantRow, "type" | "timezone">, settings: BatchRange, input: Pick<AssignAdminInput, "startYear" | "batchYear">, errorPrefix: string) {
  const { startYear = null, batchYear = null } = input;
  if (startYear === null && batchYear === null) return fallbackAdminYears(tenant, settings);
  assertMemberYears(tenant, settings, { startYear, batchYear }, errorPrefix);
  // Refused above when blank: a start is always required.
  return { startYear: startYear!, batchYear };
}

const SUSPENDED_ADMIN = "This member is suspended. Reinstate them first.";

interface EnsuredAdmin {
  membership: MembershipRow;
  created: boolean;
  from: MembershipRow["status"] | null;
  /** Inserted with a suspension held from a deleted account, so not an admin. */
  suspended: boolean;
}

/**
 * Makes someone an admin here, a new member or an existing one. Never lifts a suspension: that's a reinstatement, which the
 * institution's admins record with a reason, and the member's row is held from this check to the change so one can't land
 * in between. A new membership takes back what the number held here before an account of theirs was deleted: blocks, and
 * a suspension, which it's inserted with as a plain member (`suspended`), for the caller to refuse once that's committed.
 * Runs in the caller's transaction, which audits it.
 */
async function ensureAdminMembership(
  ctx: AppContext,
  db: DbClient,
  tenant: TenantRow,
  input: AssignAdminInput,
  actor: PlatformActor,
  settings: BatchRange,
  errorPrefix = "",
): Promise<EnsuredAdmin> {
  const { e164, region } = normalizePhone(input.phone);
  const user = await findOrCreateUserByPhone(db, e164, region);
  const found = await findMembership(db, tenant.id, user.id);
  if (found) await lockMembership(db, tenant.id, found.id);
  const existing = found && (await findMembershipById(db, tenant.id, found.id));
  if (existing?.status === "SUSPENDED") throw AppError.conflict(SUSPENDED_ADMIN);
  let result: EnsuredAdmin;
  if (existing) {
    const membership = (await updateMembership(db, tenant.id, existing.id, {
      role: "TENANT_ADMIN",
      status: "APPROVED",
      statusReason: null,
      statusChangedAt: existing.status === "APPROVED" ? existing.statusChangedAt : new Date(),
      statusChangedByUserId: existing.status === "APPROVED" ? existing.statusChangedByUserId : actor.userId,
    }))!;
    result = { membership, created: false, from: existing.status, suspended: false };
  } else {
    const held = await takeHeldSanctions(ctx, db, tenant.id, e164);
    const membership = await insertMembership(db, {
      tenantId: tenant.id,
      userId: user.id,
      ...(held.suspendedAt ? { role: "MEMBER", ...heldSuspensionColumns() } : { role: "TENANT_ADMIN", status: "APPROVED", statusChangedAt: new Date(), statusChangedByUserId: actor.userId }),
      fullName: input.fullName,
      ...adminYears(tenant, settings, input, errorPrefix),
      professionType: "OTHER",
      city: tenant.city,
      country: tenant.country,
    });
    await restoreHeldSanctions(db, membership, held, { actorUserId: actor.userId, actorMembershipId: null, ip: actor.ip });
    result = { membership, created: true, from: null, suspended: !!held.suspendedAt };
  }
  // The user's row after the membership's, as registering and editing a profile take them: the other way round, assigning
  // someone as they register could deadlock.
  if (!user.displayName) await updateUser(db, user.id, { displayName: input.fullName });
  return result;
}

export async function createPlatformTenant(ctx: AppContext, actor: PlatformActor, input: PlatformTenantCreateInput): Promise<PlatformTenantDto> {
  if (await findTenantBySlug(ctx.db, input.slug)) throw AppError.conflict("An institution with this slug already exists");
  const tenantId = await runInTransaction(ctx, async (tx) => {
    const tenant = await insertTenant(tx, {
      slug: input.slug,
      name: input.name,
      shortName: input.shortName ?? null,
      type: input.type,
      city: input.city ?? null,
      country: input.country ?? null,
      ...(input.timezone ? { timezone: input.timezone } : {}),
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
      features: featuresToStore(tenant.type, defaultFeaturesFor(tenant.type), input.settings?.features ?? {}),
      updatedByUserId: actor.userId,
    });
    if (input.initialAdmin) {
      const ensured = await ensureAdminMembership(ctx, tx, tenant, input.initialAdmin, actor, settings, "initialAdmin.");
      // A new institution holds nothing, so no suspension can come back with the number; refused all the same if one did.
      if (ensured.suspended) throw AppError.conflict(SUSPENDED_ADMIN);
    }
    await recordAuditStrict(tx, {
      tenantId: tenant.id,
      actorUserId: actor.userId,
      action: "platform.tenant.create",
      targetType: "tenant",
      targetId: tenant.id,
      metadata: { slug: tenant.slug, initialAdmin: input.initialAdmin ? normalizePhone(input.initialAdmin.phone).e164 : null },
      ip: actor.ip,
    });
    return tenant.id;
  });
  await invalidateTenantCache(ctx, input.slug);
  return getPlatformTenant(ctx, tenantId);
}

export async function updatePlatformTenant(ctx: AppContext, actor: PlatformActor, tenantId: string, input: PlatformTenantUpdateInput): Promise<PlatformTenantDto> {
  const tenant = await runInTransaction(ctx, async (tx) => {
    // Takes the settings lock before reading the type or features, so a features save or another retype can't overlap this one.
    const settings = await findSettings(tx, tenantId, true);
    const current = await findTenantById(tx, tenantId);
    if (!settings || !current) throw AppError.notFound("Institution not found", "TENANT_NOT_FOUND");
    const forced = input.type === "SCHOOL" && current.type !== "SCHOOL" ? retypeToSchool(current.type, settings.features) : null;
    await updateTenant(tx, tenantId, input);
    if (forced?.forcedOff.length) await updateSettings(tx, tenantId, { features: forced.features, updatedByUserId: actor.userId });
    // A school doesn't ask for a degree or field of study, so its members couldn't see or remove the ones they gave.
    const clearedDegrees = forced ? await clearDegreesAt(tx, tenantId) : 0;
    await recordAuditStrict(tx, {
      tenantId,
      actorUserId: actor.userId,
      action: "platform.tenant.update",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { fields: Object.keys(input), status: input.status ?? null, ...(forced ? { forcedOff: forced.forcedOff, clearedDegrees } : {}) },
      ip: actor.ip,
    });
    return { ...current, retypedToSchool: !!forced };
  });
  await invalidateTenantCache(ctx, tenant.slug);
  // The directory's field-of-study choices came from the degrees just cleared.
  if (tenant.retypedToSchool) await ctx.redis.del(keys.cacheDirectoryFilters(tenantId));
  return getPlatformTenant(ctx, tenantId);
}

export async function updatePlatformTenantSettings(ctx: AppContext, actor: PlatformActor, tenantId: string, input: TenantSettingsUpdate): Promise<TenantSettingsDto> {
  const { tenant } = await loadTenant(ctx, tenantId);
  // Locked from read to write, for the same reason as updateTenantSettings.
  const row = await runInTransaction(ctx, async (tx) => {
    const current = (await findSettings(tx, tenantId, true))!;
    const next = { minBatchYear: input.minBatchYear ?? current.minBatchYear, maxBatchYear: input.maxBatchYear ?? current.maxBatchYear };
    if (next.minBatchYear > next.maxBatchYear) throw AppError.badRequest("minBatchYear must be <= maxBatchYear");
    return (await updateSettings(tx, tenantId, {
      ...settingsColumns(input),
      ...(input.features ? { features: featuresToStore(tenant.type, current.features, input.features) } : {}),
      updatedByUserId: actor.userId,
    }))!;
  });
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
  return toTenantSettingsDto(row, tenant.type);
}

export async function listPlatformTenantAdmins(ctx: AppContext, tenantId: string): Promise<AdminMemberDto[]> {
  await loadTenant(ctx, tenantId);
  return adminsOf(ctx.db, tenantId);
}

/** Who is an admin decides who reaches an escalated chat report, so each change to it is audited in its own transaction. */
export async function assignTenantAdmin(ctx: AppContext, actor: PlatformActor, tenantId: string, input: AssignAdminInput): Promise<AdminMemberDto> {
  const { tenant, settings } = await loadTenant(ctx, tenantId);
  const membership = await runInTransaction(ctx, async (tx) => {
    const { membership, created, from, suspended } = await ensureAdminMembership(ctx, tx, tenant, input, actor, settings);
    // Their suspension came back with their number: kept, so the institution sees it and can lift it, but not made an admin.
    if (suspended) return null;
    await recordAuditStrict(tx, {
      tenantId,
      actorUserId: actor.userId,
      action: "platform.tenant.admin.assign",
      targetType: "membership",
      targetId: membership.id,
      metadata: { created, from },
      ip: actor.ip,
    });
    return membership;
  });
  if (!membership) throw AppError.conflict(SUSPENDED_ADMIN);
  const { user } = (await findMembershipWithUser(ctx.db, tenantId, membership.id))!;
  return toAdminMemberDto(membership, user);
}

export async function removeTenantAdmin(ctx: AppContext, actor: PlatformActor, tenantId: string, membershipId: string): Promise<void> {
  await loadTenant(ctx, tenantId);
  await runInTransaction(ctx, async (tx) => {
    const found = await findMembershipWithUser(tx, tenantId, membershipId);
    if (!found) throw AppError.notFound("Member not found");
    if (found.membership.role !== "TENANT_ADMIN") return;
    await updateMembership(tx, tenantId, membershipId, { role: "MEMBER" });
    await recordAuditStrict(tx, {
      tenantId,
      actorUserId: actor.userId,
      action: "platform.tenant.admin.remove",
      targetType: "membership",
      targetId: membershipId,
      ip: actor.ip,
    });
  });
}

export async function listPlatformUsers(ctx: AppContext, query: PlatformUsersQuery): Promise<Page<PlatformUserDto>> {
  const { rows, total } = await searchUsers(ctx.db, query);
  const data: PlatformUserDto[] = [];
  for (const u of rows) data.push(toPlatformUserDto(u, await listMembershipsForUser(ctx.db, u.id)));
  return buildPage(data, query.page, query.pageSize, total);
}

/** Staff reach escalated chat reports, and staff holding an admin role don't count as one, so this is audited as the roster is. */
export async function setPlatformAdmin(ctx: AppContext, actor: PlatformActor, userId: string, enabled: boolean): Promise<PlatformUserDto> {
  if (userId === actor.userId) throw AppError.forbidden("You cannot change your own platform admin flag");
  const updated = await runInTransaction(ctx, async (tx) => {
    if (!(await findUserById(tx, userId))) throw AppError.notFound("User not found");
    // The institutions whose admins this changes, since staff don't count as one there; chat reports read it (rosterChangedBy).
    const adminOf = (await listMembershipsForUser(tx, userId)).filter(({ membership }) => membership.role === "TENANT_ADMIN").map(({ membership }) => membership.tenantId);
    const row = (await updateUser(tx, userId, { isPlatformAdmin: enabled }))!;
    await recordAuditStrict(tx, {
      actorUserId: actor.userId,
      action: enabled ? "platform.admin.grant" : "platform.admin.revoke",
      targetType: "user",
      targetId: userId,
      metadata: { adminOf },
      ip: actor.ip,
    });
    return row;
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
