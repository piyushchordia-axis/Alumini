import { DELETED_MEMBER_NAME, resolveFeatures, type ChatConversationDto } from "@illuminize/shared";
import { emptyChatsActions, emptyChatsHint, emptyThreadText } from "@illuminize/shared/chat";
import { describe, expect, it } from "vitest";

// Every mix of the three switches the inbox reads.
const MIXES: Array<{ messaging: boolean; directory: boolean; groups: boolean }> = [true, false].flatMap((messaging) => [true, false].flatMap((directory) => [true, false].map((groups) => ({ messaging, directory, groups }))));

describe("emptyChatsHint", () => {
  // With the words both apps showed before it moved here.
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

describe("emptyChatsActions", () => {
  const findPeople = { target: "directory", label: "Find people" } as const;
  const findGroup = { target: "groups", label: "Find a group" } as const;

  it("offers Find people first, as the main way on, then Find a group", () => {
    // The e2e journeys look for both names, exactly, in the empty inbox at Demo University.
    expect(emptyChatsActions({ messaging: true, directory: true, groups: true }, true)).toEqual([
      { ...findPeople, variant: "primary" },
      { ...findGroup, variant: "outline" },
    ]);
  });

  it("leaves out Find people without direct messages or without the Directory, so Find a group leads", () => {
    for (const off of [{ messaging: false }, { directory: false }]) expect(emptyChatsActions({ messaging: true, directory: true, groups: true, ...off }, true), JSON.stringify(off)).toEqual([{ ...findGroup, variant: "primary" }]);
  });

  it("leaves out Find a group with groups off", () => {
    expect(emptyChatsActions({ messaging: true, directory: true, groups: false }, true)).toEqual([{ ...findPeople, variant: "primary" }]);
  });

  it.each(MIXES)("offers each only while what it opens can be used: %o", (features) => {
    const actions = emptyChatsActions(features, true);
    expect(actions.map((a) => a.target)).toEqual([...(features.messaging && features.directory ? ["directory"] : []), ...(features.groups ? ["groups"] : [])]);
    expect(actions.map((a) => a.variant)).toEqual(actions.map((_, i) => (i === 0 ? "primary" : "outline")));
  });

  it.each(MIXES)("offers a member who may not chat nothing, whatever is on: %o", (features) => {
    expect(emptyChatsActions(features, false)).toEqual([]);
  });

  it("reads an institution's resolved switches: a school starts with neither", () => {
    expect(emptyChatsActions(resolveFeatures("SCHOOL", {}), true)).toEqual([]);
    expect(emptyChatsActions(resolveFeatures("SCHOOL", { groups: true }), true)).toEqual([{ ...findGroup, variant: "primary" }]);
  });
});

describe("emptyThreadText", () => {
  const priya = { id: "00000000-0000-4000-8000-000000000002", fullName: "Priya Nair", avatarUrl: null, startYear: 2008, batchYear: 2012 };
  const direct: ChatConversationDto = {
    id: "00000000-0000-4000-8000-0000000000c1",
    kind: "DIRECT",
    origin: "MESSAGE_REQUEST",
    peer: priya,
    group: null,
    state: "ACCEPTED",
    canSend: true,
    canRerequestAt: null,
    blockedByMe: false,
    unread: 0,
    lastReadSeq: 0,
    mutedUntil: null,
    lastMessageAt: "2026-01-01T00:00:00.000Z",
    lastMessage: null,
  };

  it("names the other member in a direct thread, and the group in a group", () => {
    expect(emptyThreadText(direct)).toBe("Messages between you and Priya Nair show here.");
    const group: ChatConversationDto = { ...direct, kind: "GROUP", origin: "GROUP", peer: null, group: { name: "London & UK alumni", visibility: "OPEN", memberCount: 4, archived: false, isOwner: false } };
    expect(emptyThreadText(group)).toBe("Messages in London & UK alumni show here.");
  });

  it("names a member who deleted their account as the thread's header does", () => {
    expect(emptyThreadText({ ...direct, peer: null })).toBe(`Messages between you and ${DELETED_MEMBER_NAME} show here.`);
  });

  it("reads the same however the thread stands, so a requester can't tell a block from a wait", () => {
    // Blocks are invisible: the requester's thread must say the same whether the request waits, was declined or met a block.
    const views: ChatConversationDto[] = [
      { ...direct, state: "REQUEST_SENT", canSend: false, canRerequestAt: "2026-02-01T00:00:00.000Z" },
      { ...direct, state: "REQUEST_DECLINED", canSend: false },
      { ...direct, state: "CLOSED", canSend: false, canRerequestAt: "2026-02-01T00:00:00.000Z" },
      { ...direct, state: "ACCEPTED", canSend: true, blockedByMe: true },
      { ...direct, origin: "MENTORSHIP", unread: 3, mutedUntil: "2026-03-01T00:00:00.000Z" },
    ];
    for (const view of views) expect(emptyThreadText(view), `${view.state}, blockedByMe ${view.blockedByMe}`).toEqual(emptyThreadText(direct));
  });
});
