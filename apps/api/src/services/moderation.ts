import { MODERATION_TRANSITIONS, moderationActionsFor, type ApprovalMode, type ContentAction, type ContentType, type MembershipRole, type ModerationStatus } from "@illuminize/shared";
import { AppError } from "../lib/errors";

// The table lives in the shared package, so the apps' buttons offer exactly what this allows.
export type { ContentAction };

export interface ContentAuthor {
  role: MembershipRole;
}

/** Comments are never pre-moderated; tenant admins' own content is always published. */
export function initialModerationStatus(mode: ApprovalMode, author: ContentAuthor, contentType: ContentType): ModerationStatus {
  if (contentType === "COMMENT") return "APPROVED";
  if (author.role === "TENANT_ADMIN") return "APPROVED";
  return mode === "AUTO_APPROVE" ? "APPROVED" : "PENDING";
}

export function canTransitionContent(from: ModerationStatus, action: ContentAction): boolean {
  return MODERATION_TRANSITIONS[from]?.[action] !== undefined;
}

export function transitionContent(from: ModerationStatus, action: ContentAction): ModerationStatus {
  const to = MODERATION_TRANSITIONS[from]?.[action];
  if (!to) throw AppError.invalidTransition(`Cannot ${action} content that is ${from}`);
  return to;
}

/** Status after the author edits their content. Removed content cannot be edited. */
export function statusAfterAuthorEdit(current: ModerationStatus, mode: ApprovalMode, author: ContentAuthor): ModerationStatus {
  if (current === "REMOVED") throw AppError.forbidden("This content was removed by an administrator and can no longer be edited");
  if (author.role === "TENANT_ADMIN") return "APPROVED";
  return mode === "AUTO_APPROVE" ? "APPROVED" : "PENDING";
}

export function canViewContent(status: ModerationStatus, viewer: { isAuthor: boolean; isAdmin: boolean }): boolean {
  if (viewer.isAdmin) return true;
  if (status === "APPROVED") return true;
  if (status === "REMOVED") return false;
  return viewer.isAuthor;
}

export const availableModerationActions = moderationActionsFor;
