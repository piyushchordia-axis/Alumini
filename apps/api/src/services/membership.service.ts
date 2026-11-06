import {
  isCurrentPupil,
  memberYearsIssues,
  memberYearsLabel,
  sortEducation,
  sortExperiences,
  type AdminMemberDto,
  type AdminMembersQuery,
  type MemberAppearance,
  type MemberAppearanceUpdate,
  type MembershipDto,
  type MembershipProfileInput,
  type MembershipProfileUpdate,
  type MembershipRole,
  type MembershipStatus,
  type MemberYears,
  type PortableProfileDto,
} from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient, Tx } from "../db/client";
import { toAdminMemberDto, toMembershipDto, toPortableProfileDto } from "../dto/membership.dto";
import { AppError, isAppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import {
  approveAllPending as approveAllPendingRepo,
  findLatestMembershipElsewhere,
  findMembership,
  findMembershipById,
  findMembershipWithUser,
  insertMembership,
  listMembersForAdmin,
  lockMembership,
  lockMembershipAppearance,
  setMembershipAppearance,
  setProfileNudgeDismissedAt,
  updateMembership,
} from "../repositories/memberships.repo";
import { findUserById, updateUser } from "../repositories/users.repo";
import { hasOpenReportAbout, lockReportSubject } from "../repositories/chatReports.repo";
import { claimInvitation, findOpenInvitationByPhone } from "../repositories/invitations.repo";
import { runInTransaction } from "../lib/transaction";
import { answersFor, answersForOne, applyInvitationAnswers, saveAnswers } from "./profileFields.service";
import type { AuthContext, MembershipRow, TenantContext, TenantRow, TenantSettingsRow } from "../types/request";
import { assertAdminTransition, initialMembershipStatus, transitionMembership, type MembershipAction } from "./approval";
import { recordAudit, recordAuditStrict } from "./audit.service";
import { handOverGroupsOf } from "./chat/groups.service";
import { heldSuspensionColumns, restoreHeldSanctions, takeHeldSanctions } from "./deletedAccounts.service";
import { markAdminNoticesHandled, notify, notifyTenantAdmins } from "./notifications/notification.service";
import { applyAvatarChange, applyBackdropPhotoChange } from "./uploads.service";

/** An admin acting on a member, or Illuminize staff. */
export interface Actor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

function profileColumns(input: MembershipProfileInput | MembershipProfileUpdate, tenant: Pick<TenantRow, "type">) {
  const out: Partial<MembershipRow> = {};
  if (input.fullName !== undefined) out.fullName = input.fullName;
  if (input.startYear !== undefined) out.startYear = input.startYear;
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
  if (input.celebrateBirthday !== undefined) out.celebrateBirthday = input.celebrateBirthday;
  if (input.celebrateAnniversary !== undefined) out.celebrateAnniversary = input.celebrateAnniversary;
  if (input.headline !== undefined) out.headline = input.headline;
  if (input.industry !== undefined) out.industry = input.industry;
  if (input.careerStartYear !== undefined) out.careerStartYear = input.careerStartYear;
  if (input.skills !== undefined) out.skills = input.skills;
  // A school doesn't ask and its forms don't show them, so its members hold neither: becoming a school clears them
  // (updatePlatformTenant), and every save there does too, whatever was sent, in case one was written in between.
  if (tenant.type === "SCHOOL") {
    out.degree = null;
    out.fieldOfStudy = null;
  } else {
    if (input.degree !== undefined) out.degree = input.degree;
    if (input.fieldOfStudy !== undefined) out.fieldOfStudy = input.fieldOfStudy;
  }
  if (input.websiteUrl !== undefined) out.websiteUrl = input.websiteUrl;
  if (input.githubUrl !== undefined) out.githubUrl = input.githubUrl;
  if (input.instagramUrl !== undefined) out.instagramUrl = input.instagramUrl;
  if (input.xUrl !== undefined) out.xUrl = input.xUrl;
  if (input.openTo !== undefined) out.openTo = input.openTo;
  if (input.experiences !== undefined) out.experiences = sortExperiences(input.experiences);
  if (input.education !== undefined) out.education = sortEducation(input.education);
  return out;
}

/**
 * A current pupil is open to nothing (hiring, collaborating, investing), whatever was sent or stored, so the directory's
 * Open-to filter can never find one. Checked on the row as saved, inside the transaction that saved it, so a change of
 * batch or date of birth in this edit or an earlier one counts.
 */
async function applyPupilRules(tx: DbClient, tenant: TenantRow, row: MembershipRow): Promise<MembershipRow> {
  if (row.openTo.length === 0 || !isCurrentPupil(tenant, row)) return row;
  return (await updateMembership(tx, tenant.id, row.id, { openTo: [] }))!;
}

/**
 * Refuses years the institution doesn't take (memberYearsIssues), each problem on its own field, under `prefix` where the
 * body nests them ("initialAdmin."). `word` rewords a problem for someone giving another person's years.
 */
export function assertMemberYears(tenant: Pick<TenantRow, "type">, settings: Pick<TenantSettingsRow, "minBatchYear" | "maxBatchYear">, years: MemberYears, prefix = "", word = (issue: string) => issue): void {
  const issues = Object.entries(memberYearsIssues({ type: tenant.type, settings }, years));
  if (issues.length === 0) return;
  throw AppError.badRequest(
    "Check the years you've given",
    issues.map(([path, message]) => ({ path: `${prefix}${path}`, message: word(message) })),
  );
}

/**
 * An edit's years checked with the ones it leaves as stored, read from the row held for the change. An edit that sends
 * no year is never refused for years stored under an earlier rule, such as an admin answering the institution's questions.
 */
async function assertEditedYears(tx: Tx, tenantCtx: TenantContext, membershipId: string, input: MembershipProfileUpdate): Promise<void> {
  if (input.startYear === undefined && input.batchYear === undefined) return;
  await lockMembership(tx, tenantCtx.tenant.id, membershipId);
  const stored = await findMembershipById(tx, tenantCtx.tenant.id, membershipId);
  if (!stored) return;
  assertMemberYears(tenantCtx.tenant, tenantCtx.settings, {
    startYear: input.startYear ?? stored.startYear,
    batchYear: input.batchYear === undefined ? stored.batchYear : input.batchYear,
  });
}

/**
 * Joins (or re-applies to) an institution. An open invitation for the person's OTP-verified phone lets them in even
 * when self-registration is closed, approves them straight away when the institution auto-approves invitees, and is
 * marked accepted in the same transaction. An invitation never lifts a suspension, nor one held from before the account
 * was deleted, which a new membership is inserted with (and so tells no admin of a request).
 */
export async function registerMembership(ctx: AppContext, tenantCtx: TenantContext, actor: Actor, input: MembershipProfileInput): Promise<MembershipDto> {
  const { tenant, settings } = tenantCtx;
  const user = await findUserById(ctx.db, actor.userId);
  const invite = user ? await findOpenInvitationByPhone(ctx.db, tenant.id, user.phoneE164) : undefined;
  if (!settings.allowSelfRegistration && !actor.isPlatformAdmin && !invite) {
    throw AppError.forbidden("This institution is not accepting new registrations", "REGISTRATION_CLOSED");
  }
  // Both years, always: an end left out is a community member who still belongs, on registering again too.
  const years = { startYear: input.startYear, batchYear: input.batchYear ?? null };
  assertMemberYears(tenant, settings, years);

  const approveNow = !!invite && settings.inviteAutoApprove;
  const status = approveNow ? "APPROVED" : initialMembershipStatus(settings.memberApprovalMode);
  const row = await runInTransaction(ctx, async (tx) => {
    // Held from this read to the change, as an admin acting on it holds it, so an approval landing meanwhile is seen, not
    // overwritten. The membership row before the user row, as everywhere.
    const found = await findMembership(tx, tenant.id, actor.userId);
    if (found) await lockMembership(tx, tenant.id, found.id);
    const existing = found && (await findMembershipById(tx, tenant.id, found.id));
    let row: MembershipRow;
    let action: "membership.create" | "membership.reapply";

    if (existing && existing.status !== "REJECTED") {
      const msg =
        existing.status === "PENDING"
          ? "Your membership request is already awaiting approval"
          : existing.status === "SUSPENDED"
            ? "Your membership is suspended"
            : "You are already a member of this institution";
      throw AppError.conflict(msg);
    }
    await applyAvatarChange(ctx, tx, tenant.id, { membershipId: existing?.id ?? null, next: input.avatarUrl, uploaderIds: [actor.userId] });

    if (existing) {
      const next = approveNow ? "APPROVED" : transitionMembership(existing.status, "reapply", settings.memberApprovalMode);
      row = (await updateMembership(tx, tenant.id, existing.id, {
        ...profileColumns(input, tenant),
        ...years,
        status: next,
        statusReason: null,
        statusChangedAt: new Date(),
        statusChangedByUserId: null,
      }))!;
      action = "membership.reapply";
    } else {
      // Their number may have been suspended here, or blocked, before an earlier account of theirs was deleted.
      const held = await takeHeldSanctions(ctx, tx, tenant.id, user?.phoneE164);
      row = await insertMembership(tx, {
        tenantId: tenant.id,
        userId: actor.userId,
        role: "MEMBER",
        fullName: input.fullName,
        professionType: input.professionType,
        ...profileColumns(input, tenant),
        ...years,
        ...(held.suspendedAt ? heldSuspensionColumns() : { status, statusChangedAt: status === "APPROVED" ? new Date() : null }),
      });
      await restoreHeldSanctions(tx, row, held, { actorUserId: actor.userId, actorMembershipId: row.id, ip: actor.ip });
      action = "membership.create";
    }
    row = await applyPupilRules(tx, tenant, row);

    await saveAnswers(ctx, tx, tenant.id, row.id, input.fields, "register");
    const accepted = invite ? await claimInvitation(tx, invite.id, row.id) : undefined;
    if (accepted) await applyInvitationAnswers(ctx, tx, tenant.id, row.id, accepted.fieldValues, Object.keys(input.fields ?? {}));
    await updateUser(tx, actor.userId, { displayName: input.fullName });
    await recordAuditStrict(tx, {
      tenantId: tenant.id,
      actorUserId: actor.userId,
      actorMembershipId: row.id,
      action,
      targetType: "membership",
      targetId: row.id,
      metadata: { status: row.status, ...(accepted ? { invitationId: accepted.id } : {}) },
      ip: actor.ip,
    });

    if (row.status === "PENDING") {
      await notifyTenantAdmins(
        ctx,
        {
          tenantId: tenant.id,
          type: "NEW_MEMBER_PENDING",
          title: "New member awaiting approval",
          body: `${row.fullName} (${memberYearsLabel(row)}) has requested to join.`,
          data: { membershipId: row.id },
        },
        tx,
      );
    }
    return row;
  });
  return toMembershipDto(row, tenant, await answersForOne(ctx, tenant.id, row.id, "self"));
}

/** The caller's own membership with their answers. */
export async function getMyMembership(ctx: AppContext, tenantCtx: TenantContext, membership: MembershipRow): Promise<MembershipDto> {
  return toMembershipDto(membership, tenantCtx.tenant, await answersForOne(ctx, membership.tenantId, membership.id, "self"));
}

export async function updateMyProfile(
  ctx: AppContext,
  tenantCtx: TenantContext,
  membership: MembershipRow,
  input: MembershipProfileUpdate,
): Promise<MembershipDto> {
  const row = await runInTransaction(ctx, async (tx) => {
    await assertEditedYears(tx, tenantCtx, membership.id, input);
    await applyAvatarChange(ctx, tx, tenantCtx.tenant.id, { membershipId: membership.id, next: input.avatarUrl, uploaderIds: [membership.userId] });
    const updated = await updateMembership(tx, tenantCtx.tenant.id, membership.id, profileColumns(input, tenantCtx.tenant));
    if (!updated) throw AppError.notFound("Membership not found");
    if (input.fields) await saveAnswers(ctx, tx, tenantCtx.tenant.id, membership.id, input.fields, "member");
    if (input.fullName) await updateUser(tx, membership.userId, { displayName: input.fullName });
    return applyPupilRules(tx, tenantCtx.tenant, updated);
  });
  return toMembershipDto(row, tenantCtx.tenant, await answersForOne(ctx, tenantCtx.tenant.id, row.id, "self"));
}

/** Puts off the feed's profile-strength card for PROFILE_NUDGE_SNOOZE_DAYS, on every device. */
export async function dismissProfileNudge(ctx: AppContext, tenantCtx: TenantContext, membership: MembershipRow): Promise<MembershipDto> {
  const row = await setProfileNudgeDismissedAt(ctx.db, tenantCtx.tenant.id, membership.id, new Date());
  if (!row) throw AppError.notFound("Membership not found");
  return toMembershipDto(row, tenantCtx.tenant, await answersForOne(ctx, tenantCtx.tenant.id, row.id, "self"));
}

/**
 * Changes the member's background here. Keys the change leaves out stay as stored, unknown ones included. Not audited:
 * like the profile-strength card, it is their own view of the app, which nobody else sees.
 */
export async function updateMyAppearance(ctx: AppContext, tenantCtx: TenantContext, membership: MembershipRow, input: MemberAppearanceUpdate): Promise<MembershipDto> {
  const tenantId = tenantCtx.tenant.id;
  const row = await runInTransaction(ctx, async (tx) => {
    const stored = await lockMembershipAppearance(tx, tenantId, membership.id);
    if (stored === undefined) throw AppError.notFound("Membership not found");
    const next: MemberAppearance = { ...stored };
    if (input.backdrop !== undefined) next.backdrop = input.backdrop;
    if (input.photoUrl !== undefined) next.photoUrl = input.photoUrl;
    if (next.backdrop === "PHOTO" && !next.photoUrl) throw AppError.badRequest("Upload a photo first", [{ path: "photoUrl", message: "Upload a photo first" }]);
    const previous = typeof stored.photoUrl === "string" ? stored.photoUrl : null;
    await applyBackdropPhotoChange(ctx, tx, tenantId, { previous, next: input.photoUrl, uploaderId: membership.userId });
    return setMembershipAppearance(tx, tenantId, membership.id, next);
  });
  if (!row) throw AppError.notFound("Membership not found");
  return toMembershipDto(row, tenantCtx.tenant, await answersForOne(ctx, tenantId, row.id, "self"));
}

/**
 * What "Use details from …" offers someone joining `excludeSlug`: their own details from their most recently updated
 * approved membership of any other active institution (see findLatestMembershipElsewhere and toPortableProfileDto), or
 * null if they have none.
 */
export async function getPortableProfile(ctx: AppContext, userId: string, excludeSlug?: string): Promise<PortableProfileDto | null> {
  const found = await findLatestMembershipElsewhere(ctx.db, userId, excludeSlug);
  return found ? toPortableProfileDto(found.membership, found.tenant) : null;
}

async function loadTarget(db: DbClient, tenantId: string, membershipId: string) {
  const target = await findMembershipWithUser(db, tenantId, membershipId);
  if (!target) throw AppError.notFound("Member not found");
  return target;
}

/**
 * Takes the actor's report-subject lock, exclusive (see lockReportSubject): a report about them filed before it is committed
 * by the time this returns, and one filed after it waits until the change commits. Staff, who aren't held back, take none.
 */
async function lockReportsAboutActor(tx: Tx, tenantId: string, actor: Actor): Promise<void> {
  if (!actor.isPlatformAdmin && actor.membershipId) await lockReportSubject(tx, tenantId, actor.membershipId, "check");
}

/**
 * While a chat report about them is open, a tenant admin can't use what they could get back at the reporter with: suspending
 * anyone, changing a role, restoring a suspended admin who could then close the report, editing a profile, which can
 * publish a phone number or, at a school, turn someone into a current pupil and so cut them off from chat, or taking someone
 * off the Mentors list, which a mentor who reported their request could otherwise be (see mentorship.service). Refuses before
 * looking at who is targeted, so the answer is the same for everyone and doesn't point at the reporter. Illuminize staff
 * aren't restricted, even if a report is about them. Goes inside the transaction of the change it guards, before any other
 * lock, and holds the actor's report-subject lock until it commits, so a report filed meanwhile either stops the change or
 * is filed after it.
 */
export async function assertNoOpenReportAboutActor(tx: Tx, tenantId: string, actor: Actor): Promise<void> {
  if (actor.isPlatformAdmin || !actor.membershipId) return;
  await lockReportsAboutActor(tx, tenantId, actor);
  if (await hasOpenReportAbout(tx, tenantId, actor.membershipId)) throw AppError.forbidden("This needs another admin or Illuminize staff", "NEEDS_ANOTHER_ADMIN");
}

/**
 * Runs a change the rule above guards, and keeps a record if the rule refuses it, so that other admins and staff can see an
 * attempt to get back at someone or to find out when a report opens. The transaction has rolled back by then and nothing
 * changed, so a row that can't be written isn't worth turning the refusal into an error. Says nothing of any report.
 */
export async function recordingRefusal<T>(ctx: AppContext, tenantId: string, actor: Actor, attempted: string, membershipId: string, change: () => Promise<T>): Promise<T> {
  try {
    return await change();
  } catch (err) {
    if (isAppError(err) && err.code === "NEEDS_ANOTHER_ADMIN") {
      await recordAudit(ctx, {
        tenantId,
        actorUserId: actor.userId,
        actorMembershipId: actor.membershipId ?? null,
        action: "membership.action_refused",
        targetType: "membership",
        targetId: membershipId,
        metadata: { attempted },
        ip: actor.ip,
      });
    }
    throw err;
  }
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
  /** The status the admin acted on, if their screen sent it: see assertAdminTransition. */
  expectedStatus?: MembershipStatus,
): Promise<AdminMemberDto> {
  const { tenant } = tenantCtx;
  const { target, user, next, row } = await recordingRefusal(ctx, tenant.id, actor, `membership.${action}`, membershipId, () =>
    runInTransaction(ctx, async (tx) => {
      // Taken whichever check below applies, because the actor's report-subject lock comes before the target's row.
      await lockReportsAboutActor(tx, tenant.id, actor);
      if (action === "suspend") await assertNoOpenReportAboutActor(tx, tenant.id, actor);
      // Then the target's row: a second admin acting on the same member (every admin has the notice) waits here, then
      // sees what the first did.
      await lockMembership(tx, tenant.id, membershipId);
      const { membership: target, user } = await loadTarget(tx, tenant.id, membershipId);
      if (target.userId === actor.userId) throw AppError.forbidden("You cannot change your own membership");
      assertAdminTransition(target.status, action, expectedStatus);
      const next = transitionMembership(target.status, action);
      // The role survives a suspension, so this gives back admin access just as a role change would.
      if (next === "APPROVED" && target.role === "TENANT_ADMIN") await assertNoOpenReportAboutActor(tx, tenant.id, actor);
      const row = (await updateMembership(tx, tenant.id, target.id, {
        status: next,
        statusReason: reason ?? null,
        statusChangedAt: new Date(),
        statusChangedByUserId: actor.userId,
      }))!;
      if (next === "SUSPENDED") await handOverGroupsOf(ctx, tx, tenant.id, target.id);
      await recordAuditStrict(tx, {
        tenantId: tenant.id,
        actorUserId: actor.userId,
        actorMembershipId: actor.membershipId ?? null,
        action: `membership.${action}`,
        targetType: "membership",
        targetId: target.id,
        // The role says whether this changed who is an admin, which chat reports read (rosterChangedBy).
        metadata: { from: target.status, to: next, reason: reason ?? null, role: target.role },
        ip: actor.ip,
      });
      if (action === "approve" || action === "reject") {
        await markAdminNoticesHandled(ctx, tx, { tenantId: tenant.id, tenantSlug: tenant.slug, type: "NEW_MEMBER_PENDING", ids: [target.id] });
      }
      return { target, user, next, row };
    }),
  );
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
  const { tenant } = tenantCtx;
  const rows = await runInTransaction(ctx, async (tx) => {
    const rows = await approveAllPendingRepo(tx, tenant.id, actor.userId);
    if (rows.length === 0) return rows;
    const ids = rows.map((r) => r.id);
    // Admins among them, whom the apps never leave waiting but data can: this changed who is an admin (rosterChangedBy).
    const adminIds = rows.filter((r) => r.role === "TENANT_ADMIN").map((r) => r.id);
    await recordAuditStrict(tx, {
      tenantId: tenant.id,
      actorUserId: actor.userId,
      actorMembershipId: actor.membershipId ?? null,
      action: "membership.approve_all",
      metadata: { count: rows.length, membershipIds: ids, ...(adminIds.length ? { adminIds } : {}) },
      ip: actor.ip,
    });
    await markAdminNoticesHandled(ctx, tx, { tenantId: tenant.id, tenantSlug: tenant.slug, type: "NEW_MEMBER_PENDING", ids });
    return rows;
  });
  if (rows.length === 0) return { approved: 0 };
  await notify(ctx, {
    tenantId: tenant.id,
    recipientMembershipIds: rows.map((r) => r.id),
    type: "MEMBERSHIP_APPROVED",
    title: "You're in!",
    body: `Your membership of ${tenant.name} has been approved.`,
  });
  return { approved: rows.length };
}

export async function changeRole(ctx: AppContext, tenantCtx: TenantContext, actor: Actor, membershipId: string, role: MembershipRole): Promise<AdminMemberDto> {
  const { tenant } = tenantCtx;
  const { target, user, row } = await recordingRefusal(ctx, tenant.id, actor, "membership.role_change", membershipId, () =>
    runInTransaction(ctx, async (tx) => {
      await assertNoOpenReportAboutActor(tx, tenant.id, actor);
      const { membership: target, user } = await loadTarget(tx, tenant.id, membershipId);
      if (target.userId === actor.userId) throw AppError.forbidden("You cannot change your own role");
      if (target.status !== "APPROVED") throw AppError.invalidTransition("Only approved members can be given a role");
      const row = target.role === role ? null : (await updateMembership(tx, tenant.id, target.id, { role }))!;
      if (row) {
        await recordAuditStrict(tx, {
          tenantId: tenant.id,
          actorUserId: actor.userId,
          actorMembershipId: actor.membershipId ?? null,
          action: "membership.role_change",
          targetType: "membership",
          targetId: target.id,
          metadata: { from: target.role, to: role },
          ip: actor.ip,
        });
      }
      return { target, user, row };
    }),
  );
  if (!row) return toAdminMemberDto(target, user, await answersForOne(ctx, tenant.id, target.id, "admin"));
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
  const { user, row } = await recordingRefusal(ctx, tenant.id, actor, "membership.admin_profile_update", membershipId, () =>
    runInTransaction(ctx, async (tx) => {
      await assertNoOpenReportAboutActor(tx, tenant.id, actor);
      const { membership: target, user } = await loadTarget(tx, tenant.id, membershipId);
      await assertEditedYears(tx, tenantCtx, membershipId, input);
      await applyAvatarChange(ctx, tx, tenant.id, { membershipId, next: input.avatarUrl, uploaderIds: [target.userId, actor.userId] });
      const row = await applyPupilRules(tx, tenant, (await updateMembership(tx, tenant.id, membershipId, profileColumns(input, tenant)))!);
      if (input.fields) await saveAnswers(ctx, tx, tenant.id, membershipId, input.fields, "admin");
      return { user, row };
    }),
  );
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
  const { membership, user } = await loadTarget(ctx.db, tenantId, membershipId);
  return toAdminMemberDto(membership, user, await answersForOne(ctx, tenantId, membershipId, "admin"));
}
