import { MEMBERSHIP_STATUSES } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import {
  assertAdminTransition,
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

  it("refuses an admin's action with the status as it is now, in words for whoever acted on an old list or notice", () => {
    const because = {
      APPROVED: "This member has already been approved",
      REJECTED: "This request has already been rejected",
      SUSPENDED: "This member is suspended",
      PENDING: "This request is still waiting for approval",
    } as const;
    for (const from of MEMBERSHIP_STATUSES) {
      for (const action of ["approve", "reject", "suspend", "reinstate"] as const) {
        if (canTransitionMembership(from, action)) {
          expect(() => assertAdminTransition(from, action)).not.toThrow();
          continue;
        }
        let thrown: unknown;
        try {
          assertAdminTransition(from, action);
        } catch (err) {
          thrown = err;
        }
        expect(thrown, `${from}:${action}`).toMatchObject({ status: 409, code: "INVALID_TRANSITION", message: because[from], details: { status: from } });
      }
    }
    // The ones a new-member notice offers, and approving someone rejected earlier.
    expect(() => assertAdminTransition("PENDING", "approve")).not.toThrow();
    expect(() => assertAdminTransition("PENDING", "reject")).not.toThrow();
    expect(() => assertAdminTransition("REJECTED", "approve")).not.toThrow();
  });

  it("refuses an action on a status other than the one the admin acted on, even one the status allows", () => {
    const thrownBy = (fn: () => void): unknown => {
      try {
        fn();
      } catch (err) {
        return err;
      }
      return undefined;
    };
    expect(() => assertAdminTransition("PENDING", "approve", "PENDING")).not.toThrow();
    expect(() => assertAdminTransition("PENDING", "reject", "PENDING")).not.toThrow();
    // Approving someone rejected, from a list that showed them rejected.
    expect(() => assertAdminTransition("REJECTED", "approve", "REJECTED")).not.toThrow();
    // A notice still showed the request waiting, but another admin has rejected it since.
    expect(thrownBy(() => assertAdminTransition("REJECTED", "approve", "PENDING"))).toMatchObject({
      status: 409,
      code: "INVALID_TRANSITION",
      message: "This request has already been rejected",
      details: { status: "REJECTED" },
    });
    // The member applied again since the admin saw them rejected.
    expect(thrownBy(() => assertAdminTransition("PENDING", "approve", "REJECTED"))).toMatchObject({
      code: "INVALID_TRANSITION",
      message: "This request is still waiting for approval",
      details: { status: "PENDING" },
    });
    // Refused as before whatever was sent with it.
    expect(thrownBy(() => assertAdminTransition("APPROVED", "approve", "APPROVED"))).toMatchObject({ message: "This member has already been approved", details: { status: "APPROVED" } });
  });

  it("lists admin actions per status", () => {
    expect(availableAdminActions("PENDING")).toEqual(["approve", "reject"]);
    expect(availableAdminActions("APPROVED")).toEqual(["suspend"]);
    expect(availableAdminActions("REJECTED")).toEqual(["approve"]);
    expect(availableAdminActions("SUSPENDED")).toEqual(["reinstate"]);
  });
});
