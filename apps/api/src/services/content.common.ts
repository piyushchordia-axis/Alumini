import type { ContentType, MembershipStatus, ModerationStatus } from "@illuminize/shared";
import type { AppContext } from "../context";
import { AppError } from "../lib/errors";
import type { AuthContext, MembershipRow, TenantContext } from "../types/request";
import type { Viewer } from "../dto/content.dto";
import { recordAudit } from "./audit.service";
import { canViewContent, initialModerationStatus, statusAfterAuthorEdit } from "./moderation";
import { notifyTenantAdmins } from "./notifications/notification.service";

export interface ContentActor extends AuthContext {
  membership: MembershipRow;
  ip?: string;
}

export function viewerFlags(actor: ContentActor, authorMembershipId: string) {
  const isAuthor = actor.membership.id === authorMembershipId;
  const isAdmin = actor.isPlatformAdmin || (actor.membership.status === "APPROVED" && actor.membership.role === "TENANT_ADMIN");
  return { isAuthor, isAdmin };
}

/** 404 unless the viewer may see the item: moderation rules, and suspended authors' content is hidden from members. */
/** The viewer for DTO mapping (isMine, moderation note). */
export function viewerOf(actor: ContentActor): Viewer {
  return { membershipId: actor.membership.id, isAdmin: viewerFlags(actor, "").isAdmin };
}

/** Whether the viewer may see the item: moderation rules, and suspended authors' content is hidden from members. */
export function canView(actor: ContentActor, status: ModerationStatus, authorMembershipId: string, authorStatus?: MembershipStatus): boolean {
  const flags = viewerFlags(actor, authorMembershipId);
  const hiddenAuthor = authorStatus === "SUSPENDED" && !flags.isAuthor && !flags.isAdmin;
  return !hiddenAuthor && canViewContent(status, flags);
}

export function assertCanView(actor: ContentActor, status: ModerationStatus, authorMembershipId: string, label: string, authorStatus?: MembershipStatus): void {
  if (!canView(actor, status, authorMembershipId, authorStatus)) throw AppError.notFound(`${label} not found`);
}

export function assertAuthor(actor: ContentActor, authorMembershipId: string): void {
  if (actor.membership.id !== authorMembershipId) throw AppError.forbidden("Only the author can do that");
}

export function assertAuthorOrAdmin(actor: ContentActor, authorMembershipId: string): void {
  const { isAuthor, isAdmin } = viewerFlags(actor, authorMembershipId);
  if (!isAuthor && !isAdmin) throw AppError.forbidden("Only the author or an administrator can do that");
}

export function initialStatusFor(tenantCtx: TenantContext, actor: ContentActor, contentType: ContentType): ModerationStatus {
  return initialModerationStatus(tenantCtx.settings.contentModerationMode, actor.membership, contentType);
}

export function statusAfterEdit(tenantCtx: TenantContext, actor: ContentActor, current: ModerationStatus): ModerationStatus {
  return statusAfterAuthorEdit(current, tenantCtx.settings.contentModerationMode, actor.membership);
}

const LABELS: Record<ContentType, string> = { POST: "post", COMMENT: "comment", JOB: "job", FUNDING: "funding listing", EVENT: "event", BUSINESS: "business listing", GROUP: "group" };

/** Audit + admin notification after content is created or edited into PENDING. */
export async function afterContentWrite(
  ctx: AppContext,
  tenantCtx: TenantContext,
  actor: ContentActor,
  input: { contentType: ContentType; id: string; title: string; status: ModerationStatus; action: "create" | "update" | "delete" | "close" | "cancel" | "archive" },
): Promise<void> {
  await recordAudit(ctx, {
    tenantId: tenantCtx.tenant.id,
    actorUserId: actor.userId,
    actorMembershipId: actor.membership.id,
    action: `content.${input.action}`,
    targetType: input.contentType.toLowerCase(),
    targetId: input.id,
    metadata: { contentType: input.contentType, status: input.status },
    ip: actor.ip,
  });
  if (input.status === "PENDING" && (input.action === "create" || input.action === "update")) {
    await notifyTenantAdmins(ctx, {
      tenantId: tenantCtx.tenant.id,
      excludeMembershipId: actor.membership.id,
      type: "CONTENT_PENDING",
      title: `New ${LABELS[input.contentType]} awaiting approval`,
      body: `${actor.membership.fullName}: ${input.title.slice(0, 80)}`,
      data: { contentType: input.contentType, contentId: input.id },
    });
  }
}

export const contentLabel = (t: ContentType) => LABELS[t];
