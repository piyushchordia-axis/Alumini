import { CHAT_MUTE_OPTIONS, chatBadgeLabel, chatKeys, groupsBadgeLabel, chatMuteUntil, conversationPreview, conversationTitle, directThreadSubtitle, formatChatTime, isMuted, isMutedUntilTurnedOn, messageSenderName, peerName, peerYears, systemLineText, unsentRemainder } from "@illuminize/shared/chat";
import { BLOCKED_MEMBER_NAME, DELETED_MEMBER_NAME, chatMuteSchema, type ChatConversationGroupDto, type ChatLastMessageDto } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("chatMuteUntil", () => {
  it("offers 8 hours, a week and until turned back on, in that order", () => {
    expect(CHAT_MUTE_OPTIONS.map((o) => o.value)).toEqual(["HOURS_8", "WEEK_1", "UNTIL_TURNED_ON"]);
  });

  it("counts from the moment it's given", () => {
    expect(chatMuteUntil("HOURS_8", NOW)).toBe("2026-06-15T20:00:00.000Z");
    expect(chatMuteUntil("WEEK_1", NOW)).toBe("2026-06-22T12:00:00.000Z");
  });

  it("uses a far-future date for until turned back on, because null means unmute", () => {
    const until = chatMuteUntil("UNTIL_TURNED_ON", NOW);
    expect(until).not.toBeNull();
    expect(new Date(until).getTime()).toBeGreaterThan(new Date("2100-01-01T00:00:00.000Z").getTime());
  });

  it("gives every option a date the API accepts", () => {
    for (const { value } of CHAT_MUTE_OPTIONS) expect(chatMuteSchema.safeParse({ until: chatMuteUntil(value, NOW) }).success, value).toBe(true);
  });

  it("tells the until-turned-on mute apart from a dated one, as the API sends it back", () => {
    // The API returns the stored date through toISOString, which may not match the string sent character for character.
    expect(isMutedUntilTurnedOn(new Date(chatMuteUntil("UNTIL_TURNED_ON", NOW)).toISOString())).toBe(true);
    expect(isMutedUntilTurnedOn(chatMuteUntil("WEEK_1", NOW))).toBe(false);
    expect(isMutedUntilTurnedOn(null)).toBe(false);
  });
});

describe("chatBadgeLabel", () => {
  it("says nothing extra with nothing waiting, or before it has loaded", () => {
    expect(chatBadgeLabel(undefined)).toEqual({ count: 0, label: "Messages" });
    expect(chatBadgeLabel({ unread: 0, requests: 0, invites: 0 })).toEqual({ count: 0, label: "Messages" });
  });

  it("counts threads with something unread and requests waiting, and never group invitations", () => {
    expect(chatBadgeLabel({ unread: 2, requests: 1, invites: 4 })).toEqual({ count: 3, label: "Messages, 3 unread" });
    expect(chatBadgeLabel({ unread: 0, requests: 1, invites: 0 })).toEqual({ count: 1, label: "Messages, 1 unread" });
    expect(chatBadgeLabel({ unread: 0, requests: 0, invites: 2 })).toEqual({ count: 0, label: "Messages" });
  });
});

describe("groupsBadgeLabel", () => {
  it("names the Groups entry plainly with no invitations, or before it has loaded", () => {
    expect(groupsBadgeLabel(undefined)).toEqual({ count: 0, label: "Groups" });
    expect(groupsBadgeLabel({ unread: 5, requests: 2, invites: 0 })).toEqual({ count: 0, label: "Groups" });
  });

  it("counts invitations waiting, one or several", () => {
    expect(groupsBadgeLabel({ unread: 0, requests: 0, invites: 1 })).toEqual({ count: 1, label: "Groups, 1 invitation" });
    expect(groupsBadgeLabel({ unread: 3, requests: 0, invites: 2 })).toEqual({ count: 2, label: "Groups, 2 invitations" });
  });
});

describe("thread labels shared by both apps", () => {
  const member = { id: "m1", fullName: "Meera Iyer", avatarUrl: null, startYear: 2008, batchYear: 2012 };

  it("names a member who deleted their account as a Deleted member", () => {
    expect(peerName(member)).toBe("Meera Iyer");
    expect(peerName(null)).toBe("Deleted member");
  });

  it("counts a mute as on only until it ends", () => {
    expect(isMuted({ mutedUntil: null }, NOW)).toBe(false);
    expect(isMuted({ mutedUntil: chatMuteUntil("HOURS_8", NOW) }, NOW)).toBe(true);
    expect(isMuted({ mutedUntil: chatMuteUntil("HOURS_8", NOW) }, new Date(NOW.getTime() + 9 * 3_600_000))).toBe(false);
    expect(isMuted({ mutedUntil: chatMuteUntil("UNTIL_TURNED_ON", NOW) }, new Date("2100-01-01T00:00:00.000Z"))).toBe(true);
  });

  it("says Yesterday, a weekday, then a date as a thread gets older", () => {
    const now = new Date(2026, 5, 15, 12, 0);
    expect(formatChatTime(new Date(2026, 5, 14, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(formatChatTime(new Date(2026, 5, 12, 9, 0).toISOString(), now)).toBe(new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(2026, 5, 12, 9, 0)));
    expect(formatChatTime(new Date(2026, 4, 1, 9, 0).toISOString(), now)).not.toMatch(/2026/);
    expect(formatChatTime(new Date(2025, 4, 1, 9, 0).toISOString(), now)).toMatch(/2025/);
  });

  it("keeps a request's words out of the inbox until it's opened", () => {
    const lastMessage: ChatLastMessageDto = { seq: 1, kind: "TEXT", body: "Hello there", mine: false, sender: null, redacted: false, createdAt: NOW.toISOString() };
    const direct = { group: null };
    expect(conversationPreview({ ...direct, state: "REQUEST_RECEIVED", lastMessage })).toBe("Wants to send you a message");
    expect(conversationPreview({ ...direct, state: "REQUEST_SENT", lastMessage: { ...lastMessage, mine: true } })).toBe("Request sent");
    expect(conversationPreview({ ...direct, state: "ACCEPTED", lastMessage })).toBe("Hello there");
    expect(conversationPreview({ ...direct, state: "ACCEPTED", lastMessage: { ...lastMessage, mine: true } })).toBe("You: Hello there");
    expect(conversationPreview({ ...direct, state: "ACCEPTED", lastMessage: { ...lastMessage, body: null } })).toBe("This message was removed");
    expect(conversationPreview({ ...direct, state: "CLOSED", lastMessage: null })).toBe("Conversation closed");
  });

  describe("in a group", () => {
    const group: ChatConversationGroupDto = { name: "Weekend runners", visibility: "OPEN", memberCount: 3, archived: false, isOwner: false };
    const priya = { id: "m-priya", fullName: "Priya Sharma", avatarUrl: null, startYear: 2010, batchYear: 2014 };
    const last = (overrides: Partial<ChatLastMessageDto>): ChatLastMessageDto => ({ seq: 4, kind: "TEXT", body: "See you at seven", mine: false, sender: priya, redacted: false, createdAt: NOW.toISOString(), ...overrides });
    const preview = (overrides: Partial<ChatLastMessageDto>) => conversationPreview({ state: "ACCEPTED", group, lastMessage: last(overrides) });

    it("says who wrote it, and You for the member's own", () => {
      expect(preview({})).toBe("Priya Sharma: See you at seven");
      expect(preview({ mine: true, sender: { id: "m-me", fullName: "Me", avatarUrl: null, startYear: 2009, batchYear: null } })).toBe("You: See you at seven");
      expect(preview({ sender: null })).toBe(`${DELETED_MEMBER_NAME}: See you at seven`);
      expect(preview({ body: null })).toBe("This message was removed");
    });

    it("reads a system line on from the member it's about", () => {
      expect(preview({ kind: "SYSTEM", body: "joined the group" })).toBe("Priya Sharma joined the group");
      expect(preview({ kind: "SYSTEM", body: "left the group", mine: true })).toBe("You left the group");
      expect(preview({ kind: "SYSTEM", body: "left the group", sender: null })).toBe(`${DELETED_MEMBER_NAME} left the group`);
      expect(preview({ kind: "SYSTEM", body: "is now the group's owner", mine: true })).toBe("You are now the group's owner");
    });

    it("puts the verb in the member's own form in their own system lines, and nowhere else", () => {
      const line = (body: string, mine: boolean, sender: typeof priya | null = priya, redacted = false) => systemLineText({ body, sender, redacted }, mine);
      expect(line("is now the group's owner", true)).toBe("You are now the group's owner");
      expect(line("was removed from the group", true)).toBe("You were removed from the group");
      expect(line("archived the group", true)).toBe("You archived the group");
      expect(line("is now the group's owner", false)).toBe("Priya Sharma is now the group's owner");
      expect(line("was removed from the group", false, null)).toBe(`${DELETED_MEMBER_NAME} was removed from the group`);
      expect(line("joined the group", false, null, true)).toBe(`${BLOCKED_MEMBER_NAME} joined the group`);
    });

    it("never shows a blocked member's words or name", () => {
      const redacted = preview({ sender: null, body: null, redacted: true });
      expect(redacted).toBe("Message from a blocked member");
      expect(redacted).not.toContain("Priya");
      expect(preview({ kind: "SYSTEM", body: "joined the group", sender: null, redacted: true })).toBe(`${BLOCKED_MEMBER_NAME} joined the group`);
    });
  });

  it("names a thread and a message's sender, standing in for members who are gone or blocked", () => {
    const priya = { id: "m-priya", fullName: "Priya Sharma", avatarUrl: null, startYear: 2010, batchYear: 2014 };
    expect(conversationTitle({ peer: priya, group: null })).toBe("Priya Sharma");
    expect(conversationTitle({ peer: null, group: null })).toBe(DELETED_MEMBER_NAME);
    expect(conversationTitle({ peer: null, group: { name: "Weekend runners", visibility: "OPEN", memberCount: 2, archived: false, isOwner: true } })).toBe("Weekend runners");
    expect(messageSenderName({ sender: priya, redacted: false })).toBe("Priya Sharma");
    expect(messageSenderName({ sender: null, redacted: false })).toBe(DELETED_MEMBER_NAME);
    expect(messageSenderName({ sender: null, redacted: true })).toBe(BLOCKED_MEMBER_NAME);
  });

  it("gives the other member's years in a direct thread, for the inbox row and under the header's name with Muted", () => {
    const priya = { id: "m-priya", fullName: "Priya Sharma", avatarUrl: null, startYear: 2010, batchYear: 2014 };
    const nisha = { ...priya, id: "m-nisha", fullName: "Nisha Modi", startYear: 1996, batchYear: null };
    const group: ChatConversationGroupDto = { name: "Weekend runners", visibility: "OPEN", memberCount: 2, archived: false, isOwner: true };
    expect(peerYears({ peer: priya, group: null })).toBe("2010–2014");
    expect(peerYears({ peer: nisha, group: null })).toBe("1996–present");
    expect(peerYears({ peer: null, group: null })).toBe("");
    // A group's last sender is never its peer: a group has none, and its header says how many are in it instead.
    expect(peerYears({ peer: priya, group })).toBe("");
    expect(directThreadSubtitle({ peer: priya, group: null }, false)).toBe("2010–2014");
    expect(directThreadSubtitle({ peer: priya, group: null }, true)).toBe("2010–2014 · Muted");
    expect(directThreadSubtitle({ peer: null, group: null }, true)).toBe("Muted");
    expect(directThreadSubtitle({ peer: null, group: null }, false)).toBe("");
  });
});

describe("chatKeys.direct", () => {
  it("sits under the tenant's keys, so a tenant-wide invalidation reaches it", () => {
    expect(chatKeys.direct("demo", "m1").slice(0, 2)).toEqual(chatKeys.all("demo"));
  });
});

describe("unsentRemainder", () => {
  it("is nothing when the box still holds just what went", () => {
    expect(unsentRemainder("Hi there", "Hi there")).toBe("");
    expect(unsentRemainder("  Hi there \n", "Hi there")).toBe("");
    expect(unsentRemainder("", "Hi there")).toBe("");
  });

  it("is what was typed after it while it was sending", () => {
    expect(unsentRemainder("Hi there\nare you free on Friday?", "Hi there")).toBe("are you free on Friday?");
    expect(unsentRemainder("  Hi there, and more", "Hi there")).toBe(", and more");
  });

  it("keeps a changed draft whole rather than guess what's left", () => {
    expect(unsentRemainder("Hello instead", "Hi there")).toBe("Hello instead");
  });
});
