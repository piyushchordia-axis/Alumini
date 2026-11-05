import type { ContentType, MembershipStatus, ModerationStatus, NotificationType } from "../constants";
import type { DashboardDto } from "../types/dto";
import { MONTHS } from "./jobs";
import { NOTIFICATION_CATEGORY } from "./notifications";
import { groupDigits } from "./salary";
import { isValidCalendarDate } from "./time";

/**
 * Query keys for the tenant admin console, the same on both apps. The slug is second, as in every tenant key, so
 * invalidating an institution (tenantKeyPredicate) reaches them all.
 */
export const adminKeys = {
  dashboard: (slug: string) => ["admin", slug, "dashboard"] as const,
  analytics: (slug: string, weeks: number) => ["admin", slug, "analytics", weeks] as const,
  members: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "members", filters ?? {}] as const,
  member: (slug: string, id: string) => ["admin", slug, "member", id] as const,
  moderation: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "moderation", filters ?? {}] as const,
  /** One item of the moderation queue, opened in full. */
  content: (slug: string, type: ContentType, id: string) => ["admin", slug, "content", type, id] as const,
  reports: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "reports", filters ?? {}] as const,
  chatReports: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "chat-reports", filters ?? {}] as const,
  settings: (slug: string) => ["admin", slug, "settings"] as const,
  profileFields: (slug: string) => ["admin", slug, "profile-fields"] as const,
  invitations: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "invitations", filters ?? {}] as const,
  invitationSummary: (slug: string) => ["admin", slug, "invitations", "summary"] as const,
  audit: (slug: string, filters?: Record<string, unknown>) => ["admin", slug, "audit", filters ?? {}] as const,
  /** How many members an announcement would reach by each channel, for the post composer. */
  announcementAudience: (slug: string) => ["admin", slug, "announcement-audience"] as const,
};

/** For `invalidateQueries({ predicate })`: every cached query of one institution, as tenant keys all carry the slug second. */
export function tenantKeyPredicate(slug: string): (query: { queryKey: readonly unknown[] }) => boolean {
  return (query) => query.queryKey[1] === slug;
}

/** The icons of the console's sections: names that both apps' NavIcon draws. */
export type AdminIconName = "dashboard" | "analytics" | "directory" | "admin" | "flag" | "messages" | "mail" | "fields" | "settings" | "audit";

/** The dashboard's counts of work waiting for an admin, each shown on its own section. */
export type AdminWaitingKey = Extract<keyof DashboardDto, "pendingMembers" | "pendingContent" | "openReports" | "openChatReports">;

/**
 * A section's route below the web console's `/t/:slug/admin`. The phone app's console has the same routes but one: its
 * Dashboard is the console home (`admin/index`), so it has no `admin/dashboard`.
 */
export type AdminSectionPath = "dashboard" | "analytics" | "members" | "moderation" | "reports" | "chat-reports" | "invitations" | "profile-fields" | "settings" | "audit";

export interface AdminSection {
  key: "dashboard" | "analytics" | "members" | "moderation" | "reports" | "chatReports" | "invitations" | "profileFields" | "settings" | "audit";
  /** The web console's route (see AdminSectionPath): on the phone the Dashboard is the console home rather than this path. */
  path: AdminSectionPath;
  label: string;
  icon: AdminIconName;
  /** The count of things waiting in the section. */
  countKey?: AdminWaitingKey;
}

/**
 * The console's sections, in the web nav's order. Branding isn't one: on the web it's a tab of Settings, which is where
 * both apps reach it.
 */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { key: "dashboard", path: "dashboard", label: "Dashboard", icon: "dashboard" },
  { key: "analytics", path: "analytics", label: "Analytics", icon: "analytics" },
  { key: "members", path: "members", label: "Members", icon: "directory", countKey: "pendingMembers" },
  { key: "moderation", path: "moderation", label: "Moderation", icon: "admin", countKey: "pendingContent" },
  { key: "reports", path: "reports", label: "Reports", icon: "flag", countKey: "openReports" },
  { key: "chatReports", path: "chat-reports", label: "Chat reports", icon: "messages", countKey: "openChatReports" },
  { key: "invitations", path: "invitations", label: "Invitations", icon: "mail" },
  { key: "profileFields", path: "profile-fields", label: "Profile fields", icon: "fields" },
  { key: "settings", path: "settings", label: "Settings", icon: "settings" },
  { key: "audit", path: "audit", label: "Audit log", icon: "audit" },
];

/** Everything waiting for an admin, the sections' counts added up: members to decide on, content to review, and open reports of both kinds. */
export function adminWaitingCount(d: Pick<DashboardDto, AdminWaitingKey>): number {
  return d.pendingMembers + d.pendingContent + d.openReports + d.openChatReports;
}

/** What can happen to a membership. An admin does all but reapply, which is the member's own. */
export type MembershipAction = "approve" | "reject" | "suspend" | "reinstate" | "reapply";
export type MemberAdminAction = Exclude<MembershipAction, "reapply">;

/**
 * The membership state machine: the API's transitions and both apps' buttons. "INITIAL" is wherever the institution's
 * approval mode starts a membership.
 */
export const MEMBERSHIP_TRANSITIONS: Readonly<Record<MembershipStatus, Partial<Record<MembershipAction, MembershipStatus | "INITIAL">>>> = {
  PENDING: { approve: "APPROVED", reject: "REJECTED" },
  APPROVED: { suspend: "SUSPENDED" },
  REJECTED: { approve: "APPROVED", reapply: "INITIAL" },
  SUSPENDED: { reinstate: "APPROVED" },
};

/** What an admin may do to a membership in `status`. */
export function memberActionsFor(status: MembershipStatus): MemberAdminAction[] {
  return (Object.keys(MEMBERSHIP_TRANSITIONS[status] ?? {}) as MembershipAction[]).filter((a): a is MemberAdminAction => a !== "reapply");
}

export type ContentAction = "approve" | "reject" | "remove" | "restore";

/** The moderation state machine: the API's transitions and both apps' buttons. */
export const MODERATION_TRANSITIONS: Readonly<Record<ModerationStatus, Partial<Record<ContentAction, ModerationStatus>>>> = {
  PENDING: { approve: "APPROVED", reject: "REJECTED" },
  REJECTED: { approve: "APPROVED" },
  APPROVED: { remove: "REMOVED" },
  REMOVED: { restore: "APPROVED" },
};

/** What an admin may do to content in `status`. */
export function moderationActionsFor(status: ModerationStatus): ContentAction[] {
  return Object.keys(MODERATION_TRANSITIONS[status] ?? {}) as ContentAction[];
}

/** Only a published post can be pinned to the top of the feed. */
export function canPin(type: ContentType, status: ModerationStatus): boolean {
  return type === "POST" && status === "APPROVED";
}

/** A notice that something waits for an admin, after which the console's counts and lists are out of date. Any string a push carried may come in. */
export function isAdminNotification(type: string): boolean {
  return Object.hasOwn(NOTIFICATION_CATEGORY, type) && NOTIFICATION_CATEGORY[type as NotificationType] === "ADMIN";
}

/**
 * An API validation error's messages by field path, or {} for any other error. With `prefix`, only the paths under it,
 * without the prefix: "fields." makes "fields.chapter" into "chapter", the key of the form's input. It reads the error's
 * `fieldErrors` rather than importing ApiClientError, because lib/ doesn't depend on the client.
 */
export function fieldErrorsFrom(err: unknown, prefix = ""): Record<string, string> {
  const all = err !== null && typeof err === "object" && "fieldErrors" in err ? err.fieldErrors : undefined;
  const out: Record<string, string> = {};
  if (!all || typeof all !== "object") return out;
  for (const [path, message] of Object.entries(all)) {
    if (typeof message === "string" && path.startsWith(prefix)) out[path.slice(prefix.length)] = message;
  }
  return out;
}

/** The page after `page` of a page-numbered list, or undefined after the last: a useInfiniteQuery's getNextPageParam. */
export function pagedNext(page: number, pageSize: number, total: number): number | undefined {
  return pageSize > 0 && page * pageSize < total ? page + 1 : undefined;
}

/**
 * The rows of several pages as one list, each once. A row can arrive twice when the list changed between two pages
 * (a newer row pushed it onto the next one); it keeps its first place.
 */
export function dedupeById<T extends { id: string }>(rows: readonly T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

/** A whole count with its thousands grouped: "12,345". Written by hand, as Hermes may lack Intl number formatting. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const whole = Math.round(Math.abs(n));
  return `${n < 0 && whole > 0 ? "-" : ""}${groupDigits(String(whole), false)}`;
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date such as a date of birth, "1990-03-12", as "12 Mar 1990". It's read from the text and never through a
 * Date in the device's zone, which would show it a day early west of UTC, and written by hand, as Hermes may lack Intl
 * date formatting. Anything that isn't a real date comes back as it is.
 */
export function formatCalendarDate(value: string): string {
  const m = CALENDAR_DATE.exec(value);
  if (!m || !isValidCalendarDate(value)) return value;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${Number(m[1])}`;
}
