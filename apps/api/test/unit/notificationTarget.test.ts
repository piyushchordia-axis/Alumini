import { CHAT_PUSH_KINDS, CONFIGURABLE_CATEGORIES, NOTIFICATION_CATEGORY, NOTIFICATION_CATEGORY_INFO, NOTIFICATION_TYPES, TENANT_FEATURES, memberRequestOf, notificationLevelFor, notificationTarget, resolveNotificationPrefs, visibleNotificationCategories, type TenantFeature, type TenantFeatures } from "@illuminize/shared";
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

  it("opens the thread from every chat push about a conversation the member is in, and from nothing else without one", () => {
    for (const kind of CHAT_PUSH_KINDS.filter((k) => k !== "CHAT_GROUP_INVITE")) {
      expect(notificationTarget(kind, { conversationId: "c1", tenantSlug: "demo" }), kind).toEqual({ kind: "chat", conversationId: "c1" });
      expect(notificationTarget(kind, {}), kind).toBeNull();
    }
  });

  it("opens Invitations from a group invitation, never the group, which the invitee isn't in yet", () => {
    expect(notificationTarget("CHAT_GROUP_INVITE", { conversationId: "g1", tenantSlug: "demo" })).toEqual({ kind: "chatGroup", view: "invitations" });
    expect(notificationTarget("CHAT_GROUP_INVITE", {})).toEqual({ kind: "chatGroup", view: "invitations" });
  });

  it("routes Wave 1 notifications", () => {
    expect(notificationTarget("ANNOUNCEMENT", { postId: "p9" })).toEqual({ kind: "post", id: "p9" });
    expect(notificationTarget("CELEBRATION", { kind: "BIRTHDAY" })).toEqual({ kind: "celebrations" });
    expect(notificationTarget("CELEBRATION_WISH", {})).toEqual({ kind: "celebrations" });
  });

  it("sends a removed item to My posts, because its page 404s for the author", () => {
    for (const contentType of ["POST", "JOB", "FUNDING", "EVENT", "BUSINESS"]) {
      expect(notificationTarget("CONTENT_REMOVED", { contentType, contentId: "x1", status: "REMOVED" })).toStrictEqual({ kind: "myContent" });
    }
    expect(notificationTarget("CONTENT_REMOVED", { contentType: "COMMENT", contentId: "c1" })).toEqual({ kind: "myContent" });
  });

  it("sends a group's owner to the Groups tab of My posts for its review, never into its conversation", () => {
    for (const type of ["CONTENT_APPROVED", "CONTENT_REJECTED", "CONTENT_REMOVED"] as const) {
      expect(notificationTarget(type, { contentType: "GROUP", contentId: "g1", status: "APPROVED" }), type).toStrictEqual({ kind: "myContent", tab: "groups" });
    }
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

describe("chat push kinds", () => {
  it("stay out of the stored types, so none can ever land in the bell", () => {
    for (const kind of CHAT_PUSH_KINDS) {
      expect(NOTIFICATION_TYPES as readonly string[], kind).not.toContain(kind);
      expect(Object.hasOwn(NOTIFICATION_CATEGORY, kind), kind).toBe(false);
    }
  });
});

describe("the CHAT category", () => {
  const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;

  it("is called Messages and can't go below in-app", () => {
    expect(NOTIFICATION_CATEGORY_INFO.CHAT).toMatchObject({ label: "Messages", minLevel: "IN_APP" });
    expect(CONFIGURABLE_CATEGORIES).toContain("CHAT");
    expect(resolveNotificationPrefs({ categories: { CHAT: "OFF" } }).categories.CHAT).toBe("IN_APP");
    expect(resolveNotificationPrefs(null).categories.CHAT).toBe("IN_APP_PUSH");
  });

  it("isn't what any stored notification files under", () => {
    expect(Object.values(NOTIFICATION_CATEGORY)).not.toContain("CHAT");
  });

  it("shows only where the member can use chat", () => {
    const categories = (features: TenantFeatures, chatEligible: boolean) => visibleNotificationCategories({ features, chatEligible, isTenantAdmin: false });
    expect(categories(only("messaging"), true)).toContain("CHAT");
    expect(categories(only("messaging"), false)).not.toContain("CHAT");
    // Group messages and invitations push under it too.
    expect(categories(only("groups"), true)).toContain("CHAT");
    expect(categories(only("groups"), false)).not.toContain("CHAT");
    expect(categories(only("feed"), true)).not.toContain("CHAT");
    expect(categories(only(), false)).not.toContain("CHAT");
  });

  it("leaves the other categories as they were, with admin work only for admins", () => {
    const all = only(...TENANT_FEATURES);
    expect(visibleNotificationCategories({ features: all, chatEligible: true, isTenantAdmin: false })).toEqual(["ACTIVITY", "CHAT", "CONNECTIONS", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS"]);
    expect(visibleNotificationCategories({ features: all, chatEligible: true, isTenantAdmin: true })).toEqual(["ACTIVITY", "CHAT", "CONNECTIONS", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"]);
    expect(visibleNotificationCategories({ features: only(), chatEligible: false, isTenantAdmin: true })).toEqual(["ACTIVITY", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"]);
  });
});

describe("the CONNECTIONS category", () => {
  const only = (...on: TenantFeature[]) => Object.fromEntries(TENANT_FEATURES.map((f) => [f, on.includes(f)])) as TenantFeatures;
  const categories = (features: TenantFeatures, chatEligible: boolean) => visibleNotificationCategories({ features, chatEligible, isTenantAdmin: false });

  it("is called Mentorship and referrals, can be turned off, and holds every mentorship and referral notification", () => {
    expect(NOTIFICATION_CATEGORY_INFO.CONNECTIONS).toMatchObject({ label: "Mentorship and referrals", minLevel: "OFF" });
    expect(NOTIFICATION_CATEGORY_INFO.CONNECTIONS.description).toMatch(/refer/);
    for (const type of ["MENTORSHIP_REQUESTED", "MENTORSHIP_ACCEPTED", "MENTORSHIP_DECLINED", "MENTORSHIP_ENDED", "REFERRAL_REQUESTED", "REFERRAL_ACCEPTED", "REFERRAL_DECLINED"] as const) {
      expect(NOTIFICATION_CATEGORY[type], type).toBe("CONNECTIONS");
      expect(notificationLevelFor(type, { categories: { CONNECTIONS: "OFF" } }), type).toBe("OFF");
      expect(notificationLevelFor(type, null), type).toBe("IN_APP_PUSH");
    }
  });

  it("shows while mentorship or referrals are on, both of which need messaging, for a member who can use them", () => {
    expect(categories(only("mentorship", "messaging"), true)).toContain("CONNECTIONS");
    expect(categories(only("mentorship", "messaging"), false)).not.toContain("CONNECTIONS");
    expect(categories(only("mentorship"), true)).not.toContain("CONNECTIONS");
    // Referrals alone: jobs and messaging, with mentorship off.
    expect(categories(only("messaging", "jobs"), true)).toContain("CONNECTIONS");
    expect(categories(only("messaging", "jobs"), false)).not.toContain("CONNECTIONS");
    expect(categories(only("jobs"), true)).not.toContain("CONNECTIONS");
    expect(categories(only("messaging", "groups"), true)).not.toContain("CONNECTIONS");
  });
});

describe("referral notifications", () => {
  it("open the request's own list on Jobs' Referrals tab, received for the poster and sent for the one who asked", () => {
    expect(notificationTarget("REFERRAL_REQUESTED", { referralId: "r1", jobId: "j1", box: "received" })).toEqual({ kind: "referral", box: "received" });
    expect(notificationTarget("REFERRAL_DECLINED", { referralId: "r1", box: "sent" })).toEqual({ kind: "referral", box: "sent" });
  });

  it("fall back to the side each type is usually about, and ignore a box they don't know", () => {
    expect(notificationTarget("REFERRAL_REQUESTED", {})).toEqual({ kind: "referral", box: "received" });
    expect(notificationTarget("REFERRAL_DECLINED", { box: "SENT" })).toEqual({ kind: "referral", box: "sent" });
    expect(notificationTarget("REFERRAL_DECLINED", { box: "__proto__" })).toEqual({ kind: "referral", box: "sent" });
  });

  it("open the chat an acceptance opened, or the sender's list without one", () => {
    expect(notificationTarget("REFERRAL_ACCEPTED", { referralId: "r1", conversationId: "c1", box: "sent" })).toEqual({ kind: "chat", conversationId: "c1" });
    expect(notificationTarget("REFERRAL_ACCEPTED", { referralId: "r1" })).toEqual({ kind: "referral", box: "sent" });
  });
});

describe("mentorship notifications", () => {
  it("open the request's own list, received for the mentor and sent for the mentee", () => {
    expect(notificationTarget("MENTORSHIP_REQUESTED", { mentorshipId: "m1", box: "received" })).toEqual({ kind: "mentorship", box: "received" });
    expect(notificationTarget("MENTORSHIP_DECLINED", { mentorshipId: "m1", box: "sent" })).toEqual({ kind: "mentorship", box: "sent" });
    expect(notificationTarget("MENTORSHIP_ENDED", { mentorshipId: "m1", box: "received" })).toEqual({ kind: "mentorship", box: "received" });
    expect(notificationTarget("MENTORSHIP_ENDED", { mentorshipId: "m1", box: "sent" })).toEqual({ kind: "mentorship", box: "sent" });
  });

  it("fall back to the side each type is usually about, and ignore a box they don't know", () => {
    expect(notificationTarget("MENTORSHIP_REQUESTED", {})).toEqual({ kind: "mentorship", box: "received" });
    expect(notificationTarget("MENTORSHIP_DECLINED", { box: "RECEIVED" })).toEqual({ kind: "mentorship", box: "sent" });
    expect(notificationTarget("MENTORSHIP_ENDED", { box: "constructor" })).toEqual({ kind: "mentorship", box: "sent" });
  });

  it("open the chat an acceptance opened, or the mentee's list without one", () => {
    expect(notificationTarget("MENTORSHIP_ACCEPTED", { mentorshipId: "m1", conversationId: "c1", box: "sent" })).toEqual({ kind: "chat", conversationId: "c1" });
    expect(notificationTarget("MENTORSHIP_ACCEPTED", { mentorshipId: "m1" })).toEqual({ kind: "mentorship", box: "sent" });
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

describe("memberRequestOf", () => {
  const subject = { kind: "membership", membershipId: "8a8f8e44-0c3e-4a4b-9a1e-2a7c3f1b5d10", fullName: "Asha Rao", status: "PENDING" } as const;

  it("gives the request a new-member notice carries, and nothing for any other notice or one sent without it", () => {
    expect(memberRequestOf({ type: "NEW_MEMBER_PENDING", subject })).toBe(subject);
    expect(memberRequestOf({ type: "NEW_MEMBER_PENDING", subject: { ...subject, fullName: null, status: null } })).toEqual({ ...subject, fullName: null, status: null });
    // A member's list and every realtime event come without one.
    expect(memberRequestOf({ type: "NEW_MEMBER_PENDING" })).toBeNull();
    for (const type of NOTIFICATION_TYPES.filter((t) => t !== "NEW_MEMBER_PENDING")) expect(memberRequestOf({ type, subject }), type).toBeNull();
    expect(memberRequestOf({ type: "NEW_MEMBER_PENDING", subject: { ...subject, kind: "post" } as never })).toBeNull();
  });
});
