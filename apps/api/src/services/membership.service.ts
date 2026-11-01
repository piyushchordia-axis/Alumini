import type { AdminMemberDto, AdminMembersQuery, MembershipDto, MembershipProfileInput, MembershipProfileUpdate, MembershipRole } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toAdminMemberDto, toMembershipDto } from "../dto/membership.dto";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import {
  approveAllPending as approveAllPendingRepo,
  findMembership,
  findMembershipWithUser,
  insertMembership,
  listMembersForAdmin,
  updateMembership,
} from "../repositories/memberships.repo";
import { updateUser } from "../repositories/users.repo";
import { runInTransaction } from "../lib/transaction";
import { answersFor, answersForOne, saveAnswers } from "./profileFields.service";
import type { AuthContext, MembershipRow, TenantContext } from "../types/request";
import { initialMembershipStatus, transitionMembership, type MembershipAction } from "./approval";
import { recordAudit } from "./audit.service";
import { notify, notifyTenantAdmins } from "./notifications/notification.service";

interface Actor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

function profileColumns(input: MembershipProfileInput | MembershipProfileUpdate) {
  const out: Partial<MembershipRow> = {};
  if (input.fullName !== undefined) out.fullName = input.fullName;
  if (input.batchYear !== undefined) out.batchYear = input.batchYear;
  if (input.dateOfBirth !== undefined) out.dateOfBirth = input.dateOfBirth;
  if (input.professionType !== undefined) out.professionType = input.professionType;
  if (input.companyName !== undefined) out.companyName = input.companyName;
  if (input.designation !== undefined) out.designation = input.designation;
  if (input.city !== undefined) out.city = input.city;
  if (input.country !== undefined) out.country = input.country;
  if (input.maritalStatus !== undefined) out.maritalStatus = input.maritalStatus;
  if (input.kidsCount !== undefined) out.kidsCount = input.kidsCount;
  if (input.bio !== undefined) out.bio = input.bio;
  if (input.linkedinUrl !== undefined) out.linkedinUrl = input.linkedinUrl;
  if (input.interests !== undefined) out.interests = input.interests;
  if (input.avatarUrl !== undefined) out.avatarUrl = input.avatarUrl;
  if (input.isPhoneVisible !== undefined) out.isPhoneVisible = input.isPhoneVisible;
  return out;
}

function assertBatchYear(tenantCtx: TenantContext, batchYear: number | undefined) {
  if (batchYear === undefined) return;
  const { minBatchYear, maxBatchYear } = tenantCtx.settings;
  if (batchYear < minBatchYear || batchYear > maxBatchYear) {
    throw AppError.badRequest(`Batch year must be between ${minBatchYear} and ${maxBatchYear}`, [
      { path: "batchYear", message: `Must be between ${minBatchYear} and ${maxBatchYear}` },
    ]);
  }
}

export async function registerMembership(ctx: AppContext, tenantCtx: TenantContext, actor: Actor, input: MembershipProfileInput): Promise<MembershipDto> {
  const { tenant, settings } = tenantCtx;
  if (!settings.allowSelfRegistration && !actor.isPlatformAdmin) {
    throw AppError.forbidden("This institution is not accepting new registrations", "REGISTRATION_CLOSED");
  }
  assertBatchYear(tenantCtx, input.batchYear);

  const status = initialMembershipStatus(settings.memberApprovalMode);
  const row = await runInTransaction(ctx, async (tx) => {
    const existing = await findMembership(tx, tenant.id, actor.userId);
    let row: MembershipRow;
    let action: "membership.create" | "membership.reapply";

    if (existing) {
      if (existing.status !== "REJECTED") {
        const msg =
          existing.status === "PENDING"
            ? "Your membership request is already awaiting approval"
            : existing.status === "SUSPENDED"
              ? "Your membership is suspended"
              : "You are already a member of this institution";
        throw AppError.conflict(msg);
      }
      const next = transitionMembership(existing.status, "reapply", settings.memberApprovalMode);
      row = (await updateMembership(tx, tenant.id, existing.id, {
        ...profileColumns(input),
        status: next,
        statusReason: null,
        statusChangedAt: new Date(),
        statusChangedByUserId: null,
      }))!;
      action = "membership.reapply";
    } else {
      row = await insertMembership(tx, {
        tenantId: tenant.id,
        userId: actor.userId,
        status,
        role: "MEMBER",
        fullName: input.fullName,
        batchYear: input.batchYear,
        professionType: input.professionType,
        ...profileColumns(input),
        statusChangedAt: status === "APPROVED" ? new Date() : null,
      });
      action = "membership.create";
    }

    await saveAnswers(ctx, tx, tenant.id, row.id, input.fields, "register");
    await updateUser(tx, actor.userId, { displayName: input.fullName });
    await recordAudit(
      ctx,
      {
        tenantId: tenant.id,
        actorUserId: actor.userId,
        actorMembershipId: row.id,
        action,
        targetType: "membership",
        targetId: row.id,
        metadata: { status: row.status },
        ip: actor.ip,
      },
      tx,
    );

    if (row.status === "PENDING") {
      await notifyTenantAdmins(
        ctx,
        {
          tenantId: tenant.id,
          type: "NEW_MEMBER_PENDING",
          title: "New member awaiting approval",
          body: `${row.fullName} (batch of ${row.batchYear}) has requested to join.`,
          data: { membershipId: row.id },
        },
        tx,
      );
    }
    return row;
  });
  return toMembershipDto(row, await answersForOne(ctx, tenant.id, row.id, "self"));
}

/** The caller's own membership with their answers. */
export async function getMyMembership(ctx: AppContext, membership: MembershipRow): Promise<MembershipDto> {
  return toMembershipDto(membership, await answersForOne(ctx, membership.tenantId, membership.id, "self"));
}

export async function updateMyProfile(
  ctx: AppContext,
  tenantCtx: TenantContext,
  membership: MembershipRow,
  input: MembershipProfileUpdate,
): Promise<MembershipDto> {
  assertBatchYear(tenantCtx, input.batchYear);
  const row = await runInTransaction(ctx, async (tx) => {
    const updated = await updateMembership(tx, tenantCtx.tenant.id, membership.id, profileColumns(input));
    if (!updated) throw AppError.notFound("Membership not found");
    if (input.fields) await saveAnswers(ctx, tx, tenantCtx.tenant.id, membership.id, input.fields, "member");
    if (input.fullName) await updateUser(tx, membership.userId, { displayName: input.fullName });
    return updated;
  });
  return toMembershipDto(row, await answersForOne(ctx, tenantCtx.tenant.id, row.id, "self"));
}

async function loadTarget(ctx: AppContext, tenantId: string, membershipId: string) {
  const target = await findMembershipWithUser(ctx.db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  return target;
}

const MEMBER_NOTIFICATIONS: Partial<
  Record<
    MembershipAction,
    {
      type: "MEMBERSHIP_APPROVED" | "MEMBERSHIP_REJECTED" | "MEMBERSHIP_SUSPENDED" | "MEMBERSHIP_REINSTATED";
      title: string;
      body: (tenant: string, reason?: string | null) => string;
    }
  >
> = {
  approve: { type: "MEMBERSHIP_APPROVED", title: "You're in!", body: (t) => `Your membership of ${t} has been approved.` },
  reinstate: { type: "MEMBERSHIP_REINSTATED", title: "Membership reinstated", body: (t) => `Your membership of ${t} is active again.` },
  reject: {
    type: "MEMBERSHIP_REJECTED",
    title: "Membership not approved",
    body: (t, r) => `Your request to join ${t} was not approved.${r ? ` Reason: ${r}` : ""}`,
  },
  suspend: {
    type: "MEMBERSHIP_SUSPENDED",
    title: "Membership suspended",
    body: (t, r) => `Your membership of ${t} has been suspended.${r ? ` Reason: ${r}` : ""}`,
  },
};

export async function adminTransition(
  ctx: AppContext,
  tenantCtx: TenantContext,
  actor: Actor,
  membershipId: string,
  action: Exclude<MembershipAction, "reapply">,
  reason?: string,
): Promise<AdminMemberDto> {
  const { tenant } = tenantCtx;
  const { membership: target, user } = await loadTarget(ctx, tenant.id, membershipId);
  if (target.userId === actor.userId) throw AppError.forbidden("You cannot change your own membership");
  const next = transitionMembership(target.status, action);
  const row = (await updateMembership(ctx.db, tenant.id, target.id, {
    status: next,
    statusReason: reason ?? null,
    statusChangedAt: new Date(),
    statusChangedByUserId: actor.userId,
  }))!;
  await recordAudit(ctx, {
    tenantId: tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: `membership.${action}`,
    targetType: "membership",
    targetId: target.id,
    metadata: { from: target.status, to: next, reason: reason ?? null },
    ip: actor.ip,
  });
  const n = MEMBER_NOTIFICATIONS[action];
  if (n) {
    await notify(ctx, {
      tenantId: tenant.id,
      recipientMembershipIds: [target.id],
      type: n.type,
      title: n.title,
      body: n.body(tenant.name, reason),
      data: { membershipId: target.id, status: next },
    });
  }
  return toAdminMemberDto(row, user, await answersForOne(ctx, tenant.id, row.id, "admin"));
}

export async function approveAllPending(ctx: AppContext, tenantCtx: TenantContext, actor: Actor): Promise<{ approved: number }> {
  const rows = await approveAllPendingRepo(ctx.db, tenantCtx.tenant.id, actor.userId);
  if (rows.length === 0) return { approved: 0 };
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "membership.approve_all",
    metadata: { count: rows.length, membershipIds: rows.map((r) => r.id) },
    ip: actor.ip,
  });
  await notify(ctx, {
    tenantId: tenantCtx.tenant.id,
    recipientMembershipIds: rows.map((r) => r.id),
    type: "MEMBERSHIP_APPROVED",
    title: "You're in!",
    body: `Your membership of ${tenantCtx.tenant.name} has been approved.`,
  });
  return { approved: rows.length };
}

export async function changeRole(ctx: AppContext, tenantCtx: TenantContext, actor: Actor, membershipId: string, role: MembershipRole): Promise<AdminMemberDto> {
  const { tenant } = tenantCtx;
  const { membership: target, user } = await loadTarget(ctx, tenant.id, membershipId);
  if (target.userId === actor.userId) throw AppError.forbidden("You cannot change your own role");
  if (target.status !== "APPROVED") throw AppError.invalidTransition("Only approved members can be given a role");
  if (target.role === role) return toAdminMemberDto(target, user, await answersForOne(ctx, tenant.id, target.id, "admin"));
  const row = (await updateMembership(ctx.db, tenant.id, target.id, { role }))!;
  await recordAudit(ctx, {
    tenantId: tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "membership.role_change",
    targetType: "membership",
    targetId: target.id,
    metadata: { from: target.role, to: role },
    ip: actor.ip,
  });
  await notify(ctx, {
    tenantId: tenant.id,
    recipientMembershipIds: [target.id],
    type: "SYSTEM",
    title: role === "TENANT_ADMIN" ? "You are now an administrator" : "Administrator access removed",
    body:
      role === "TENANT_ADMIN"
        ? `You can now approve members and moderate content for ${tenant.name}.`
        : `You no longer have administrator access for ${tenant.name}.`,
  });
  return toAdminMemberDto(row, user, await answersForOne(ctx, tenant.id, row.id, "admin"));
}

export async function adminUpdateProfile(
  ctx: AppContext,
  tenantCtx: TenantContext,
  actor: Actor,
  membershipId: string,
  input: MembershipProfileUpdate,
): Promise<AdminMemberDto> {
  const { tenant } = tenantCtx;
  const { user } = await loadTarget(ctx, tenant.id, membershipId);
  assertBatchYear(tenantCtx, input.batchYear);
  const row = await runInTransaction(ctx, async (tx) => {
    const updated = (await updateMembership(tx, tenant.id, membershipId, profileColumns(input)))!;
    if (input.fields) await saveAnswers(ctx, tx, tenant.id, membershipId, input.fields, "admin");
    return updated;
  });
  await recordAudit(ctx, {
    tenantId: tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membershipId ?? null,
    action: "membership.admin_profile_update",
    targetType: "membership",
    targetId: membershipId,
    metadata: { fields: Object.keys(input) },
    ip: actor.ip,
  });
  return toAdminMemberDto(row, user, await answersForOne(ctx, tenant.id, row.id, "admin"));
}

export async function listMembers(ctx: AppContext, tenantId: string, query: AdminMembersQuery): Promise<Page<AdminMemberDto>> {
  const { rows, total } = await listMembersForAdmin(ctx.db, tenantId, query);
  const answers = await answersFor(
    ctx,
    tenantId,
    rows.map((r) => r.membership.id),
    "admin",
  );
  return buildPage(
    rows.map((r) => toAdminMemberDto(r.membership, r.user, answers.get(r.membership.id))),
    query.page,
    query.pageSize,
    total,
  );
}

export async function getMemberForAdmin(ctx: AppContext, tenantId: string, membershipId: string): Promise<AdminMemberDto> {
  const { membership, user } = await loadTarget(ctx, tenantId, membershipId);
  return toAdminMemberDto(membership, user, await answersForOne(ctx, tenantId, membershipId, "admin"));
}
