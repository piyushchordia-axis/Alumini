import { notificationTarget } from "@illuminize/shared";
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
});
