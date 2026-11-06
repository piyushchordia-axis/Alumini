import {
  MARITAL_STATUS_LABELS,
  MEMBERSHIP_STATUSES,
  MIN_BATCH_YEAR,
  PROFESSION_TYPE_LABELS,
  channelName,
  countryName,
  type ApprovalMode,
  type ContentType,
  type MembershipRole,
  type MembershipStatus,
  type MessageChannel,
  type ModerationStatus,
  type NotificationType,
  type TenantFeatures,
} from "../constants";
import { tenantSettingsUpdateSchema, type TenantSettingsUpdate } from "../schemas/tenant";
import type { AdminMemberDto, DashboardDto, TenantPublicSettings, TenantSettingsDto } from "../types/dto";
import { changedFeatures } from "./features";
import { MONTHS } from "./jobs";
import { NOTIFICATION_CATEGORY } from "./notifications";
import { formatPhone } from "./phone";
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

/** The accessible name of a way into the console from the member app, with the work waiting: "Admin console, 3 waiting". */
export function adminConsoleLabel(waiting: number): string {
  return waiting > 0 ? `Admin console, ${formatCount(waiting)} waiting` : "Admin console";
}

export type AdminSectionKey = AdminSection["key"];

/**
 * The sections the phone app's console has so far (its Dashboard is the console's home). It lists the others as on the
 * web console, and README → Known gaps names them, until every page is in the phone app.
 */
export const MOBILE_ADMIN_SECTIONS: readonly AdminSectionKey[] = [
  "dashboard",
  "members",
  "moderation",
  "reports",
  "chatReports",
  "profileFields",
  "settings",
  "audit",
];

/** A figure on the console's home, which both apps draw as a tile. */
export interface DashboardTile {
  key: keyof DashboardDto;
  label: string;
  value: number;
  hint?: string;
  /** The section the tile opens, with the query to open it with. */
  section?: AdminSectionKey;
  query?: Readonly<Record<string, string>>;
  /** Work is waiting: the tile is drawn in amber. */
  attention: boolean;
}

/**
 * The console home's figures: what needs an admin, then the institution at a glance. The two kinds of report show only
 * while either has one open, as many institutions never get one.
 */
export function dashboardTiles(d: DashboardDto): { needs: DashboardTile[]; glance: DashboardTile[] } {
  const waiting = (key: AdminWaitingKey, label: string, hint: string, section: AdminSectionKey, query?: Record<string, string>): DashboardTile => ({
    key,
    label,
    value: d[key],
    hint,
    section,
    ...(query ? { query } : {}),
    attention: d[key] > 0,
  });
  const needs = [waiting("pendingMembers", "Pending members", "Needs your decision", "members", { status: "PENDING" }), waiting("pendingContent", "Content to review", "Posts, jobs, funding, events, businesses", "moderation")];
  if (d.openReports > 0 || d.openChatReports > 0) {
    needs.push(waiting("openReports", "Open reports", "Flagged by members", "reports"), waiting("openChatReports", "Open chat reports", "Private messages members reported", "chatReports"));
  }
  const glance: DashboardTile[] = [
    { key: "approvedMembers", label: "Approved members", value: d.approvedMembers, hint: `${formatCount(d.activeMembersLast30d)} active in 30 days`, attention: false },
    { key: "newMembersLast30d", label: "New members (30d)", value: d.newMembersLast30d, attention: false },
    { key: "postsLast7d", label: "Posts (7d)", value: d.postsLast7d, attention: false },
    { key: "upcomingEvents", label: "Upcoming events", value: d.upcomingEvents, attention: false },
  ];
  return { needs, glance };
}

/** Part of a sentence, set in bold when `strong`. */
export interface TextSegment {
  text: string;
  strong?: boolean;
}

/** How the institution takes in new members, as the console's home says it, with the mode in bold. */
export function approvalSummary(settings: Pick<TenantPublicSettings, "memberApprovalMode">): TextSegment[] {
  return [
    { text: "New members are " },
    { text: settings.memberApprovalMode === "ADMIN_APPROVAL" ? "held for approval" : "auto-approved", strong: true },
    { text: ". Content follows your moderation settings." },
  ];
}

/** One of a setting's choices, with what it's called. */
export interface ApprovalModeOption {
  value: ApprovalMode;
  label: string;
}

/** The two approval settings, as both apps' settings forms name and explain them. */
export const APPROVAL_MODE_OPTIONS: Readonly<Record<"member" | "content", { label: string; hint: string; options: readonly ApprovalModeOption[] }>> = {
  member: {
    label: "New member approval",
    hint: "Who can get in: everyone instantly, or only after an admin approves.",
    options: [
      { value: "AUTO_APPROVE", label: "Auto-approve members" },
      { value: "ADMIN_APPROVAL", label: "Admin must approve members" },
    ],
  },
  content: {
    label: "Content moderation",
    hint: "Applies to posts, jobs, funding, events, businesses, and groups' names and descriptions. Comments and messages are never held.",
    options: [
      { value: "AUTO_APPROVE", label: "Publish immediately" },
      { value: "ADMIN_APPROVAL", label: "Admin must approve before publishing" },
    ],
  },
};

/**
 * What the institution's plan lets it send, as the settings page says it: the sentence, its opening in bold, and a note
 * on billing or on how to get messaging.
 */
export function planChannelsSentence(channels: readonly MessageChannel[]): { sentence: TextSegment[]; note: string } {
  const extra = channels.length > 0 ? `, plus ${channels.map(channelName).join(", ")} for invites and announcements` : "";
  return {
    sentence: [{ text: "Your plan includes: ", strong: true }, { text: `in-app notifications and push${extra}.` }],
    note: channels.length === 0 ? "Ask the Illuminize team to add WhatsApp, SMS or email messaging." : "Messages are billed per delivery.",
  };
}

/** The latest batch year an institution may allow, as tenantSettingsUpdateSchema has it: ten years ahead. */
export function latestBatchYearAllowed(now: Date = new Date()): number {
  return now.getFullYear() + 10;
}

/**
 * The settings form's batch years, as typed, checked before anything is sent: a year from 1950 to ten years ahead in
 * each box, the earliest not after the latest. The problems by the setting each is about, or {}.
 */
export function batchYearIssues(min: string, max: string, now: Date = new Date()): Partial<Record<"minBatchYear" | "maxBatchYear", string>> {
  const latest = latestBatchYearAllowed(now);
  const read = (text: string) => {
    const trimmed = text.trim();
    const year = /^\d{4}$/.test(trimmed) ? Number(trimmed) : NaN;
    return year >= MIN_BATCH_YEAR && year <= latest ? year : null;
  };
  const range = `Enter a year from ${MIN_BATCH_YEAR} to ${latest}`;
  const issues: Partial<Record<"minBatchYear" | "maxBatchYear", string>> = {};
  const from = read(min);
  const to = read(max);
  if (from === null) issues.minBatchYear = range;
  if (to === null) issues.maxBatchYear = range;
  if (from !== null && to !== null && from > to) issues.minBatchYear = "The earliest year can't be after the latest";
  return issues;
}

/** What the settings form holds: the settings, with the batch years as typed. */
export interface SettingsDraft {
  memberApprovalMode: ApprovalMode;
  contentModerationMode: ApprovalMode;
  allowSelfRegistration: boolean;
  minBatchYear: string;
  maxBatchYear: string;
  features: TenantFeatures;
  inviteAutoApprove: boolean;
}

export function settingsDraftOf(s: TenantSettingsDto): SettingsDraft {
  return {
    memberApprovalMode: s.memberApprovalMode,
    contentModerationMode: s.contentModerationMode,
    allowSelfRegistration: s.allowSelfRegistration,
    minBatchYear: String(s.minBatchYear),
    maxBatchYear: String(s.maxBatchYear),
    features: s.features,
    inviteAutoApprove: s.inviteAutoApprove,
  };
}

/**
 * The save a settings form sends, or the problems that keep it from sending, by the setting each is about
 * ("minBatchYear", "features.mentorship"): the batch years in words a person reads, then the API's own schema. Features
 * go only when some changed, and then only those, so a stale form can't undo another admin's change.
 */
export function settingsSave(initial: TenantSettingsDto, draft: SettingsDraft, now: Date = new Date()): { input: TenantSettingsUpdate; errors?: undefined } | { input?: undefined; errors: Record<string, string> } {
  const issues = batchYearIssues(draft.minBatchYear, draft.maxBatchYear, now);
  if (Object.keys(issues).length > 0) return { errors: issues };
  const changed = changedFeatures(initial.features, draft.features);
  const input: TenantSettingsUpdate = {
    memberApprovalMode: draft.memberApprovalMode,
    contentModerationMode: draft.contentModerationMode,
    allowSelfRegistration: draft.allowSelfRegistration,
    minBatchYear: Number(draft.minBatchYear.trim()),
    maxBatchYear: Number(draft.maxBatchYear.trim()),
    ...(Object.keys(changed).length > 0 ? { features: changed } : {}),
    inviteAutoApprove: draft.inviteAutoApprove,
  };
  const parsed = tenantSettingsUpdateSchema.safeParse(input);
  if (parsed.success) return { input };
  const errors: Record<string, string> = {};
  for (const i of parsed.error.issues) errors[i.path.map(String).join(".") || "form"] ??= i.message;
  return { errors };
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

/** One admin action's words on both apps. Names may be null: a notice's applicant can have deleted their account. */
export interface MemberActionCopy {
  label: string;
  /** Approve and Reinstate act at once and lead; Reject and Suspend ask for a reason first. */
  variant: "primary" | "outline";
  /** The reason sheet or dialog, for an action the member is told the reason for. */
  reason?: { title: (name: string | null) => string; body: string; confirm: string };
  /** What happened, for a toast or status line: "Parth Joshi approved". */
  done: (name: string | null) => string;
}

export const MEMBER_ACTION_COPY: Readonly<Record<MemberAdminAction, MemberActionCopy>> = {
  approve: { label: "Approve", variant: "primary", done: (name) => (name ? `${name} approved` : "Member approved") },
  reject: {
    label: "Reject",
    variant: "outline",
    reason: { title: (name) => `Reject ${name ?? "this request"}?`, body: "The member will see this reason and can re-apply.", confirm: "Reject" },
    done: (name) => (name ? `${name}'s request rejected` : "Request rejected"),
  },
  suspend: {
    label: "Suspend",
    variant: "outline",
    reason: { title: (name) => `Suspend ${name ?? "this member"}?`, body: "They lose access until reinstated.", confirm: "Suspend" },
    done: (name) => (name ? `${name} suspended` : "Member suspended"),
  },
  reinstate: { label: "Reinstate", variant: "primary", done: (name) => (name ? `${name} reinstated` : "Member reinstated") },
};

/** A row's button named with its member, so a screen reader can tell one row's Approve from the next: "Approve Parth Joshi". */
export function memberActionLabel(action: MemberAdminAction, name: string | null): string {
  return name ? `${MEMBER_ACTION_COPY[action].label} ${name}` : MEMBER_ACTION_COPY[action].label;
}

export function memberActionDoneText(action: MemberAdminAction, name: string | null): string {
  return MEMBER_ACTION_COPY[action].done(name);
}

/** The confirmation before approving everyone waiting, `n` of them as far as the screen knows. */
export function approveAllCopy(n: number): { title: string; body: string; confirm: string } {
  return n === 1
    ? { title: "Approve the 1 pending member?", body: "They're told they're in and can sign in straight away. Reject them first if you don't recognise them.", confirm: "Approve" }
    : { title: `Approve all ${formatCount(n)} pending members?`, body: "Each is told they're in and can sign in straight away. Reject anyone you don't recognise first.", confirm: "Approve all" };
}

/** What Approve all did, by the server's count, which another admin acting first can make smaller than the screen's. */
export function approveAllDoneText(approved: number): string {
  if (approved === 0) return "Nobody was waiting any more";
  return `Approved ${formatCount(approved)} ${approved === 1 ? "member" : "members"}`;
}

/** Where a member's request stands, as a 409 reports it: worded for the admin whose screen showed it otherwise. */
const STATUS_NOW: Readonly<Record<MembershipStatus, (name: string | null) => string>> = {
  APPROVED: (name) => `${name ?? "This member"} has already been approved.`,
  REJECTED: (name) => (name ? `${name}'s request has already been rejected.` : "This request has already been rejected."),
  SUSPENDED: (name) => `${name ?? "This member"} is suspended.`,
  // A rejected applicant who applied again: the admin acted on the rejection.
  PENDING: (name) => (name ? `${name}'s request is waiting for approval again.` : "This request is waiting for approval again."),
};

/**
 * Where a member stands now, for an admin whose screen showed them otherwise: from a 409's details, or a notice's refetch
 * that moved on under an open question. A null status is a member who has gone.
 */
export function memberStatusNowText(status: MembershipStatus | null, name: string | null): string {
  return status ? STATUS_NOW[status](name) : `${name ?? "This member"} isn't here any more: they may have deleted their account.`;
}

/**
 * Why an action on a member failed, in words for a toast or status line. A 409 says where the member stands now, from
 * the status the API puts in its details (another admin, or a stale notice, got there first). It reads the error's fields
 * rather than importing ApiClientError, because lib/ doesn't depend on the client.
 */
export function memberActionErrorText(err: unknown, name: string | null): string {
  const e = err !== null && typeof err === "object" ? (err as { status?: unknown; message?: unknown; details?: unknown }) : {};
  if (e.status === 409) {
    const status = e.details !== null && typeof e.details === "object" && "status" in e.details ? e.details.status : undefined;
    const now = MEMBERSHIP_STATUSES.find((s) => s === status);
    return now ? memberStatusNowText(now, name) : "Someone else has already dealt with this member.";
  }
  if (e.status === 404) return memberStatusNowText(null, name);
  return typeof e.message === "string" && e.message ? e.message : "Something went wrong";
}

/** The members list's tab names: shorter than MEMBERSHIP_STATUS_LABELS' "Pending approval", which a badge uses. */
export const MEMBER_STATUS_TAB_LABELS: Readonly<Record<MembershipStatus, string>> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", SUSPENDED: "Suspended" };

export interface StatusTab<S extends string> {
  value: S;
  label: string;
  count?: number;
}

/** A status list's tabs, in the order of `statuses`, each with its count once the counts have loaded. */
export function statusTabs<S extends string>(statuses: readonly S[], labels: Readonly<Record<S, string>>, counts?: Partial<Readonly<Record<S, number>>>): StatusTab<S>[] {
  return statuses.map((value) => {
    const count = counts?.[value];
    return count === undefined ? { value, label: labels[value] } : { value, label: labels[value], count };
  });
}

/** The members list's tab counts, from the console's dashboard, or undefined until it has loaded. */
export function memberTabCounts(d: Pick<DashboardDto, "pendingMembers" | "approvedMembers" | "rejectedMembers" | "suspendedMembers"> | undefined): Record<MembershipStatus, number> | undefined {
  return d ? { PENDING: d.pendingMembers, APPROVED: d.approvedMembers, REJECTED: d.rejectedMembers, SUSPENDED: d.suspendedMembers } : undefined;
}

/**
 * The members list's status from its address (?status=). Anything that isn't a status, from an old link or a typo, opens
 * the Pending tab rather than reaching the API as a 400. An app's router may give a repeated parameter as a list.
 */
export function parseMemberStatus(raw: unknown): MembershipStatus {
  const value: unknown = Array.isArray(raw) ? raw[0] : raw;
  return MEMBERSHIP_STATUSES.find((s) => s === value) ?? "PENDING";
}

/** A member row's second line: "Batch of 2018 · +91 91000 00037 · Infosys, Pune · requested 3 Nov 2026". */
export function memberListMeta(m: Pick<AdminMemberDto, "batchYear" | "phone" | "companyName" | "city" | "createdAt">, formatDate: (iso: string) => string): string {
  const work = [m.companyName, m.city].filter(Boolean).join(", ");
  return [`Batch of ${m.batchYear}`, formatPhone(m.phone), work, `requested ${formatDate(m.createdAt)}`].filter(Boolean).join(" · ");
}

/** One fact on a member's admin page. */
export interface MemberFact {
  label: string;
  value: string;
}

/**
 * What a member's admin page lists beside their profile (ProfileDetails shows the work, studies, links and bio), with
 * "—" for anything not given. Instants go through the caller's formatters, as Hermes may lack Intl date formatting. A
 * date of birth is a calendar date, written by formatCalendarDate, so it never shows a day early west of UTC.
 */
export function memberFacts(
  m: Pick<AdminMemberDto, "phone" | "batchYear" | "professionType" | "city" | "country" | "dateOfBirth" | "maritalStatus" | "kidsCount" | "createdAt" | "lastActiveAt" | "lastLoginAt">,
  format: { formatDate: (iso: string) => string; formatDateTime: (iso: string) => string },
): MemberFact[] {
  const facts: Array<[string, string | number | null]> = [
    ["Phone", formatPhone(m.phone)],
    ["Batch", m.batchYear],
    ["Profession", PROFESSION_TYPE_LABELS[m.professionType]],
    ["City", [m.city, countryName(m.country)].filter(Boolean).join(", ")],
    ["Date of birth", m.dateOfBirth ? formatCalendarDate(m.dateOfBirth) : null],
    ["Marital status", m.maritalStatus ? MARITAL_STATUS_LABELS[m.maritalStatus] : null],
    ["Kids", m.kidsCount],
    ["Member since", format.formatDate(m.createdAt)],
    ["Last active", m.lastActiveAt ? format.formatDateTime(m.lastActiveAt) : "never"],
    ["Last login", m.lastLoginAt ? format.formatDateTime(m.lastLoginAt) : "never"],
  ];
  return facts.map(([label, value]) => ({ label, value: value === null || value === "" ? "—" : String(value) }));
}

/** The words of a role change, from its button to what it did. */
export interface RoleChangeCopy {
  label: string;
  title: string;
  body: string;
  confirm: string;
  /** Taking the role away is drawn as a destructive action. */
  destructive: boolean;
  done: string;
}

/** Making a member an admin of `tenantName`, or taking the role away, asked first on both apps. */
export function roleChangeCopy(name: string, to: MembershipRole, tenantName: string): RoleChangeCopy {
  return to === "TENANT_ADMIN"
    ? {
        label: "Make admin",
        title: `Make ${name} an admin?`,
        body: `They'll be able to approve members, moderate content, change settings and read the audit log for ${tenantName}.`,
        confirm: "Make admin",
        destructive: false,
        done: `${name} is now an admin`,
      }
    : {
        label: "Remove admin role",
        title: `Remove ${name}'s admin role?`,
        body: "They keep their membership but lose the admin console.",
        confirm: "Remove admin role",
        destructive: true,
        done: `${name} is no longer an admin`,
      };
}

/** The members list's empty state: "No pending members", or with a search, "No approved members match “Nisha”". */
export function memberEmptyTitle(status: MembershipStatus, q?: string | null): string {
  const which = MEMBER_STATUS_TAB_LABELS[status].toLowerCase();
  const search = q?.trim();
  return search ? `No ${which} members match “${search}”` : `No ${which} members`;
}

/** Under an empty search's title, what the members search looks at. */
export const MEMBER_SEARCH_HINT = "Search looks at names, companies and phone numbers.";

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

/**
 * Whether a list may go on showing the rows of `previousKey` while those of `key` load: only when the two keys differ in
 * nothing but the search (`searchField` of the filters, the key's last part). Rows carry actions for the tab they were
 * listed under, so a tab's rows must never stand in for another's, even for a moment, with live Approve buttons.
 */
export function onlySearchChanged(previousKey: readonly unknown[] | undefined, key: readonly unknown[], searchField = "q"): boolean {
  if (!previousKey || previousKey.length !== key.length || key.length === 0) return false;
  const last = key.length - 1;
  if (previousKey.some((part, i) => i < last && part !== key[i])) return false;
  const before = previousKey[last];
  const now = key[last];
  if (!isFilters(before) || !isFilters(now)) return false;
  const fields = new Set([...Object.keys(before), ...Object.keys(now)]);
  fields.delete(searchField);
  return [...fields].every((field) => before[field] === now[field]);
}

function isFilters(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
