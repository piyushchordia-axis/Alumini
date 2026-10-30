import { CONTENT_TYPES, MODERATION_STATUSES } from "@illuminize/shared";
import { describe, expect, it } from "vitest";
import {
  availableModerationActions,
  canTransitionContent,
  canViewContent,
  initialModerationStatus,
  statusAfterAuthorEdit,
  transitionContent,
  type ContentAction,
} from "../../src/services/moderation";

const ACTIONS: ContentAction[] = ["approve", "reject", "remove", "restore"];

describe("moderation state machine", () => {
  it("derives the initial status from mode, author role and content type", () => {
    const member = { role: "MEMBER" as const };
    const admin = { role: "TENANT_ADMIN" as const };
    for (const type of CONTENT_TYPES) {
      expect(initialModerationStatus("AUTO_APPROVE", member, type)).toBe("APPROVED");
      expect(initialModerationStatus("ADMIN_APPROVAL", admin, type)).toBe("APPROVED");
      expect(initialModerationStatus("ADMIN_APPROVAL", member, type)).toBe(type === "COMMENT" ? "APPROVED" : "PENDING");
    }
  });

  it("covers the full transition table", () => {
    const expected: Record<string, string | undefined> = {
      "PENDING:approve": "APPROVED",
      "PENDING:reject": "REJECTED",
      "REJECTED:approve": "APPROVED",
      "APPROVED:remove": "REMOVED",
      "REMOVED:restore": "APPROVED",
    };
    for (const from of MODERATION_STATUSES) {
      for (const action of ACTIONS) {
        const key = `${from}:${action}`;
        if (expected[key]) {
          expect(canTransitionContent(from, action)).toBe(true);
          expect(transitionContent(from, action)).toBe(expected[key]);
        } else {
          expect(canTransitionContent(from, action)).toBe(false);
          expect(() => transitionContent(from, action)).toThrow(/Cannot/);
        }
      }
    }
    expect(availableModerationActions("PENDING")).toEqual(["approve", "reject"]);
    expect(availableModerationActions("REMOVED")).toEqual(["restore"]);
  });

  it("resets edited content according to the moderation mode", () => {
    const member = { role: "MEMBER" as const };
    const admin = { role: "TENANT_ADMIN" as const };
    expect(statusAfterAuthorEdit("APPROVED", "ADMIN_APPROVAL", member)).toBe("PENDING");
    expect(statusAfterAuthorEdit("REJECTED", "ADMIN_APPROVAL", member)).toBe("PENDING");
    expect(statusAfterAuthorEdit("APPROVED", "AUTO_APPROVE", member)).toBe("APPROVED");
    expect(statusAfterAuthorEdit("PENDING", "ADMIN_APPROVAL", admin)).toBe("APPROVED");
    expect(() => statusAfterAuthorEdit("REMOVED", "AUTO_APPROVE", member)).toThrow(/removed/);
  });

  it("applies visibility rules", () => {
    const other = { isAuthor: false, isAdmin: false };
    const author = { isAuthor: true, isAdmin: false };
    const admin = { isAuthor: false, isAdmin: true };
    expect(canViewContent("APPROVED", other)).toBe(true);
    expect(canViewContent("PENDING", other)).toBe(false);
    expect(canViewContent("PENDING", author)).toBe(true);
    expect(canViewContent("REJECTED", author)).toBe(true);
    expect(canViewContent("REMOVED", author)).toBe(false);
    expect(canViewContent("REMOVED", admin)).toBe(true);
  });
});
