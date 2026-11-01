import { resolveNotificationPrefs, type NotificationPrefs, type NotificationPrefsDto, type NotificationPrefsUpdate, type UnsubscribeInfoDto } from "@illuminize/shared";
import type { AppContext } from "../../context";
import { AppError } from "../../lib/errors";
import { verifyUnsubscribeToken, type UnsubscribeScope } from "../../lib/unsubscribe";
import { findMembershipByIdUnscoped } from "../../repositories/memberships.repo";
import { findNotificationPrefs, saveNotificationPrefs } from "../../repositories/notifications.repo";
import { findTenantById } from "../../repositories/tenants.repo";
import { findUserById } from "../../repositories/users.repo";
import type { MembershipRow } from "../../types/request";
import { recordAudit } from "../audit.service";

export async function getNotificationPrefs(ctx: AppContext, membership: MembershipRow): Promise<NotificationPrefsDto> {
  const [prefs, user] = await Promise.all([findNotificationPrefs(ctx.db, membership.id), findUserById(ctx.db, membership.userId)]);
  return { ...resolveNotificationPrefs(prefs), hasEmail: !!user?.email };
}

/** Applies a partial change on top of what is stored. */
export async function updateNotificationPrefs(ctx: AppContext, membership: MembershipRow, input: NotificationPrefsUpdate): Promise<NotificationPrefsDto> {
  const current = (await findNotificationPrefs(ctx.db, membership.id)) ?? {};
  const next: NotificationPrefs = {
    ...current,
    ...(input.categories ? { categories: { ...current.categories, ...input.categories } } : {}),
    ...(input.digestEmail !== undefined ? { digestEmail: input.digestEmail } : {}),
    ...(input.announcementMessages !== undefined ? { announcementMessages: input.announcementMessages } : {}),
    ...(input.celebrationsNoticeSeen ? { celebrationsNoticeSeenAt: new Date().toISOString() } : {}),
  };
  await saveNotificationPrefs(ctx.db, membership.tenantId, membership.id, next);
  return getNotificationPrefs(ctx, membership);
}

const PREF_FOR_SCOPE: Record<UnsubscribeScope, "digestEmail" | "announcementMessages"> = { digest: "digestEmail", announcements: "announcementMessages" };

async function resolveToken(ctx: AppContext, token: string) {
  const parsed = verifyUnsubscribeToken(ctx.config, token);
  const membership = parsed ? await findMembershipByIdUnscoped(ctx.db, parsed.membershipId) : undefined;
  const tenant = membership ? await findTenantById(ctx.db, membership.tenantId) : undefined;
  if (!parsed || !membership || !tenant) throw AppError.notFound("This unsubscribe link is not valid.");
  return { scope: parsed.scope, membership, tenant };
}

/** What an unsubscribe link would turn off, for the confirmation page. */
export async function getUnsubscribeInfo(ctx: AppContext, token: string): Promise<UnsubscribeInfoDto> {
  const { scope, membership, tenant } = await resolveToken(ctx, token);
  const prefs = resolveNotificationPrefs(await findNotificationPrefs(ctx.db, membership.id));
  return { tenantName: tenant.name, scope, unsubscribed: !prefs[PREF_FOR_SCOPE[scope]] };
}

/** Turns off the email kind named by the link (idempotent; also the RFC 8058 one-click endpoint). */
export async function unsubscribe(ctx: AppContext, token: string, ip?: string): Promise<UnsubscribeInfoDto> {
  const { scope, membership, tenant } = await resolveToken(ctx, token);
  const current = (await findNotificationPrefs(ctx.db, membership.id)) ?? {};
  if (current[PREF_FOR_SCOPE[scope]] !== false) {
    await saveNotificationPrefs(ctx.db, membership.tenantId, membership.id, { ...current, [PREF_FOR_SCOPE[scope]]: false });
    await recordAudit(ctx, { tenantId: tenant.id, actorUserId: membership.userId, actorMembershipId: membership.id, action: "notifications.unsubscribe", metadata: { scope }, ip });
  }
  return { tenantName: tenant.name, scope, unsubscribed: true };
}
