import type { ApprovalMode, ContentType, MembershipRole, ModerationStatus } from "@illuminize/shared";
import { AppError } from "../lib/errors";

export type ContentAction = "approve" | "reject" | "remove" | "restore";

const TRANSITIONS: Record<ModerationStatus, Partial<Record<ContentAction, ModerationStatus>>> = {
  PENDING: { approve: "APPROVED", reject: "REJECTED" },
  REJECTED: { approve: "APPROVED" },
  APPROVED: { remove: "REMOVED" },
  REMOVED: { restore: "APPROVED" },
};

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
  return TRANSITIONS[from]?.[action] !== undefined;
}

export function transitionContent(from: ModerationStatus, action: ContentAction): ModerationStatus {
  const to = TRANSITIONS[from]?.[action];
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

export function availableModerationActions(status: ModerationStatus): ContentAction[] {
  return Object.keys(TRANSITIONS[status] ?? {}) as ContentAction[];
}
