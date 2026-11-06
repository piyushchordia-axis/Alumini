import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADMIN_SECTIONS,
  APPROVAL_MODES,
  APPROVAL_MODE_OPTIONS,
  CHAT_PUSH_KINDS,
  CONTENT_TYPES,
  MEMBERSHIP_STATUSES,
  MEMBERSHIP_STATUS_LABELS,
  MEMBER_ACTION_COPY,
  MEMBER_SEARCH_HINT,
  MEMBER_STATUS_TAB_LABELS,
  MEMBER_STATUS_TONE,
  MESSAGE_CHANNELS,
  MESSAGE_CHANNEL_LABELS,
  MODERATION_STATUSES,
  MODERATION_STATUS_TONE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_TYPES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  adminConsoleLabel,
  adminKeys,
  adminWaitingCount,
  approvalSummary,
  approveAllCopy,
  approveAllDoneText,
  batchYearIssues,
  canPin,
  channelName,
  dashboardTiles,
  dedupeById,
  defaultFeaturesFor,
  fieldErrorsFrom,
  formatCalendarDate,
  formatCount,
  isAdminNotification,
  latestBatchYearAllowed,
  memberActionDoneText,
  memberActionErrorText,
  memberActionLabel,
  memberActionsFor,
  memberEmptyTitle,
  memberListMeta,
  memberStatusNowText,
  memberTabCounts,
  moderationActionsFor,
  onlySearchChanged,
  pagedNext,
  parseMemberStatus,
  planChannelsSentence,
  settingsDraftOf,
  settingsSave,
  statusTabs,
  tenantKeyPredicate,
  tenantSettingsUpdateSchema,
  type AdminSection,
  type AdminSectionPath,
  type DashboardDto,
  type MemberAdminAction,
  type ContentAction,
  type TenantSettingsDto,
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

describe("adminConsoleLabel", () => {
  it("names the way into the console, with the work waiting when there is some", () => {
    expect(adminConsoleLabel(0)).toBe("Admin console");
    expect(adminConsoleLabel(2)).toBe("Admin console, 2 waiting");
    expect(adminConsoleLabel(1500)).toBe("Admin console, 1,500 waiting");
  });
});

describe("dashboardTiles", () => {
  const quiet: DashboardDto = {
    pendingMembers: 0,
    approvedMembers: 1234,
    rejectedMembers: 3,
    suspendedMembers: 1,
    newMembersLast30d: 12,
    activeMembersLast30d: 1050,
    pendingContent: 0,
    openReports: 0,
    openChatReports: 0,
    upcomingEvents: 2,
    postsLast7d: 30,
  };
  const keys = (tiles: { key: string }[]) => tiles.map((t) => t.key);

  it("puts the work waiting first, opening its section, and the institution at a glance after", () => {
    const { needs, glance } = dashboardTiles({ ...quiet, pendingMembers: 2 });
    expect(needs.map((t) => [t.label, t.value, t.section, t.query])).toEqual([
      ["Pending members", 2, "members", { status: "PENDING" }],
      ["Content to review", 0, "moderation", undefined],
    ]);
    expect(needs.map((t) => t.hint)).toEqual(["Needs your decision", "Posts, jobs, funding, events, businesses"]);
    expect(glance.map((t) => [t.label, t.value])).toEqual([
      ["Approved members", 1234],
      ["New members (30d)", 12],
      ["Posts (7d)", 30],
      ["Upcoming events", 2],
    ]);
    expect(glance[0]!.hint).toBe("1,050 active in 30 days");
    for (const t of glance) expect(t.section, t.label).toBeUndefined();
    // Each tile shows the dashboard's own figure under its key.
    for (const t of [...needs, ...glance]) expect(t.value, t.label).toBe({ ...quiet, pendingMembers: 2 }[t.key]);
  });

  it("shows the two kinds of report only while either has one open", () => {
    expect(keys(dashboardTiles(quiet).needs)).toEqual(["pendingMembers", "pendingContent"]);
    for (const open of [{ openReports: 1 }, { openChatReports: 1 }, { openReports: 2, openChatReports: 5 }]) {
      const needs = dashboardTiles({ ...quiet, ...open }).needs;
      expect(keys(needs), JSON.stringify(open)).toEqual(["pendingMembers", "pendingContent", "openReports", "openChatReports"]);
      expect(needs.slice(2).map((t) => t.section)).toEqual(["reports", "chatReports"]);
    }
  });

  it("marks for attention only work that is waiting, never a figure at a glance", () => {
    const busy = { ...quiet, pendingMembers: 2, pendingContent: 0, openReports: 1, openChatReports: 0, approvedMembers: 9, upcomingEvents: 4 };
    const { needs, glance } = dashboardTiles(busy);
    expect(needs.map((t) => [t.key, t.attention])).toEqual([
      ["pendingMembers", true],
      ["pendingContent", false],
      ["openReports", true],
      ["openChatReports", false],
    ]);
    for (const t of glance) expect(t.attention, t.label).toBe(false);
  });

  it("opens only sections the console has, each a key of ADMIN_SECTIONS", () => {
    const all = { ...quiet, pendingMembers: 1, pendingContent: 1, openReports: 1, openChatReports: 1 };
    const sections = new Set(ADMIN_SECTIONS.map((s) => s.key));
    for (const t of dashboardTiles(all).needs) expect(sections.has(t.section!), t.label).toBe(true);
    // A waiting count opens the section that shows that count.
    for (const t of dashboardTiles(all).needs) expect(ADMIN_SECTIONS.find((s) => s.key === t.section)?.countKey, t.label).toBe(t.key);
  });
});

describe("approvalSummary", () => {
  const sentence = (parts: { text: string; strong?: boolean }[]) => parts.map((p) => (p.strong ? `**${p.text}**` : p.text)).join("");

  it("says whether new members wait for an admin, with the mode in bold", () => {
    expect(sentence(approvalSummary({ memberApprovalMode: "ADMIN_APPROVAL" }))).toBe("New members are **held for approval**. Content follows your moderation settings.");
    expect(sentence(approvalSummary({ memberApprovalMode: "AUTO_APPROVE" }))).toBe("New members are **auto-approved**. Content follows your moderation settings.");
  });
});

describe("ADMIN_SECTIONS in the phone app", () => {
  const consoleRoutes = resolve(ROOT, "apps/mobile/src/app/t/[slug]/(app)/admin");

  it("are each once, the Dashboard first (the phone console's home)", () => {
    expect(new Set(ADMIN_SECTIONS.map((s) => s.key)).size).toBe(ADMIN_SECTIONS.length);
    expect(ADMIN_SECTIONS[0]?.key).toBe("dashboard");
  });

  it("each have a screen in the phone app, at the web console's path", () => {
    for (const { key, path } of ADMIN_SECTIONS) {
      const files = key === "dashboard" ? ["index.tsx"] : [`${path}.tsx`, `${path}/index.tsx`];
      expect(
        files.some((f) => existsSync(resolve(consoleRoutes, f))),
        `${key}: ${files.join(" or ")}`,
      ).toBe(true);
    }
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

describe("onlySearchChanged", () => {
  const members = (filters: Record<string, unknown>) => adminKeys.members("demo", filters);

  it("keeps the rows on screen while the search is refined, cleared or started", () => {
    expect(onlySearchChanged(members({ status: "APPROVED", q: "Ni" }), members({ status: "APPROVED", q: "Nisha" }))).toBe(true);
    expect(onlySearchChanged(members({ status: "APPROVED", q: "Nisha" }), members({ status: "APPROVED", q: undefined }))).toBe(true);
    expect(onlySearchChanged(members({ status: "APPROVED" }), members({ status: "APPROVED", q: "Nisha" }))).toBe(true);
    expect(onlySearchChanged(adminKeys.audit("demo", { action: "member.", search: "a" }), adminKeys.audit("demo", { action: "member.", search: "ab" }), "search")).toBe(true);
  });

  it("never shows another tab's rows, whose buttons act on a different status", () => {
    expect(onlySearchChanged(members({ status: "PENDING", q: undefined }), members({ status: "APPROVED", q: undefined }))).toBe(false);
    expect(onlySearchChanged(members({ status: "PENDING", q: "Pa" }), members({ status: "REJECTED", q: "Pa" }))).toBe(false);
    expect(onlySearchChanged(members({ status: "PENDING" }), members({}))).toBe(false);
  });

  it("starts over for another list, another institution, or no list before", () => {
    expect(onlySearchChanged(undefined, members({ status: "PENDING" }))).toBe(false);
    expect(onlySearchChanged(adminKeys.members("other", { status: "PENDING" }), members({ status: "PENDING" }))).toBe(false);
    expect(onlySearchChanged(adminKeys.invitations("demo", { status: "PENDING" }), members({ status: "PENDING" }))).toBe(false);
    expect(onlySearchChanged(adminKeys.dashboard("demo"), members({ status: "PENDING" }))).toBe(false);
    expect(onlySearchChanged([], [])).toBe(false);
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

describe("MEMBER_ACTION_COPY", () => {
  const offered = [...new Set(MEMBERSHIP_STATUSES.flatMap(memberActionsFor))];

  it("has words for every action an admin is offered, and asks a reason only for Reject and Suspend", () => {
    expect(Object.keys(MEMBER_ACTION_COPY).sort()).toEqual([...offered].sort());
    for (const action of offered) expect(!!MEMBER_ACTION_COPY[action].reason, action).toBe(action === "reject" || action === "suspend");
    expect(offered.map((a) => [a, MEMBER_ACTION_COPY[a].label, MEMBER_ACTION_COPY[a].variant])).toEqual([
      ["approve", "Approve", "primary"],
      ["reject", "Reject", "outline"],
      ["suspend", "Suspend", "outline"],
      ["reinstate", "Reinstate", "primary"],
    ]);
  });

  it("words the reason sheet as the web's dialogs did, with the member's name", () => {
    const reject = MEMBER_ACTION_COPY.reject.reason;
    const suspend = MEMBER_ACTION_COPY.suspend.reason;
    expect(reject).toMatchObject({ body: "The member will see this reason and can re-apply.", confirm: "Reject" });
    expect(reject?.title("Diya Raval")).toBe("Reject Diya Raval?");
    expect(reject?.title(null)).toBe("Reject this request?");
    expect(suspend).toMatchObject({ body: "They lose access until reinstated.", confirm: "Suspend" });
    expect(suspend?.title("Parth Joshi")).toBe("Suspend Parth Joshi?");
  });
});

describe("memberActionDoneText and memberActionLabel", () => {
  it("say what happened to whom", () => {
    expect(memberActionDoneText("approve", "Parth Joshi")).toBe("Parth Joshi approved");
    expect(memberActionDoneText("reject", "Diya Raval")).toBe("Diya Raval's request rejected");
    expect(memberActionDoneText("suspend", "Nisha Modi")).toBe("Nisha Modi suspended");
    expect(memberActionDoneText("reinstate", "Nisha Modi")).toBe("Nisha Modi reinstated");
  });

  it("fall back to the old words when there is no name", () => {
    expect(memberActionDoneText("approve", null)).toBe("Member approved");
    expect(memberActionDoneText("reject", null)).toBe("Request rejected");
    expect(memberActionDoneText("suspend", null)).toBe("Member suspended");
    expect(memberActionDoneText("reinstate", null)).toBe("Member reinstated");
  });

  it("name a row's button with its member, starting with the word it shows", () => {
    expect(memberActionLabel("approve", "Parth Joshi")).toBe("Approve Parth Joshi");
    expect(memberActionLabel("suspend", "Nisha Modi")).toBe("Suspend Nisha Modi");
    expect(memberActionLabel("reject", null)).toBe("Reject");
  });
});

describe("approveAllCopy and approveAllDoneText", () => {
  it("ask before approving everyone waiting, counting them", () => {
    expect(approveAllCopy(2)).toEqual({
      title: "Approve all 2 pending members?",
      body: "Each is told they're in and can sign in straight away. Reject anyone you don't recognise first.",
      confirm: "Approve all",
    });
    expect(approveAllCopy(1200).title).toBe("Approve all 1,200 pending members?");
    expect(approveAllCopy(1)).toMatchObject({ title: "Approve the 1 pending member?", confirm: "Approve" });
  });

  it("report the server's count, which can be smaller than the screen's", () => {
    expect(approveAllDoneText(2)).toBe("Approved 2 members");
    expect(approveAllDoneText(1)).toBe("Approved 1 member");
    expect(approveAllDoneText(1500)).toBe("Approved 1,500 members");
    expect(approveAllDoneText(0)).toBe("Nobody was waiting any more");
  });
});

describe("memberActionErrorText", () => {
  // As the API answers when another admin, or a stale notice's PENDING, got there first: see assertAdminTransition.
  const refused = (status: unknown) => new ApiClientError(409, "INVALID_TRANSITION", "This member has already been approved", { status });

  it("says where the member stands now, from the status in a 409's details", () => {
    expect(memberActionErrorText(refused("APPROVED"), "Parth Joshi")).toBe("Parth Joshi has already been approved.");
    expect(memberActionErrorText(refused("REJECTED"), "Diya Raval")).toBe("Diya Raval's request has already been rejected.");
    expect(memberActionErrorText(refused("SUSPENDED"), "Nisha Modi")).toBe("Nisha Modi is suspended.");
    expect(memberActionErrorText(refused("PENDING"), "Diya Raval")).toBe("Diya Raval's request is waiting for approval again.");
    expect(memberActionErrorText(refused("APPROVED"), null)).toBe("This member has already been approved.");
    expect(memberActionErrorText(refused("REJECTED"), null)).toBe("This request has already been rejected.");
  });

  it("still explains a 409 without a status it knows", () => {
    const others = [refused("GONE"), refused(undefined), new ApiClientError(409, "INVALID_TRANSITION", "Cannot approve a membership that is APPROVED"), new ApiClientError(409, "CONFLICT", "x", "APPROVED")];
    for (const err of others) expect(memberActionErrorText(err, "Parth Joshi")).toBe("Someone else has already dealt with this member.");
  });

  it("says a member who has gone has gone", () => {
    const gone = new ApiClientError(404, "NOT_FOUND", "Member not found");
    expect(memberActionErrorText(gone, "Parth Joshi")).toBe("Parth Joshi isn't here any more: they may have deleted their account.");
    expect(memberActionErrorText(gone, null)).toBe("This member isn't here any more: they may have deleted their account.");
  });

  it("passes on the API's own words for anything else", () => {
    expect(memberActionErrorText(new ApiClientError(403, "NEEDS_ANOTHER_ADMIN", "This needs another admin or Illuminize staff"), "Parth Joshi")).toBe("This needs another admin or Illuminize staff");
    expect(memberActionErrorText(new ApiClientError(403, "FORBIDDEN", "You cannot change your own membership"), "Jignesh")).toBe("You cannot change your own membership");
    expect(memberActionErrorText(new ApiClientError(0, "NETWORK_ERROR", "Could not reach the server. Check your connection."), "Parth Joshi")).toBe("Could not reach the server. Check your connection.");
    expect(memberActionErrorText(new Error(""), "Parth Joshi")).toBe("Something went wrong");
    expect(memberActionErrorText(null, "Parth Joshi")).toBe("Something went wrong");
    expect(memberActionErrorText("offline", "Parth Joshi")).toBe("Something went wrong");
  });
});

describe("memberStatusNowText", () => {
  it("says where a member stands now, as a refusal would, for a notice that moved on under an open question", () => {
    expect(memberStatusNowText("REJECTED", "Parth Joshi")).toBe("Parth Joshi's request has already been rejected.");
    expect(memberStatusNowText("APPROVED", "Pooja Bhatt")).toBe("Pooja Bhatt has already been approved.");
    expect(memberStatusNowText(null, null)).toBe("This member isn't here any more: they may have deleted their account.");
  });

  it("is the 409's and the 404's words, so the two ways of finding out read the same", () => {
    for (const status of MEMBERSHIP_STATUSES) {
      const refused = new ApiClientError(409, "INVALID_TRANSITION", "x", { status });
      expect(memberStatusNowText(status, "Diya Raval"), status).toBe(memberActionErrorText(refused, "Diya Raval"));
    }
    expect(memberStatusNowText(null, "Diya Raval")).toBe(memberActionErrorText(new ApiClientError(404, "NOT_FOUND", "Member not found"), "Diya Raval"));
  });
});

describe("statusTabs and memberTabCounts", () => {
  const dashboard = { pendingMembers: 2, approvedMembers: 8, rejectedMembers: 1, suspendedMembers: 0 };

  it("label the members tabs as the web did, shorter than the badge's", () => {
    for (const s of MEMBERSHIP_STATUSES) expect(MEMBER_STATUS_TAB_LABELS[s]).toBe(s.charAt(0) + s.slice(1).toLowerCase());
    expect(MEMBERSHIP_STATUS_LABELS.PENDING).toBe("Pending approval");
  });

  it("give each status a tab in order, with its count from the dashboard", () => {
    expect(statusTabs(MEMBERSHIP_STATUSES, MEMBER_STATUS_TAB_LABELS, memberTabCounts(dashboard))).toEqual([
      { value: "PENDING", label: "Pending", count: 2 },
      { value: "APPROVED", label: "Approved", count: 8 },
      { value: "REJECTED", label: "Rejected", count: 1 },
      { value: "SUSPENDED", label: "Suspended", count: 0 },
    ]);
  });

  it("show no count, rather than 0, until the counts have loaded", () => {
    expect(memberTabCounts(undefined)).toBeUndefined();
    for (const tab of statusTabs(MEMBERSHIP_STATUSES, MEMBER_STATUS_TAB_LABELS, memberTabCounts(undefined))) expect(tab, tab.value).not.toHaveProperty("count");
    expect(statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, { OPEN: 3 })).toEqual([
      { value: "OPEN", label: "Open", count: 3 },
      { value: "RESOLVED", label: "Resolved" },
      { value: "DISMISSED", label: "Dismissed" },
    ]);
  });
});

describe("parseMemberStatus", () => {
  it("reads a status from the address", () => {
    for (const s of MEMBERSHIP_STATUSES) expect(parseMemberStatus(s)).toBe(s);
    expect(parseMemberStatus(["REJECTED", "APPROVED"])).toBe("REJECTED");
  });

  it("opens Pending for anything else, rather than send the API a status it refuses", () => {
    for (const raw of [undefined, null, "", "foo", "pending", "approved", "constructor", 3, [], ["nope"], { status: "APPROVED" }]) {
      expect(parseMemberStatus(raw), JSON.stringify(raw)).toBe("PENDING");
    }
  });
});

describe("APPROVAL_MODE_OPTIONS", () => {
  it("offer each approval mode once for members and for content, under the web console's names", () => {
    for (const which of ["member", "content"] as const) {
      expect(APPROVAL_MODE_OPTIONS[which].options.map((o) => o.value), which).toEqual([...APPROVAL_MODES]);
    }
    expect(APPROVAL_MODE_OPTIONS.member.label).toBe("New member approval");
    expect(APPROVAL_MODE_OPTIONS.member.options.map((o) => o.label)).toEqual(["Auto-approve members", "Admin must approve members"]);
    expect(APPROVAL_MODE_OPTIONS.content.label).toBe("Content moderation");
    expect(APPROVAL_MODE_OPTIONS.content.options.map((o) => o.label)).toEqual(["Publish immediately", "Admin must approve before publishing"]);
  });
});

describe("planChannelsSentence", () => {
  const said = (channels: Parameters<typeof planChannelsSentence>[0]) => {
    const { sentence, note } = planChannelsSentence(channels);
    return { text: sentence.map((p) => (p.strong ? `**${p.text}**` : p.text)).join(""), note };
  };

  it("says what the plan sends, and that messages are billed", () => {
    expect(said(["WHATSAPP", "SMS", "EMAIL"])).toEqual({
      text: "**Your plan includes: **in-app notifications and push, plus WhatsApp, SMS, email for invites and announcements.",
      note: "Messages are billed per delivery.",
    });
    expect(said(["EMAIL"]).text).toBe("**Your plan includes: **in-app notifications and push, plus email for invites and announcements.");
  });

  it("says how to get messaging when the plan has none", () => {
    expect(said([])).toEqual({ text: "**Your plan includes: **in-app notifications and push.", note: "Ask the Illuminize team to add WhatsApp, SMS or email messaging." });
  });
});

describe("batchYearIssues", () => {
  const now = new Date("2026-06-01T00:00:00Z");
  const range = "Enter a year from 1950 to 2036";

  it("takes a range of real years, the earliest not after the latest", () => {
    expect(latestBatchYearAllowed(now)).toBe(2036);
    expect(batchYearIssues("1990", "2032", now)).toEqual({});
    expect(batchYearIssues("1950", "2036", now)).toEqual({});
    expect(batchYearIssues(" 2000 ", "2000", now)).toEqual({});
  });

  it("refuses a blank, partial or out-of-range year in words, each under its own box", () => {
    expect(batchYearIssues("", "2032", now)).toEqual({ minBatchYear: range });
    expect(batchYearIssues("1990", "", now)).toEqual({ maxBatchYear: range });
    expect(batchYearIssues("199", "20x2", now)).toEqual({ minBatchYear: range, maxBatchYear: range });
    expect(batchYearIssues("1949", "2037", now)).toEqual({ minBatchYear: range, maxBatchYear: range });
    expect(batchYearIssues("2030", "2020", now)).toEqual({ minBatchYear: "The earliest year can't be after the latest" });
  });

  it("agrees with the API's schema on which years it takes", () => {
    const thisYear = new Date();
    const latest = latestBatchYearAllowed(thisYear);
    for (const [min, max] of [
      [1949, 2000],
      [1950, 2000],
      [2000, latest],
      [2000, latest + 1],
      [2001, 2000],
    ]) {
      const ours = Object.keys(batchYearIssues(String(min), String(max), thisYear)).length === 0;
      expect(tenantSettingsUpdateSchema.safeParse({ minBatchYear: min, maxBatchYear: max }).success, `${min}-${max}`).toBe(ours);
    }
  });
});

describe("memberListMeta", () => {
  const formatDate = (iso: string) => `on ${iso.slice(0, 10)}`;
  const member = { startYear: 2014, batchYear: 2018, phone: "+919100000037", companyName: "Infosys", city: "Pune", createdAt: "2026-11-03T10:00:00.000Z" };

  it("joins the years, phone, work and request date", () => {
    expect(memberListMeta(member, formatDate)).toBe("2014–2018 · +91 91000 00037 · Infosys, Pune · requested on 2026-11-03");
  });

  it("says present for a community member who still belongs", () => {
    expect(memberListMeta({ ...member, startYear: 2018, batchYear: null }, formatDate)).toBe("2018–present · +91 91000 00037 · Infosys, Pune · requested on 2026-11-03");
  });

  it("leaves out what the member didn't give", () => {
    expect(memberListMeta({ ...member, companyName: null }, formatDate)).toBe("2014–2018 · +91 91000 00037 · Pune · requested on 2026-11-03");
    expect(memberListMeta({ ...member, city: null }, formatDate)).toBe("2014–2018 · +91 91000 00037 · Infosys · requested on 2026-11-03");
    expect(memberListMeta({ ...member, companyName: null, city: null, phone: "" }, formatDate)).toBe("2014–2018 · requested on 2026-11-03");
  });
});

describe("memberEmptyTitle", () => {
  it("names the tab, and the search when there is one", () => {
    expect(memberEmptyTitle("PENDING")).toBe("No pending members");
    expect(memberEmptyTitle("SUSPENDED", "")).toBe("No suspended members");
    expect(memberEmptyTitle("APPROVED", "  ")).toBe("No approved members");
    expect(memberEmptyTitle("APPROVED", " Nisha ")).toBe("No approved members match “Nisha”");
    expect(MEMBER_SEARCH_HINT).toBe("Search looks at names, companies and phone numbers.");
  });
});

describe("settingsSave", () => {
  const initial: TenantSettingsDto = {
    memberApprovalMode: "ADMIN_APPROVAL",
    contentModerationMode: "AUTO_APPROVE",
    allowSelfRegistration: true,
    minBatchYear: 1990,
    maxBatchYear: 2030,
    features: defaultFeaturesFor("OTHER"),
    inviteAutoApprove: false,
    updatedAt: "2026-06-01T00:00:00.000Z",
  };

  const { updatedAt: _updatedAt, features, ...plain } = initial;

  it("starts the form from the settings, with the years as text", () => {
    expect(settingsDraftOf(initial)).toStrictEqual({ ...plain, features, minBatchYear: "1990", maxBatchYear: "2030" });
  });

  it("sends the settings with the years as numbers, and only the features that changed, if any", () => {
    const draft = settingsDraftOf(initial);
    expect(settingsSave(initial, draft)).toStrictEqual({ input: plain });
    expect(settingsSave(initial, { ...draft, features: { ...features, funding: false } })).toStrictEqual({ input: { ...plain, features: { funding: false } } });
    expect(settingsSave(initial, { ...draft, minBatchYear: " 1985 " }).input?.minBatchYear).toBe(1985);
  });

  it("sends nothing while a year is wrong, saying why under it", () => {
    // A blank box would have gone as 0, which the API refuses in words of its own.
    expect(settingsSave(initial, { ...settingsDraftOf(initial), minBatchYear: "" })).toStrictEqual({ errors: { minBatchYear: `Enter a year from 1950 to ${latestBatchYearAllowed()}` } });
    expect(settingsSave(initial, { ...settingsDraftOf(initial), minBatchYear: "2031" }).errors).toEqual({ minBatchYear: "The earliest year can't be after the latest" });
  });
});
