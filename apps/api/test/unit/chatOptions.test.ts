import { CHAT_MUTE_OPTIONS, chatBadgeLabel, chatKeys, chatMuteUntil, conversationPreview, formatChatTime, isMuted, isMutedUntilTurnedOn, peerName, unsentRemainder } from "@illuminize/shared/chat";
import { chatMuteSchema } from "@illuminize/shared";
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
    expect(chatBadgeLabel({ unread: 0, requests: 0 })).toEqual({ count: 0, label: "Messages" });
  });

  it("counts threads with something unread and requests waiting", () => {
    expect(chatBadgeLabel({ unread: 2, requests: 1 })).toEqual({ count: 3, label: "Messages, 3 unread" });
    expect(chatBadgeLabel({ unread: 0, requests: 1 })).toEqual({ count: 1, label: "Messages, 1 unread" });
  });
});

describe("thread labels shared by both apps", () => {
  const member = { id: "m1", fullName: "Meera Iyer", avatarUrl: null };

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
    const lastMessage = { seq: 1, body: "Hello there", mine: false, createdAt: NOW.toISOString() };
    expect(conversationPreview({ state: "REQUEST_RECEIVED", lastMessage })).toBe("Wants to send you a message");
    expect(conversationPreview({ state: "REQUEST_SENT", lastMessage: { ...lastMessage, mine: true } })).toBe("Request sent");
    expect(conversationPreview({ state: "ACCEPTED", lastMessage })).toBe("Hello there");
    expect(conversationPreview({ state: "ACCEPTED", lastMessage: { ...lastMessage, mine: true } })).toBe("You: Hello there");
    expect(conversationPreview({ state: "ACCEPTED", lastMessage: { ...lastMessage, body: null } })).toBe("This message was removed");
    expect(conversationPreview({ state: "CLOSED", lastMessage: null })).toBe("Conversation closed");
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
