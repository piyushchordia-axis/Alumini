import { notificationLevelFor, notificationTarget, resolveNotificationPrefs } from "@illuminize/shared";
import { describe, expect, it } from "vitest";

describe("notificationTarget", () => {
  it("opens the post, event or listing a notification is about", () => {
    expect(notificationTarget("POST_COMMENT", { postId: "p1" })).toEqual({ kind: "post", id: "p1" });
    expect(notificationTarget("EVENT_UPDATED", { eventId: "e1" })).toEqual({ kind: "event", id: "e1" });
    expect(notificationTarget("CONTENT_APPROVED", { contentType: "JOB", contentId: "j1" })).toEqual({ kind: "job", id: "j1" });
    expect(notificationTarget("CONTENT_REJECTED", { contentType: "FUNDING", contentId: "f1" })).toEqual({ kind: "funding", id: "f1" });
    expect(notificationTarget("CONTENT_REMOVED", { contentType: "COMMENT", contentId: "c1", postId: "p2" })).toEqual({ kind: "post", id: "p2" });
  });

  it("falls back sensibly", () => {
    expect(notificationTarget("CONTENT_REMOVED", {})).toEqual({ kind: "myContent" });
    expect(notificationTarget("MEMBERSHIP_APPROVED", null)).toEqual({ kind: "profile" });
    expect(notificationTarget("REPORT_FILED", {})).toEqual({ kind: "admin", section: "reports" });
    expect(notificationTarget("EVENT_RSVP", {})).toBeNull();
    expect(notificationTarget("SYSTEM", "not an object")).toBeNull();
  });

  it("routes Wave 1 notifications", () => {
    expect(notificationTarget("ANNOUNCEMENT", { postId: "p9" })).toEqual({ kind: "post", id: "p9" });
    expect(notificationTarget("CELEBRATION", { kind: "BIRTHDAY" })).toEqual({ kind: "celebrations" });
    expect(notificationTarget("CELEBRATION_WISH", {})).toEqual({ kind: "celebrations" });
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
