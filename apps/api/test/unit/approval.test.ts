import { MEMBERSHIP_STATUSES } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import {
  availableAdminActions,
  canTransitionMembership,
  initialMembershipStatus,
  transitionMembership,
  type MembershipAction,
} from "../../src/services/approval";

const ACTIONS: MembershipAction[] = ["approve", "reject", "suspend", "reinstate", "reapply"];

describe("approval state machine", () => {
  it("derives the initial status from the tenant mode", () => {
    expect(initialMembershipStatus("AUTO_APPROVE")).toBe("APPROVED");
    expect(initialMembershipStatus("ADMIN_APPROVAL")).toBe("PENDING");
  });

  it("covers the full transition table", () => {
    const expected: Record<string, string | undefined> = {
      "PENDING:approve": "APPROVED",
      "PENDING:reject": "REJECTED",
      "APPROVED:suspend": "SUSPENDED",
      "REJECTED:approve": "APPROVED",
      "REJECTED:reapply": "PENDING",
      "SUSPENDED:reinstate": "APPROVED",
    };
    for (const from of MEMBERSHIP_STATUSES) {
      for (const action of ACTIONS) {
        const key = `${from}:${action}`;
        if (expected[key]) {
          expect(canTransitionMembership(from, action)).toBe(true);
          expect(transitionMembership(from, action, "ADMIN_APPROVAL")).toBe(expected[key]);
        } else {
          expect(canTransitionMembership(from, action)).toBe(false);
          expect(() => transitionMembership(from, action, "ADMIN_APPROVAL")).toThrow(/Cannot/);
        }
      }
    }
  });

  it("reapply follows the current approval mode", () => {
    expect(transitionMembership("REJECTED", "reapply", "AUTO_APPROVE")).toBe("APPROVED");
    expect(transitionMembership("REJECTED", "reapply", "ADMIN_APPROVAL")).toBe("PENDING");
  });

  it("lists admin actions per status", () => {
    expect(availableAdminActions("PENDING")).toEqual(["approve", "reject"]);
    expect(availableAdminActions("APPROVED")).toEqual(["suspend"]);
    expect(availableAdminActions("REJECTED")).toEqual(["approve"]);
    expect(availableAdminActions("SUSPENDED")).toEqual(["reinstate"]);
  });
});
