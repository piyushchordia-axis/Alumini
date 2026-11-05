import { ADMIN_SECTIONS, MOBILE_ADMIN_SECTIONS, NOTIFICATION_TYPES, adminKeys, isAdminNotification } from "@illuminize/shared";
import { ApiClientError } from "@illuminize/shared/client";
import { describe, expect, it } from "vitest";
import { adminHomeHref, adminSectionHref, isPushAdminOf, isStoredAdminOf, membershipToRefetch, opensInPlace } from "../../../mobile/src/lib/admin";
import { notificationHref } from "../../../mobile/src/lib/notificationLinks";
import { qk } from "../../../mobile/src/lib/queryKeys";

const ID = "3f2b8a4e-9c1d-4e5f-8a7b-0c1d2e3f4a5b";

/** The payload each admin notice is sent with (membership.service, content.common, reports.service, chat reports). */
const ADMIN_PAYLOADS: Record<string, Record<string, string>> = {
  NEW_MEMBER_PENDING: { membershipId: ID },
  CONTENT_PENDING: { contentType: "POST", contentId: ID },
  REPORT_FILED: { reportId: ID, contentType: "POST", contentId: ID },
  CHAT_REPORT_FILED: { chatReportId: ID },
};

describe("notificationHref in the phone app", () => {
  it("opens the members waiting from a request to join, and the console's home from every other admin notice, for an admin", () => {
    const adminTypes = NOTIFICATION_TYPES.filter(isAdminNotification);
    expect(adminTypes).toEqual(Object.keys(ADMIN_PAYLOADS));
    for (const type of adminTypes) {
      const href = type === "NEW_MEMBER_PENDING" ? "/t/demo/admin/members?status=PENDING" : "/t/demo/admin";
      expect(notificationHref("demo", type, ADMIN_PAYLOADS[type], { isAdmin: true }), type).toBe(href);
      expect(notificationHref("demo", type, {}, { isAdmin: true }), type).toBe(href);
    }
  });

  it("opens nothing from an admin notice for someone who isn't an admin, such as one demoted since", () => {
    for (const type of Object.keys(ADMIN_PAYLOADS)) expect(notificationHref("demo", type, ADMIN_PAYLOADS[type], { isAdmin: false }), type).toBeNull();
  });

  it("opens a member's notices the same whether or not they're an admin", () => {
    for (const isAdmin of [true, false]) {
      expect(notificationHref("demo", "POST_COMMENT", { postId: "p1" }, { isAdmin })).toBe("/t/demo/feed/p1");
      expect(notificationHref("demo", "MEMBERSHIP_APPROVED", {}, { isAdmin })).toBe("/t/demo/profile");
      expect(notificationHref("demo", "EVENT_RSVP", {}, { isAdmin })).toBeNull();
    }
  });
});

describe("the phone console's links", () => {
  it("open the console's home for the Dashboard, and nothing for a section that is only on the web console", () => {
    expect(adminHomeHref("demo")).toBe("/t/demo/admin");
    expect(adminSectionHref("demo", "dashboard")).toBe("/t/demo/admin");
    for (const { key } of ADMIN_SECTIONS.filter((s) => !MOBILE_ADMIN_SECTIONS.includes(s.key))) expect(adminSectionHref("demo", key), key).toBeNull();
  });

  it("put a section at the web console's path, with its query", () => {
    for (const { key, path } of ADMIN_SECTIONS.filter((s) => s.key !== "dashboard" && MOBILE_ADMIN_SECTIONS.includes(s.key))) {
      expect(adminSectionHref("demo", key), key).toBe(`/t/demo/admin/${path}`);
    }
    expect(adminSectionHref("demo", "dashboard", { status: "PENDING", q: "a b&c" })).toBe("/t/demo/admin?status=PENDING&q=a%20b%26c");
    // The console home's Pending members tile, now that Members is in the phone app.
    expect(adminSectionHref("demo", "members", { status: "PENDING" })).toBe("/t/demo/admin/members?status=PENDING");
  });
});

describe("isStoredAdminOf", () => {
  const membership = (slug: string, role: "MEMBER" | "TENANT_ADMIN") => ({ role, tenant: { slug } });
  const member = { isPlatformAdmin: false };

  it("is true for the institution's admin, and only at that institution", () => {
    const session = { user: member, memberships: [membership("demo", "TENANT_ADMIN"), membership("other", "MEMBER")] };
    expect(isStoredAdminOf(session, "demo")).toBe(true);
    expect(isStoredAdminOf(session, "other")).toBe(false);
    expect(isStoredAdminOf(session, "elsewhere")).toBe(false);
  });

  it("is true for Illuminize staff, as the app's own guard decides", () => {
    expect(isStoredAdminOf({ user: { isPlatformAdmin: true }, memberships: [membership("demo", "MEMBER")] }, "demo")).toBe(true);
    expect(isStoredAdminOf({ user: { isPlatformAdmin: true }, memberships: [] }, "demo")).toBe(true);
  });

  it("is false for a member, and with no session", () => {
    expect(isStoredAdminOf({ user: member, memberships: [membership("demo", "MEMBER")] }, "demo")).toBe(false);
    expect(isStoredAdminOf({ user: null, memberships: [] }, "demo")).toBe(false);
  });
});

describe("isPushAdminOf", () => {
  const stored = (role: "MEMBER" | "TENANT_ADMIN", isPlatformAdmin = false) => ({ user: { isPlatformAdmin }, memberships: [{ role, tenant: { slug: "demo" } }] });

  it("goes by the loaded membership when there is one, as the console's guard does, whatever the stored session says", () => {
    // Promoted since the session was stored: the push opens the console.
    expect(isPushAdminOf(stored("MEMBER"), { role: "TENANT_ADMIN", status: "APPROVED" }, "demo")).toBe(true);
    // Demoted since: it doesn't, so the guard has nothing to send back.
    expect(isPushAdminOf(stored("TENANT_ADMIN"), { role: "MEMBER", status: "APPROVED" }, "demo")).toBe(false);
    // Staff with an approved membership, by the (app) layout's rule; never a membership that isn't approved.
    expect(isPushAdminOf(stored("MEMBER", true), { role: "MEMBER", status: "APPROVED" }, "demo")).toBe(true);
    expect(isPushAdminOf(stored("TENANT_ADMIN"), { role: "TENANT_ADMIN", status: "SUSPENDED" }, "demo")).toBe(false);
  });

  it("goes by the stored session on a cold start, before the membership has loaded", () => {
    expect(isPushAdminOf(stored("TENANT_ADMIN"), undefined, "demo")).toBe(true);
    expect(isPushAdminOf(stored("MEMBER"), undefined, "demo")).toBe(false);
  });
});

describe("opensInPlace", () => {
  it("is true with the push's institution on screen, or none (the start screen on a cold start)", () => {
    expect(opensInPlace("/", "demo")).toBe(true);
    expect(opensInPlace("/t/demo/admin", "demo")).toBe(true);
    expect(opensInPlace("/t/demo/feed", "demo")).toBe(true);
    expect(opensInPlace("/t/demo", "demo")).toBe(true);
  });

  it("is false with another institution on screen, whose stack the push goes above", () => {
    expect(opensInPlace("/t/other/feed", "demo")).toBe(false);
    expect(opensInPlace("/t/demo-college/admin", "demo")).toBe(false);
  });
});

describe("membershipToRefetch", () => {
  const refused = new ApiClientError(403, "FORBIDDEN", "Institution administrator access required");

  it("fetches the membership again when any admin query of the institution is refused", () => {
    const keys = [adminKeys.dashboard("demo"), adminKeys.analytics("demo", 12), adminKeys.members("demo", { status: "PENDING" }), adminKeys.member("demo", "m1"), adminKeys.moderation("demo"), adminKeys.content("demo", "POST", "p1"), adminKeys.reports("demo"), adminKeys.chatReports("demo"), adminKeys.settings("demo"), adminKeys.profileFields("demo"), adminKeys.invitations("demo"), adminKeys.invitationSummary("demo"), adminKeys.audit("demo"), adminKeys.announcementAudience("demo")];
    expect(keys).toHaveLength(Object.keys(adminKeys).length);
    for (const key of keys) expect(membershipToRefetch(refused, key), key.join("/")).toEqual(qk.membership("demo"));
  });

  it("leaves it for other failures, and for other queries refused", () => {
    for (const status of [400, 401, 404, 429, 500, 0]) expect(membershipToRefetch(new ApiClientError(status, "INTERNAL", "e"), adminKeys.dashboard("demo")), String(status)).toBeNull();
    expect(membershipToRefetch(Object.assign(new Error("not the API's"), { status: 403 }), adminKeys.dashboard("demo"))).toBeNull();
    expect(membershipToRefetch(refused, qk.membership("demo"))).toBeNull();
    expect(membershipToRefetch(refused, ["posts", "demo"])).toBeNull();
    expect(membershipToRefetch(refused, ["admin"])).toBeNull();
  });
});
