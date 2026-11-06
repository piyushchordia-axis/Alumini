import { resolveFeatures } from "@illuminize/shared";
import { emptyChatsHint } from "@illuminize/shared/chat";
import { describe, expect, it } from "vitest";

describe("emptyChatsHint", () => {
  // Every mix of the three switches it reads, with the words both apps showed before it moved here.
  const cases: Array<[messaging: boolean, directory: boolean, groups: boolean, hint: string]> = [
    [true, true, true, "Open a member's profile in the Directory and choose Message this member, or join a group."],
    [true, true, false, "Open a member's profile in the Directory and choose Message this member."],
    [true, false, true, "When you message a member, accept a request or join a group, the conversation shows here."],
    [true, false, false, "When you message a member, or accept a request, the conversation shows here."],
    [false, true, true, "When you join a group, its conversation shows here."],
    [false, true, false, "When you join a group, its conversation shows here."],
    [false, false, true, "When you join a group, its conversation shows here."],
    [false, false, false, "When you join a group, its conversation shows here."],
  ];

  it.each(cases)("messaging %s, directory %s, groups %s", (messaging, directory, groups, hint) => {
    expect(emptyChatsHint({ messaging, directory, groups })).toBe(hint);
  });

  it("reads an institution's resolved switches as the apps pass them", () => {
    const features = resolveFeatures("UNIVERSITY", { messaging: true, directory: false, groups: true });
    expect(emptyChatsHint(features)).toBe("When you message a member, accept a request or join a group, the conversation shows here.");
  });
});
