import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_SECTIONS,
  CHAT_PUSH_KINDS,
  CONTENT_TYPES,
  MEMBERSHIP_STATUSES,
  MEMBER_STATUS_TONE,
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABELS,
  MODERATION_STATUSES,
  MODERATION_STATUS_TONE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  adminKeys,
  adminWaitingCount,
  canPin,
  channelName,
  dedupeById,
  fieldErrorsFrom,
  formatCalendarDate,
  formatCount,
  isAdminNotification,
  memberActionsFor,
  moderationActionsFor,
  pagedNext,
  tenantKeyPredicate,
  type AdminSection,
  type AdminSectionPath,
  type DashboardDto,
  type MemberAdminAction,
  type ContentAction,
} from "@illuminize/shared";
import { ApiClientError, isOutOfDate, unlessOutOfDate } from "@illuminize/shared/client";
import { QueryClient } from "@tanstack/query-core";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { availableAdminActions, canTransitionMembership } from "../../src/services/approval";
import { availableModerationActions, canTransitionContent } from "../../src/services/moderation";

const ROOT = resolve(fileURLToPath(import.meta.url), "../../../../..");

describe("adminKeys", () => {
  it("are the web console's keys, plus the two it wrote inline", () => {
    const filters = { status: "PENDING", page: 2 };
    expect(adminKeys.dashboard("demo")).toEqual(["admin", "demo", "dashboard"]);
    expect(adminKeys.analytics("demo", 12)).toEqual(["admin", "demo", "analytics", 12]);
    expect(adminKeys.members("demo")).toEqual(["admin", "demo", "members", {}]);
    expect(adminKeys.members("demo", filters)).toEqual(["admin", "demo", "members", filters]);
    expect(adminKeys.member("demo", "m1")).toEqual(["admin", "demo", "member", "m1"]);
    expect(adminKeys.moderation("demo", filters)).toEqual(["admin", "demo", "moderation", filters]);
    expect(adminKeys.content("demo", "POST", "p1")).toEqual(["admin", "demo", "content", "POST", "p1"]);
    expect(adminKeys.reports("demo")).toEqual(["admin", "demo", "reports", {}]);
    expect(adminKeys.chatReports("demo", filters)).toEqual(["admin", "demo", "chat-reports", filters]);
    expect(adminKeys.settings("demo")).toEqual(["admin", "demo", "settings"]);
    expect(adminKeys.profileFields("demo")).toEqual(["admin", "demo", "profile-fields"]);
    expect(adminKeys.invitations("demo", filters)).toEqual(["admin", "demo", "invitations", filters]);
    expect(adminKeys.invitationSummary("demo")).toEqual(["admin", "demo", "invitations", "summary"]);
    expect(adminKeys.audit("demo")).toEqual(["admin", "demo", "audit", {}]);
    expect(adminKeys.announcementAudience("demo")).toEqual(["admin", "demo", "announcement-audience"]);
    expect(Object.keys(adminKeys)).toHaveLength(14);
  });

  it("all carry the slug second, so the institution's invalidation reaches every one", () => {
    const predicate = tenantKeyPredicate("demo");
    const keys = [
      adminKeys.dashboard("demo"),
      adminKeys.analytics("demo", 26),
      adminKeys.members("demo"),
      adminKeys.member("demo", "m1"),
      adminKeys.moderation("demo"),
      adminKeys.content("demo", "GROUP", "g1"),
      adminKeys.reports("demo"),
      adminKeys.chatReports("demo"),
      adminKeys.settings("demo"),
      adminKeys.profileFields("demo"),
      adminKeys.invitations("demo"),
      adminKeys.invitationSummary("demo"),
      adminKeys.audit("demo"),
      adminKeys.announcementAudience("demo"),
    ];
    expect(keys).toHaveLength(Object.keys(adminKeys).length);
    for (const queryKey of keys) expect(predicate({ queryKey }), String(queryKey)).toBe(true);
  });
});

describe("tenantKeyPredicate", () => {
  it("marks one institution's queries stale in a real cache, and nobody else's", async () => {
    const client = new QueryClient();
    const mine = [adminKeys.dashboard("demo"), adminKeys.members("demo", { status: "PENDING" }), ["posts", "demo", {}], ["membership", "demo"]];
    const others = [adminKeys.dashboard("demo-college"), ["posts", "demo-college", {}], ["tenants"], ["me"], ["platform", "tenants", {}]];
    for (const key of [...mine, ...others]) client.setQueryData(key, { cached: true });
    await client.invalidateQueries({ predicate: tenantKeyPredicate("demo") });
    for (const key of mine) expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(true);
    for (const key of others) expect(client.getQueryState(key)?.isInvalidated, String(key)).toBe(false);
  });
});

/** NavIconName's members as one app's icons.tsx declares them. */
function navIconNames(app: "web" | "mobile"): string[] {
  const source = readFileSync(resolve(ROOT, `apps/${app}/src/components/icons.tsx`), "utf8");
  const union = /export type NavIconName =([^;]+);/.exec(source)?.[1];
  if (!union) throw new Error(`no NavIconName in the ${app} icons`);
  return [...union.matchAll(/"(\w+)"/g)].map((m) => m[1]!);
}

describe("ADMIN_SECTIONS", () => {
  it("are the web nav's sections in its order, with its icons, and no Branding", () => {
    expect(ADMIN_SECTIONS.map((s) => [s.label, s.path, s.icon])).toEqual([
      ["Dashboard", "dashboard", "dashboard"],
      ["Analytics", "analytics", "analytics"],
      ["Members", "members", "directory"],
      ["Moderation", "moderation", "admin"],
      ["Reports", "reports", "flag"],
      ["Chat reports", "chat-reports", "messages"],
      ["Invitations", "invitations", "mail"],
      ["Profile fields", "profile-fields", "fields"],
      ["Settings", "settings", "settings"],
      ["Audit log", "audit", "audit"],
    ]);
    expect(new Set(ADMIN_SECTIONS.map((s) => s.key)).size).toBe(ADMIN_SECTIONS.length);
  });

  it("show the waiting counts on Members, Moderation and both kinds of report", () => {
    expect(ADMIN_SECTIONS.filter((s) => s.countKey).map((s) => [s.key, s.countKey])).toEqual([
      ["members", "pendingMembers"],
      ["moderation", "pendingContent"],
      ["reports", "openReports"],
      ["chatReports", "openChatReports"],
    ]);
  });

  it.each(["web", "mobile"] as const)("use only icons the %s app's NavIcon draws", (app) => {
    const names = navIconNames(app);
    for (const s of ADMIN_SECTIONS) expect(names, s.label).toContain(s.icon);
  });

  it("link to the web console's own routes, each typed as one of them rather than any string", () => {
    const source = readFileSync(resolve(ROOT, "apps/web/src/router.admin.tsx"), "utf8");
    const consoleRoutes = /export const adminRoutes[\s\S]*?export const platformRoutes/.exec(source)?.[0];
    if (!consoleRoutes) throw new Error("no adminRoutes in the web router");
    const routes = [...consoleRoutes.matchAll(/path: "([^"]+)"/g)].map((m) => m[1]);
    for (const s of ADMIN_SECTIONS) expect(routes, s.label).toContain(s.path);
    // A later slice maps each path to the phone's route (whose Dashboard is admin/index), so it must stay a literal.
    expectTypeOf<AdminSection["path"]>().toEqualTypeOf<AdminSectionPath>();
    expectTypeOf<AdminSectionPath>().toEqualTypeOf<"dashboard" | "analytics" | "members" | "moderation" | "reports" | "chat-reports" | "invitations" | "profile-fields" | "settings" | "audit">();
  });
});

describe("adminWaitingCount", () => {
  const dashboard: DashboardDto = {
    pendingMembers: 1,
    approvedMembers: 500,
    rejectedMembers: 60,
    suspendedMembers: 7,
    newMembersLast30d: 80,
    activeMembersLast30d: 300,
    pendingContent: 2,
    openReports: 3,
    openChatReports: 4,
    upcomingEvents: 9,
    postsLast7d: 40,
  };

  it("adds up the members, content and reports waiting, and nothing else", () => {
    expect(adminWaitingCount(dashboard)).toBe(10);
  });

  it("is what the sections' own counts add up to", () => {
    const shown = ADMIN_SECTIONS.reduce((n, s) => n + (s.countKey ? dashboard[s.countKey] : 0), 0);
    expect(adminWaitingCount(dashboard)).toBe(shown);
  });

  it("is 0 when nothing waits", () => {
    expect(adminWaitingCount({ pendingMembers: 0, pendingContent: 0, openReports: 0, openChatReports: 0 })).toBe(0);
  });
});

describe("memberActionsFor", () => {
  it("offers each status's admin actions", () => {
    expect(memberActionsFor("PENDING")).toEqual(["approve", "reject"]);
    expect(memberActionsFor("APPROVED")).toEqual(["suspend"]);
    expect(memberActionsFor("REJECTED")).toEqual(["approve"]);
    expect(memberActionsFor("SUSPENDED")).toEqual(["reinstate"]);
  });

  it("is the API's own machine: what it offers is what the API allows, and nothing the API allows is left out", () => {
    const adminActions: MemberAdminAction[] = ["approve", "reject", "suspend", "reinstate"];
    for (const status of MEMBERSHIP_STATUSES) {
      expect(availableAdminActions(status)).toEqual(memberActionsFor(status));
      for (const action of adminActions) expect(memberActionsFor(status).includes(action), `${status}:${action}`).toBe(canTransitionMembership(status, action));
    }
  });

  it("never offers reapply, which is the member's own", () => {
    expect(canTransitionMembership("REJECTED", "reapply")).toBe(true);
    for (const status of MEMBERSHIP_STATUSES) expect(memberActionsFor(status)).not.toContain("reapply");
  });
});

describe("moderationActionsFor", () => {
  it("offers each status's actions, in the order approve, reject, remove, restore", () => {
    expect(moderationActionsFor("PENDING")).toEqual(["approve", "reject"]);
    expect(moderationActionsFor("REJECTED")).toEqual(["approve"]);
    expect(moderationActionsFor("APPROVED")).toEqual(["remove"]);
    expect(moderationActionsFor("REMOVED")).toEqual(["restore"]);
  });

  it("is the API's own machine", () => {
    const actions: ContentAction[] = ["approve", "reject", "remove", "restore"];
    for (const status of MODERATION_STATUSES) {
      expect(availableModerationActions(status)).toEqual(moderationActionsFor(status));
      for (const action of actions) expect(moderationActionsFor(status).includes(action), `${status}:${action}`).toBe(canTransitionContent(status, action));
    }
  });
});

describe("canPin", () => {
  it("is true only for a published post", () => {
    for (const type of CONTENT_TYPES) {
      for (const status of MODERATION_STATUSES) expect(canPin(type, status), `${type} ${status}`).toBe(type === "POST" && status === "APPROVED");
    }
  });
});

describe("isAdminNotification", () => {
  it("is the ADMIN category, which is the four notices the web console refreshed on", () => {
    for (const type of NOTIFICATION_TYPES) expect(isAdminNotification(type), type).toBe(NOTIFICATION_CATEGORY[type] === "ADMIN");
    expect(NOTIFICATION_TYPES.filter(isAdminNotification)).toEqual(["NEW_MEMBER_PENDING", "CONTENT_PENDING", "REPORT_FILED", "CHAT_REPORT_FILED"]);
  });

  it("is false for chat pushes and for anything else a push could carry", () => {
    for (const type of [...CHAT_PUSH_KINDS, "", "ADMIN", "constructor", "__proto__", "toString"]) expect(isAdminNotification(type), type).toBe(false);
  });
});

describe("fieldErrorsFrom", () => {
  const invalid = new ApiClientError(400, "VALIDATION_ERROR", "Invalid input", [
    { path: "fields.chapter", message: "Pick a chapter" },
    { path: "fields.joined", message: "Enter a date" },
    { path: "email", message: "Enter an email" },
  ]);

  it("keeps the paths under the prefix, without it", () => {
    expect(fieldErrorsFrom(invalid, "fields.")).toEqual({ chapter: "Pick a chapter", joined: "Enter a date" });
  });

  it("keeps full paths without a prefix", () => {
    expect(fieldErrorsFrom(invalid)).toEqual({ "fields.chapter": "Pick a chapter", "fields.joined": "Enter a date", email: "Enter an email" });
  });

  it("is empty for an error that isn't about fields", () => {
    expect(fieldErrorsFrom(new ApiClientError(409, "CONFLICT", "Changed meanwhile"), "fields.")).toEqual({});
    expect(fieldErrorsFrom(new ApiClientError(400, "VALIDATION_ERROR", "Invalid input", [{ path: "email", message: "Enter an email" }]), "fields.")).toEqual({});
    expect(fieldErrorsFrom(new Error("offline"))).toEqual({});
    expect(fieldErrorsFrom(null)).toEqual({});
    expect(fieldErrorsFrom("Invalid input")).toEqual({});
  });
});

describe("pagedNext", () => {
  it("goes on while rows remain", () => {
    expect(pagedNext(1, 25, 27)).toBe(2);
    expect(pagedNext(2, 25, 76)).toBe(3);
  });

  it("stops on the last page", () => {
    expect(pagedNext(2, 25, 27)).toBeUndefined();
    expect(pagedNext(1, 25, 25)).toBeUndefined();
    expect(pagedNext(1, 25, 0)).toBeUndefined();
  });

  it("stops rather than loop on an empty page size", () => {
    expect(pagedNext(1, 0, 10)).toBeUndefined();
  });
});

describe("dedupeById", () => {
  it("keeps each row once, in its first place", () => {
    const rows = [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "a", n: 3 },
      { id: "c", n: 4 },
      { id: "b", n: 5 },
    ];
    expect(dedupeById(rows)).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "c", n: 4 },
    ]);
    expect(dedupeById([])).toEqual([]);
  });
});

describe("formatCount", () => {
  it("groups thousands in threes", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(1000)).toBe("1,000");
    expect(formatCount(12_345)).toBe("12,345");
    expect(formatCount(120_000)).toBe("120,000");
    expect(formatCount(1_234_567)).toBe("1,234,567");
  });

  it("keeps a minus sign, and rounds to a whole count", () => {
    expect(formatCount(-1234)).toBe("-1,234");
    expect(formatCount(1234.6)).toBe("1,235");
    expect(formatCount(-0.4)).toBe("0");
  });

  it("leaves a value that isn't a number as JavaScript writes it", () => {
    expect(formatCount(Number.NaN)).toBe("NaN");
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe("Infinity");
  });
});

describe("formatCalendarDate", () => {
  it("writes the day, the short month and the year", () => {
    expect(formatCalendarDate("1990-03-12")).toBe("12 Mar 1990");
    expect(formatCalendarDate("2000-01-01")).toBe("1 Jan 2000");
    expect(formatCalendarDate("1999-12-31")).toBe("31 Dec 1999");
    expect(formatCalendarDate("2024-02-29")).toBe("29 Feb 2024");
  });

  it("gives the same day in any time zone", () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata", "UTC"]) {
        process.env.TZ = tz;
        expect(formatCalendarDate("2000-01-01"), tz).toBe("1 Jan 2000");
        expect(formatCalendarDate("1999-12-31"), tz).toBe("31 Dec 1999");
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("returns anything that isn't a real calendar date as it is", () => {
    for (const value of ["2023-02-29", "1990-13-01", "1990-00-10", "1990-3-12", "12/03/1990", "1990-03-12T00:00:00Z", "", "never"]) {
      expect(formatCalendarDate(value)).toBe(value);
    }
  });
});

describe("shared labels and tones", () => {
  it("name channels on their own with a capital, and inside a sentence with a small e for email", () => {
    expect(MESSAGE_CHANNELS.map((c) => MESSAGE_CHANNEL_LABELS[c])).toEqual(["WhatsApp", "SMS", "Email"]);
    expect(MESSAGE_CHANNELS.map(channelName).join(", then ")).toBe("WhatsApp, then SMS, then email");
  });

  it("label report statuses as the web's tabs did", () => {
    for (const s of REPORT_STATUSES) expect(REPORT_STATUS_LABELS[s]).toBe(s.charAt(0) + s.slice(1).toLowerCase());
  });

  it("tone a status as the apps' badges did", () => {
    expect(MEMBER_STATUS_TONE).toEqual({ PENDING: "warning", APPROVED: "success", REJECTED: "danger", SUSPENDED: "neutral" });
    expect(MODERATION_STATUS_TONE).toEqual({ PENDING: "warning", APPROVED: "success", REJECTED: "danger", REMOVED: "neutral" });
  });
});

describe("isOutOfDate", () => {
  it("is a 403, 404 or 409: the row changed, went, or isn't this admin's any more", () => {
    for (const [status, code] of [
      [403, "FORBIDDEN"],
      [404, "NOT_FOUND"],
      [409, "CONFLICT"],
    ] as const) {
      expect(isOutOfDate(new ApiClientError(status, code, "out of date")), String(status)).toBe(true);
    }
  });

  it("is not a failure worth trying again, nor something that isn't an API error", () => {
    const others = [
      new ApiClientError(0, "NETWORK_ERROR", "offline"),
      new ApiClientError(400, "VALIDATION_ERROR", "Invalid input"),
      new ApiClientError(401, "UNAUTHENTICATED", "signed out"),
      new ApiClientError(429, "RATE_LIMITED", "slow down"),
      new ApiClientError(500, "INTERNAL", "boom"),
      new Error("bug"),
      null,
    ];
    for (const err of others) expect(isOutOfDate(err), String(err)).toBe(false);
  });

  it("leaves any other API error typed as one, so a sheet can still show a 400's field errors", () => {
    // This only compiles while a false answer keeps the ApiClientError: a plain `err is ApiClientError` made it never.
    const fieldErrors = (e: ApiClientError | null) => (e && !isOutOfDate(e) ? e.fieldErrors : {});
    expect(fieldErrors(new ApiClientError(400, "VALIDATION_ERROR", "Invalid input", [{ path: "note", message: "Too short" }]))).toEqual({ note: "Too short" });
    expect(fieldErrors(new ApiClientError(409, "CONFLICT", "Someone else decided first", [{ path: "note", message: "Too short" }]))).toEqual({});
    expect(fieldErrors(null)).toEqual({});
    const conflict: unknown = new ApiClientError(409, "CONFLICT", "Someone else decided first");
    if (isOutOfDate(conflict)) expectTypeOf(conflict.status).toEqualTypeOf<403 | 404 | 409>();
    else expectTypeOf(conflict).toEqualTypeOf<unknown>();
  });
});

describe("unlessOutOfDate", () => {
  it("passes a success through", async () => {
    const onOutOfDate = vi.fn();
    await expect(unlessOutOfDate(async () => "done", onOutOfDate)).resolves.toBe("done");
    expect(onOutOfDate).not.toHaveBeenCalled();
  });

  it("settles on an out-of-date answer, so the dialog closes, and says so", async () => {
    const conflict = new ApiClientError(409, "CONFLICT", "Someone else decided first");
    const onOutOfDate = vi.fn();
    await expect(unlessOutOfDate(() => Promise.reject(conflict), onOutOfDate)).resolves.toBeUndefined();
    expect(onOutOfDate).toHaveBeenCalledWith(conflict);
    await expect(unlessOutOfDate(() => Promise.reject(conflict))).resolves.toBeUndefined();
  });

  it("rethrows anything else, so the dialog stays open with what was typed", async () => {
    const onOutOfDate = vi.fn();
    const invalid = new ApiClientError(400, "VALIDATION_ERROR", "Too short");
    await expect(unlessOutOfDate(() => Promise.reject(invalid), onOutOfDate)).rejects.toBe(invalid);
    const offline = new ApiClientError(0, "NETWORK_ERROR", "offline");
    await expect(unlessOutOfDate(() => Promise.reject(offline), onOutOfDate)).rejects.toBe(offline);
    expect(onOutOfDate).not.toHaveBeenCalled();
  });
});
