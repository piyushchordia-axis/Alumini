import { MEMBERSHIP_TRANSITIONS, memberActionsFor, type ApprovalMode, type MembershipAction, type MembershipStatus } from "@illuminize/shared";
import { AppError } from "../lib/errors";

// The table lives in the shared package, so the apps' buttons offer exactly what this allows.
export type { MembershipAction };

export function initialMembershipStatus(mode: ApprovalMode): MembershipStatus {
  return mode === "AUTO_APPROVE" ? "APPROVED" : "PENDING";
}

export function canTransitionMembership(from: MembershipStatus, action: MembershipAction): boolean {
  return MEMBERSHIP_TRANSITIONS[from]?.[action] !== undefined;
}

/**
 * Pure membership state machine. `mode` is required for `reapply`, which
 * restarts the membership according to the tenant's current approval mode.
 */
export function transitionMembership(from: MembershipStatus, action: MembershipAction, mode?: ApprovalMode): MembershipStatus {
  const target = MEMBERSHIP_TRANSITIONS[from]?.[action];
  if (!target) {
    throw AppError.invalidTransition(`Cannot ${action} a membership that is ${from}`);
  }
  if (target === "INITIAL") {
    if (!mode) throw new Error("approval mode required for reapply");
    return initialMembershipStatus(mode);
  }
  return target;
}

/** Actions an admin may take on a membership in the given status (for UI affordances). */
export const availableAdminActions = memberActionsFor;
