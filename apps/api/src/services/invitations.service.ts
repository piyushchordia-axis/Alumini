import {
  INVITE_TTL_DAYS,
  emailAddressSchema,
  isExcelScientific,
  validateProfileFieldValues,
  type InvitationDto,
  type InvitationImportInput,
  type InvitationImportResultDto,
  type InvitationSummaryDto,
  type InvitationsQuery,
  type InvitePublicDto,
  type MessageChannel,
  type MyInvitationDto,
  type ProfileFieldValue,
} from "@illuminize/shared";
import type { CountryCode } from "libphonenumber-js";
import type { AppContext } from "../context";
import { toTenantSummaryDto } from "../dto/tenant.dto";
import type { JobHandler } from "../jobs/JobQueue";
import { AppError } from "../lib/errors";
import { buildPage, type Page } from "../lib/pagination";
import { maskPhone, normalizePhone } from "../lib/phone";
import { opaqueToken } from "../lib/random";
import { runInTransaction } from "../lib/transaction";
import { keys } from "../redis/keys";
import {
  findInvitationById,
  findInvitationByToken,
  findInvitationsByPhones,
  findOpenInvitationByPhone,
  insertInvitation,
  invitationCounts,
  listInvitations as listInvitationRows,
  listPendingInvitationIds,
  markInvitationsSent,
  updateInvitation,
  type InvitationRow,
} from "../repositories/invitations.repo";
import { membershipStatusByPhones } from "../repositories/memberships.repo";
import { findMessagesByContext, type OutboundMessageRow } from "../repositories/messages.repo";
import { findTenantById } from "../repositories/tenants.repo";
import { findUserById } from "../repositories/users.repo";
import type { AuthContext, TenantContext } from "../types/request";
import { recordAudit } from "./audit.service";
import { todayIn } from "./billing.periods";
import { tenantOutboundChannels } from "./billing.service";
import { queueMessages } from "./messages/message.service";
import { messageTemplates } from "./messages/templates";
import { getActiveFields } from "./profileFields.service";

interface AdminActor extends AuthContext {
  membershipId?: string | null;
  ip?: string;
}

/** A sent invitation can be sent again after this long. */
export const INVITE_RESEND_AFTER_HOURS = 24;
const SEND_BATCH = 200;

const isOpen = (r: Pick<InvitationRow, "status" | "expiresAt">, now = new Date()) => (r.status === "PENDING" || r.status === "SENT") && r.expiresAt > now;
const newExpiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
export const inviteLink = (ctx: AppContext, token: string) => (ctx.config.webAppUrl ? `${ctx.config.webAppUrl}/i/${token}` : null);

function toInvitationDto(ctx: AppContext, r: InvitationRow, latest?: OutboundMessageRow): InvitationDto {
  const now = new Date();
  return {
    id: r.id,
    phone: r.phoneE164,
    email: r.email,
    fullName: r.fullName,
    batchYear: r.batchYear,
    status: r.status,
    expired: (r.status === "PENDING" || r.status === "SENT") && r.expiresAt <= now,
    expiresAt: r.expiresAt.toISOString(),
    sendCount: r.sendCount,
    lastSentAt: r.lastSentAt ? r.lastSentAt.toISOString() : null,
    acceptedAt: r.acceptedAt ? r.acceptedAt.toISOString() : null,
    acceptedMembershipId: r.acceptedMembershipId,
    createdAt: r.createdAt.toISOString(),
    link: inviteLink(ctx, r.token),
    delivery: latest ? { status: latest.status, channel: latest.channel, lastError: latest.lastError, at: (latest.sentAt ?? latest.updatedAt).toISOString() } : null,
  };
}

const MEMBER_MESSAGES: Record<string, string> = {
  APPROVED: "Already a member",
  PENDING: "Already applied (awaiting approval)",
  SUSPENDED: "Member is suspended",
};

/**
 * Creates or updates invitations from imported rows. Each row is checked on its own and reported: created, updated
 * (an existing invitation for that phone gets the new details and is reopened if it was revoked, accepted by an
 * account since deleted, or expired), member (already in), or invalid with the reason. Phones without a country code
 * use the institution's country. With `send`, the open invitations are queued for sending.
 */
export async function importInvitations(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, input: InvitationImportInput): Promise<InvitationImportResultDto> {
  const { tenant, settings } = tenantCtx;
  const region = (tenant.country ?? "IN") as CountryCode;
  const fields = await getActiveFields(ctx, tenant.id);
  const offset = input.rowOffset;
  const results: InvitationImportResultDto["results"] = [];
  const valid: Array<{ row: number; phone: string; name: string | null; batchYear: number | null; email: string | null; fieldValues: Record<string, ProfileFieldValue> }> = [];
  const seen = new Set<string>();

  input.rows.forEach((r, i) => {
    const row = offset + i + 1;
    const invalid = (message: string, phone = r.phone) => results.push({ row, phone, status: "invalid", message });
    const rawPhone = (r.phone ?? "").trim();
    if (!rawPhone) return invalid("Phone number missing");
    if (isExcelScientific(rawPhone)) return invalid("The spreadsheet turned this number into scientific notation; format the phone column as text and export again");
    let phone: string;
    try {
      phone = normalizePhone(rawPhone, region).e164;
    } catch {
      return invalid("Not a valid phone number");
    }
    if (seen.has(phone)) return invalid("Same phone number as an earlier row", phone);
    const name = r.name?.trim() || null;
    if (name && name.length > 100) return invalid("Name is longer than 100 characters", phone);
    let batchYear: number | null = null;
    if (r.batchYear !== null && r.batchYear !== undefined && String(r.batchYear).trim() !== "") {
      batchYear = Number(String(r.batchYear).trim());
      if (!Number.isInteger(batchYear) || batchYear < settings.minBatchYear || batchYear > settings.maxBatchYear) return invalid(`Batch must be a year between ${settings.minBatchYear} and ${settings.maxBatchYear}`, phone);
    }
    let email: string | null = null;
    if (r.email?.trim()) {
      const parsed = emailAddressSchema.safeParse(r.email);
      if (!parsed.success) return invalid("Not a valid email address", phone);
      email = parsed.data;
    }
    const check = validateProfileFieldValues(fields, r.fields, { requireAll: false });
    const fieldErrors = Object.entries(check.errors);
    if (fieldErrors.length) {
      const [key, message] = fieldErrors[0]!;
      return invalid(`${fields.find((f) => f.key === key)?.label ?? key}: ${message}`, phone);
    }
    const fieldValues = Object.fromEntries(Object.entries(check.values).filter((e): e is [string, ProfileFieldValue] => e[1] !== null));
    seen.add(phone);
    valid.push({ row, phone, name, batchYear, email, fieldValues });
  });

  const phones = valid.map((v) => v.phone);
  const [memberStatus, existing] = await Promise.all([membershipStatusByPhones(ctx.db, tenant.id, phones), findInvitationsByPhones(ctx.db, tenant.id, phones)]);
  const existingByPhone = new Map(existing.map((e) => [e.phoneE164, e]));
  const openIds: string[] = [];
  await runInTransaction(ctx, async (tx) => {
    for (const v of valid) {
      const status = memberStatus.get(v.phone);
      if (status && status !== "REJECTED") {
        results.push({ row: v.row, phone: v.phone, status: "member", message: MEMBER_MESSAGES[status] });
        continue;
      }
      const prior = existingByPhone.get(v.phone);
      if (prior) {
        const reopen = !isOpen(prior);
        const updated = (await updateInvitation(tx, tenant.id, prior.id, {
          ...(v.name ? { fullName: v.name } : {}),
          ...(v.batchYear ? { batchYear: v.batchYear } : {}),
          ...(v.email ? { email: v.email } : {}),
          fieldValues: { ...prior.fieldValues, ...v.fieldValues },
          ...(reopen ? { status: "PENDING" as const, acceptedAt: null, acceptedMembershipId: null } : {}),
          expiresAt: newExpiry(),
        }))!;
        openIds.push(updated.id);
        results.push({ row: v.row, phone: v.phone, status: "updated", invitationId: updated.id });
      } else {
        const created = await insertInvitation(tx, {
          tenantId: tenant.id,
          phoneE164: v.phone,
          email: v.email,
          fullName: v.name,
          batchYear: v.batchYear,
          fieldValues: v.fieldValues,
          token: opaqueToken(16),
          expiresAt: newExpiry(),
          invitedByUserId: actor.userId,
        });
        openIds.push(created.id);
        results.push({ row: v.row, phone: v.phone, status: "created", invitationId: created.id });
      }
    }
    const counts = { created: results.filter((r) => r.status === "created").length, updated: results.filter((r) => r.status === "updated").length };
    await recordAudit(ctx, { tenantId: tenant.id, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "invitation.import", metadata: { rows: input.rows.length, ...counts }, ip: actor.ip }, tx);
  });

  let queued = 0;
  if (input.send && openIds.length) {
    try {
      queued = (await sendInvitations(ctx, tenantCtx, actor, openIds)).queued;
    } catch (err) {
      // Imported but not sent (no channel in the plan, daily limit): the admin can share links or send later.
      ctx.logger.info({ err, tenantId: tenant.id }, "Imported invitations were not sent");
    }
  }
  results.sort((a, b) => a.row - b.row);
  return {
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    skipped: results.filter((r) => r.status === "member" || r.status === "invalid").length,
    queued,
    results,
  };
}

/** The template's channel order, limited to what the institution's plan allows today. */
async function inviteChannels(ctx: AppContext, tenantId: string): Promise<MessageChannel[]> {
  const allowed = await tenantOutboundChannels(ctx, tenantId);
  return messageTemplates.INVITE.channels.filter((c) => allowed.includes(c));
}

/**
 * Queues invitations for sending: open ones not sent in the last 24 hours, within the institution's daily limit.
 * Needs a channel in the plan (otherwise admins share the links themselves). Returns how many were queued.
 */
export async function sendInvitations(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, ids: string[]): Promise<{ queued: number; skipped: number }> {
  const { tenant } = tenantCtx;
  if (!ctx.config.webAppUrl) throw new AppError(503, "FEATURE_DISABLED", "Invitations can't be sent until the server's WEB_APP_URL is set.");
  if ((await inviteChannels(ctx, tenant.id)).length === 0) {
    throw AppError.conflict("Your plan doesn't include WhatsApp, SMS or email messages. Copy or share the invite links instead.");
  }
  const now = new Date();
  const resendBefore = now.getTime() - INVITE_RESEND_AFTER_HOURS * 3_600_000;
  const rows = (await Promise.all([...new Set(ids)].map((id) => findInvitationById(ctx.db, id)))).filter((r): r is InvitationRow => !!r && r.tenantId === tenant.id);
  const sendable = rows.filter((r) => isOpen(r, now) && (!r.lastSentAt || r.lastSentAt.getTime() <= resendBefore)).map((r) => r.id);

  const dayKey = keys.invitesDay(tenant.id, todayIn(ctx.config.BILLING_TIMEZONE));
  const used = Number((await ctx.redis.get(dayKey)) ?? 0);
  const take = Math.min(sendable.length, Math.max(ctx.config.INVITES_DAILY_LIMIT - used, 0));
  if (sendable.length > 0 && take === 0) throw AppError.rateLimited(3600, `Your institution has sent its ${ctx.config.INVITES_DAILY_LIMIT} invitations for today. Try again tomorrow.`);
  if (take > 0) {
    await ctx.redis.incrby(dayKey, take);
    await ctx.redis.expire(dayKey, 2 * 86_400);
    const chosen = sendable.slice(0, take);
    for (let i = 0; i < chosen.length; i += SEND_BATCH) await ctx.jobs.enqueue("invitations.send", { tenantId: tenant.id, invitationIds: chosen.slice(i, i + SEND_BATCH) });
    await recordAudit(ctx, { tenantId: tenant.id, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "invitation.send", metadata: { count: take }, ip: actor.ip });
  }
  return { queued: take, skipped: ids.length - take };
}

/** "Send all pending": every open invitation that was never sent, up to today's limit. */
export async function sendPendingInvitations(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor): Promise<{ queued: number; skipped: number }> {
  const ids = await listPendingInvitationIds(ctx.db, tenantCtx.tenant.id, ctx.config.INVITES_DAILY_LIMIT);
  if (ids.length === 0) return { queued: 0, skipped: 0 };
  return sendInvitations(ctx, tenantCtx, actor, ids);
}

/** The invitations.send job: records the send and queues one message per invitation (deduped per send). */
export const sendInvitationBatch: JobHandler<"invitations.send"> = async (ctx, { tenantId, invitationIds }) => {
  const tenant = await findTenantById(ctx.db, tenantId);
  if (!tenant || tenant.status !== "ACTIVE" || !ctx.config.webAppUrl) return;
  const channels = await inviteChannels(ctx, tenantId);
  if (channels.length === 0) {
    ctx.logger.warn({ tenantId }, "Invitations not sent: the plan no longer includes a messaging channel");
    return;
  }
  await runInTransaction(ctx, async (tx) => {
    const rows = await markInvitationsSent(tx, tenantId, invitationIds);
    await queueMessages(
      ctx,
      rows.map((r) => ({
        type: "INVITE" as const,
        tenantId,
        to: { phoneE164: r.phoneE164, email: r.email, name: r.fullName },
        payload: { invitationId: r.id, tenantName: tenant.name, color: tenant.primaryColor, recipientName: r.fullName?.split(/\s+/)[0] ?? null, link: inviteLink(ctx, r.token)!, token: r.token },
        channels,
        dedupeKey: `invite-${r.id}-${r.sendCount}`,
        context: { type: "invite", id: r.id },
      })),
      tx,
    );
  });
};

export async function listInvitations(ctx: AppContext, tenantId: string, query: InvitationsQuery): Promise<Page<InvitationDto>> {
  const { rows, total } = await listInvitationRows(ctx.db, tenantId, query);
  const messages = await findMessagesByContext(
    ctx.db,
    "invite",
    rows.map((r) => r.id),
  );
  const latest = new Map<string, OutboundMessageRow>();
  for (const m of messages) {
    const prev = latest.get(m.contextId!);
    if (!prev || m.createdAt > prev.createdAt) latest.set(m.contextId!, m);
  }
  return buildPage(
    rows.map((r) => toInvitationDto(ctx, r, latest.get(r.id))),
    query.page,
    query.pageSize,
    total,
  );
}

export async function invitationSummary(ctx: AppContext, tenantId: string): Promise<InvitationSummaryDto> {
  const [counts, channels, used] = await Promise.all([
    invitationCounts(ctx.db, tenantId),
    inviteChannels(ctx, tenantId),
    ctx.redis.get(keys.invitesDay(tenantId, todayIn(ctx.config.BILLING_TIMEZONE))),
  ]);
  return { ...counts, channels, sendableToday: Math.max(ctx.config.INVITES_DAILY_LIMIT - Number(used ?? 0), 0) };
}

export async function revokeInvitation(ctx: AppContext, tenantCtx: TenantContext, actor: AdminActor, id: string): Promise<InvitationDto> {
  const inv = await findInvitationById(ctx.db, id);
  if (!inv || inv.tenantId !== tenantCtx.tenant.id) throw AppError.notFound("Invitation not found");
  if (inv.status === "ACCEPTED") throw AppError.invalidTransition("This invitation was already accepted");
  const row = inv.status === "REVOKED" ? inv : (await updateInvitation(ctx.db, inv.tenantId, id, { status: "REVOKED" }))!;
  await recordAudit(ctx, { tenantId: inv.tenantId, actorUserId: actor.userId, actorMembershipId: actor.membershipId ?? null, action: "invitation.revoke", targetType: "invitation", targetId: id, ip: actor.ip });
  return toInvitationDto(ctx, row);
}

/** What an invite link shows before sign-in: the institution, a first name and a masked phone. 404 once closed. */
export async function getInvitePublic(ctx: AppContext, token: string): Promise<InvitePublicDto> {
  const inv = await findInvitationByToken(ctx.db, token);
  const tenant = inv ? await findTenantById(ctx.db, inv.tenantId) : undefined;
  if (!inv || !tenant || tenant.status !== "ACTIVE" || !isOpen(inv)) throw AppError.notFound("This invitation link is no longer valid");
  return { tenant: toTenantSummaryDto(tenant), firstName: inv.fullName?.split(/\s+/)[0] ?? null, maskedPhone: maskPhone(inv.phoneE164) };
}

/** The open invitation for the signed-in person's (OTP-verified) phone, to prefill registration. */
export async function findMyInvitation(ctx: AppContext, tenantCtx: TenantContext, userId: string): Promise<MyInvitationDto | null> {
  const user = await findUserById(ctx.db, userId);
  const inv = user ? await findOpenInvitationByPhone(ctx.db, tenantCtx.tenant.id, user.phoneE164) : undefined;
  if (!inv) return null;
  return { fullName: inv.fullName, batchYear: inv.batchYear, fields: inv.fieldValues, autoApprove: tenantCtx.settings.inviteAutoApprove };
}
