import { MEMBERSHIP_TRANSITIONS, memberActionsFor, type ApprovalMode, type MemberAdminAction, type MembershipAction, type MembershipStatus } from "@illuminize/shared";
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

/** Why an admin can't act on a membership in this status, worded for an admin who acted on a list or notice that was out of date. */
const REFUSED_BECAUSE: Record<MembershipStatus, string> = {
  APPROVED: "This member has already been approved",
  REJECTED: "This request has already been rejected",
  SUSPENDED: "This member is suspended",
  PENDING: "This request is still waiting for approval",
};

/**
 * Refuses an admin's action the membership's status doesn't allow, with the status in details so the apps can show it.
 * `expected` is the status the admin acted on, when their screen sent it: a status that has changed since is refused too,
 * even where the action would still be allowed, so an approval from a notice can't overturn another admin's rejection.
 */
export function assertAdminTransition(from: MembershipStatus, action: MemberAdminAction, expected?: MembershipStatus): void {
  if ((expected !== undefined && expected !== from) || !canTransitionMembership(from, action)) {
    throw AppError.invalidTransition(REFUSED_BECAUSE[from], { status: from });
  }
}

/** Actions an admin may take on a membership in the given status (for UI affordances). */
export const availableAdminActions = memberActionsFor;
