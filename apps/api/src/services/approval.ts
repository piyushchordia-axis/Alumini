import type { ApprovalMode, MembershipStatus } from "@illuminize/shared";
import { AppError } from "../lib/errors";

export type MembershipAction = "approve" | "reject" | "suspend" | "reinstate" | "reapply";

type Target = MembershipStatus | "INITIAL";

const TRANSITIONS: Record<MembershipStatus, Partial<Record<MembershipAction, Target>>> = {
  PENDING: { approve: "APPROVED", reject: "REJECTED" },
  APPROVED: { suspend: "SUSPENDED" },
  REJECTED: { approve: "APPROVED", reapply: "INITIAL" },
  SUSPENDED: { reinstate: "APPROVED" },
};

export function initialMembershipStatus(mode: ApprovalMode): MembershipStatus {
  return mode === "AUTO_APPROVE" ? "APPROVED" : "PENDING";
}

export function canTransitionMembership(from: MembershipStatus, action: MembershipAction): boolean {
  return TRANSITIONS[from]?.[action] !== undefined;
}

/**
 * Pure membership state machine. `mode` is required for `reapply`, which
 * restarts the membership according to the tenant's current approval mode.
 */
export function transitionMembership(from: MembershipStatus, action: MembershipAction, mode?: ApprovalMode): MembershipStatus {
  const target = TRANSITIONS[from]?.[action];
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
export function availableAdminActions(status: MembershipStatus): MembershipAction[] {
  return (Object.keys(TRANSITIONS[status] ?? {}) as MembershipAction[]).filter((a) => a !== "reapply");
}
