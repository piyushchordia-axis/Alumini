import { NOTIFICATION_CATEGORY, NOTIFICATION_TYPES, notificationLevelFor, notificationTarget, resolveNotificationPrefs } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("notificationTarget", () => {
  it("opens the post, event or listing a notification is about", () => {
    expect(notificationTarget("POST_COMMENT", { postId: "p1" })).toEqual({ kind: "post", id: "p1" });
    expect(notificationTarget("EVENT_UPDATED", { eventId: "e1" })).toEqual({ kind: "event", id: "e1" });
    expect(notificationTarget("CONTENT_APPROVED", { contentType: "JOB", contentId: "j1" })).toEqual({ kind: "job", id: "j1" });
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "FUNDING", contentId: "f1" })).toEqual({ kind: "funding", id: "f1" });
    expect(notificationTarget("CONTENT_REMOVED", { contentType: "COMMENT", contentId: "c1", postId: "p2" })).toEqual({ kind: "post", id: "p2" });
  });

  it("opens a business listing, including from a stored SYSTEM notice", () => {
    expect(notificationTarget("CONTENT_APPROVED", { contentType: "BUSINESS", contentId: "b1" })).toEqual({ kind: "business", id: "b1" });
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "BUSINESS", contentId: "b1" })).toEqual({ kind: "business", id: "b1" });
    expect(notificationTarget("SYSTEM", { contentType: "BUSINESS", contentId: "b1" })).toEqual({ kind: "business", id: "b1" });
  });

  it("falls back sensibly", () => {
    expect(notificationTarget("CONTENT_REMOVED", {})).toEqual({ kind: "myContent" });
    expect(notificationTarget("MEMBERSHIP_APPROVED", null)).toEqual({ kind: "profile" });
    expect(notificationTarget("REPORT_FILED", {})).toEqual({ kind: "admin", section: "reports" });
    expect(notificationTarget("EVENT_RSVP", {})).toBeNull();
    expect(notificationTarget("SYSTEM", "not an object")).toBeNull();
  });

  it("sends a chat report to the admin page that holds it, as an admin notification", () => {
    expect(notificationTarget("CHAT_REPORT_FILED", { chatReportId: "r1" })).toEqual({ kind: "admin", section: "chat-reports" });
    expect(notificationTarget("CHAT_REPORT_FILED", {})).toEqual({ kind: "admin", section: "chat-reports" });
    expect(NOTIFICATION_CATEGORY.CHAT_REPORT_FILED).toBe("ADMIN");
  });

  it("points a removed message at its thread, and counts it among a member's own account notices", () => {
    expect(notificationTarget("CHAT_MESSAGE_REMOVED", { conversationId: "c1", messageId: "m1" })).toEqual({ kind: "chat", conversationId: "c1" });
    expect(notificationTarget("CHAT_MESSAGE_REMOVED", {})).toBeNull();
    expect(NOTIFICATION_CATEGORY.CHAT_MESSAGE_REMOVED).toBe("ACCOUNT");
  });

  it("routes Wave 1 notifications", () => {
    expect(notificationTarget("ANNOUNCEMENT", { postId: "p9" })).toEqual({ kind: "post", id: "p9" });
    expect(notificationTarget("CELEBRATION", { kind: "BIRTHDAY" })).toEqual({ kind: "celebrations" });
    expect(notificationTarget("CELEBRATION_WISH", {})).toEqual({ kind: "celebrations" });
  });

  it("sends a removed item to My posts, because its page 404s for the author", () => {
    for (const contentType of ["POST", "JOB", "FUNDING", "EVENT", "BUSINESS"]) {
      expect(notificationTarget("CONTENT_REMOVED", { contentType, contentId: "x1", status: "REMOVED" })).toEqual({ kind: "myContent" });
    }
    expect(notificationTarget("CONTENT_REMOVED", { contentType: "COMMENT", contentId: "c1" })).toEqual({ kind: "myContent" });
  });

  it("keeps a rejected item on its own page, which its author can still open", () => {
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "POST", contentId: "p1" })).toEqual({ kind: "post", id: "p1" });
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "JOB", contentId: "j1" })).toEqual({ kind: "job", id: "j1" });
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "EVENT", contentId: "e1" })).toEqual({ kind: "event", id: "e1" });
    expect(notificationTarget("CONTENT_REJECTED", {})).toEqual({ kind: "myContent" });
  });

  it("answers null, without throwing, for any string that isn't a notification type", () => {
    for (const type of ["", "SOMETHING_NEW", "constructor", "toString", "hasOwnProperty", "__proto__"]) {
      expect(notificationTarget(type, { postId: "p1", contentType: "POST", contentId: "p1" })).toBeNull();
    }
  });

  it("gives every notification type a destination when its payload is complete, and doesn't throw when it's empty", () => {
    const payload = { postId: "p1", eventId: "e1", contentType: "POST", contentId: "c1", conversationId: "t1" };
    for (const type of NOTIFICATION_TYPES) {
      expect(notificationTarget(type, payload), type).not.toBeNull();
      expect(() => notificationTarget(type, {})).not.toThrow();
    }
  });

  it("keeps SYSTEM notices routed by what they carry", () => {
    expect(notificationTarget("SYSTEM", { contentType: "JOB", contentId: "j1" })).toEqual({ kind: "job", id: "j1" });
    expect(notificationTarget("SYSTEM", { postId: "p1" })).toEqual({ kind: "post", id: "p1" });
    expect(notificationTarget("SYSTEM", {})).toBeNull();
  });
});

describe("notification preferences", () => {
  it("defaults to in-app and push, keeps account notices on, and never lets announcements go below in-app", () => {
    expect(notificationLevelFor("POST_COMMENT", null)).toBe("IN_APP_PUSH");
    expect(notificationLevelFor("POST_COMMENT", { categories: { ACTIVITY: "OFF" } })).toBe("OFF");
    expect(notificationLevelFor("MEMBERSHIP_SUSPENDED", { categories: { ACTIVITY: "OFF" } })).toBe("IN_APP_PUSH");
    expect(notificationLevelFor("ANNOUNCEMENT", { categories: { ANNOUNCEMENTS: "OFF" } })).toBe("IN_APP");
    expect(resolveNotificationPrefs({ digestEmail: false })).toMatchObject({ digestEmail: false, announcementMessages: true, celebrationsNoticeSeenAt: null });
  });
});
