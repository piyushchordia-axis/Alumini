import {
  BUSINESS_CATEGORY_LABELS,
  CHAT_GROUP_VISIBILITY_INFO,
  CONTENT_TYPES,
  CONTENT_TYPE_LABELS,
  MODERATION_STATUSES,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  type ContentType,
  type ModerationStatus,
  type ReportStatus,
  type TenantFeatures,
} from "../constants";
import { isOutOfDate } from "../client/ApiClientError";
import type { AdminReportDto, BusinessDto, ChatGroupContentDto, ContentDto, ContentPreviewDto, DashboardDto, JobDto, ModerationItemDto, PostDto } from "../types/dto";
import { formatCount, type ContentAction } from "./admin";
import { memberYearsLabel } from "./memberYears";
import { uuidOf, type NotificationTarget } from "./notifications";

/**
 * The moderation and reports queues of the admin console, the same on both apps: what an address asks for, how an item is
 * previewed, the two presses that approve a group, where "Open in app" goes, and the words of each outcome.
 */

/** An app's router may give a repeated parameter as a list. */
const first = (raw: unknown): unknown => (Array.isArray(raw) ? raw[0] : raw);

/** The moderation queue's tab from its address (?status=): anything that isn't a status opens Awaiting approval. */
export function parseModerationStatus(raw: unknown): ModerationStatus {
  const value = first(raw);
  return MODERATION_STATUSES.find((s) => s === value) ?? "PENDING";
}

/** The moderation queue's type filter (?type=): anything that isn't a content type shows every type. */
export function parseContentType(raw: unknown): ContentType | undefined {
  const value = first(raw);
  return CONTENT_TYPES.find((t) => t === value);
}

/** The reports queue's tab (?status=): anything that isn't a status opens Open. */
export function parseReportStatus(raw: unknown): ReportStatus {
  const value = first(raw);
  return REPORT_STATUSES.find((s) => s === value) ?? "OPEN";
}

/** The row a link asks a queue to open (?item=), only when it's an id: it's matched against rows, and a link can carry anything. */
export function parseItemId(raw: unknown): string | undefined {
  return uuidOf(first(raw));
}

/** An item of the moderation queue, which lists several tables: an id alone isn't known to be unique across them. */
export function moderationItemKey(item: Pick<ModerationItemDto, "contentType" | "id">): string {
  return `${item.contentType}:${item.id}`;
}

export type ContentPreviewKind =
  | { kind: "group"; content: ChatGroupContentDto }
  | { kind: "business"; content: BusinessDto }
  | { kind: "post"; content: PostDto }
  | { kind: "job"; content: JobDto }
  /** A comment's body, a funding listing's pitch or an event's description. */
  | { kind: "text"; text: string };

/**
 * How the admin's preview shows an item, by the type its row says it is. Each case still checks the answer has a field
 * only that type has, as several share one (a group, a business and an event all have a description, a post and a
 * comment a body), so an answer of another shape previews as nothing rather than as the wrong thing. No default: a
 * content type added without a preview here is a compile error.
 */
export function contentPreviewKind(type: ContentType, content: ContentDto): ContentPreviewKind | null {
  switch (type) {
    case "GROUP":
      return "visibility" in content && "memberCount" in content ? { kind: "group", content } : null;
    case "BUSINESS":
      return "category" in content ? { kind: "business", content } : null;
    case "POST":
      return "imageUrls" in content ? { kind: "post", content } : null;
    case "JOB":
      return "companyName" in content ? { kind: "job", content } : null;
    case "COMMENT":
      return "postId" in content ? { kind: "text", text: content.body } : null;
    case "FUNDING":
      return "pitch" in content ? { kind: "text", text: content.pitch } : null;
    case "EVENT":
      return "startAt" in content ? { kind: "text", text: content.description } : null;
  }
}

/** A group whose owner changed its name or description after it was approved: members still see the approved text. */
export function groupBeingEdited(g: Pick<ChatGroupContentDto, "name" | "description" | "approvedName" | "approvedDescription">): boolean {
  return g.approvedName !== null && (g.approvedName !== g.name || g.approvedDescription !== g.description);
}

/** "Open group · 4 members · owned by Hetal Shah". */
export function groupSummaryText(g: Pick<ChatGroupContentDto, "visibility" | "memberCount" | "owner">): string {
  const members = `${formatCount(g.memberCount)} ${g.memberCount === 1 ? "member" : "members"}`;
  return [CHAT_GROUP_VISIBILITY_INFO[g.visibility].label, members, g.owner ? `owned by ${g.owner.fullName}` : null].filter(Boolean).join(" · ");
}

export const GROUP_APPROVED_BEFORE_TEXT = "Until you decide, members see what was approved before:";
export const GROUP_PREVIEW_NOTE = "Chat messages are never shown here: only a group's name and description are reviewed.";
export const GROUP_REVIEW_HINT = "Check the group's name and description, then approve it.";
export const GROUP_CHANGED_HINT = "This group changed while you were looking at it. Check its name and description again, then approve it.";

export interface GroupReview {
  name: string;
  description: string | null;
}

/** A group's name and description as its preview shows them, or null when `shown` isn't a group's content. */
export function groupReviewOf(shown: ContentDto | null | undefined): GroupReview | null {
  return shown && "visibility" in shown && "memberCount" in shown ? { name: shown.name, description: shown.description } : null;
}

/**
 * What pressing Approve does: send, with what was reviewed for a group, or not yet, with what to do first. A group that
 * changed on screen gives what it says now as `seen`, to keep as what has been read.
 */
export type ApproveStep = { send: true; reviewed?: GroupReview } | { send: false; reason: "review"; hint: string } | { send: false; reason: "changed"; hint: string; seen: GroupReview };

/**
 * Approving a group publishes its name and description to its members, so it approves what the admin has read. `shown`
 * is the item's full content while it's open (otherwise null), and `seen` the name and description its preview first
 * showed since it opened, or since the last press that asked to check it again. The first press, with nothing shown,
 * opens the details and asks them to check; the second sends what they saw, which the API refuses (409) once the group
 * has changed since. A preview that refreshed in between to say something else (its owner edited it, and the console's
 * lists were refreshed) sends nothing, as what's on screen isn't what was read: it asks them to check again, and what it
 * says now becomes what was seen. Any other type approves at once.
 */
export function groupApproval(type: ContentType, shown: ContentDto | null | undefined, seen: GroupReview | null = null): ApproveStep {
  if (type !== "GROUP") return { send: true };
  const review = groupReviewOf(shown);
  if (!review) return { send: false, reason: "review", hint: GROUP_REVIEW_HINT };
  if (seen && (seen.name !== review.name || seen.description !== review.description)) return { send: false, reason: "changed", hint: GROUP_CHANGED_HINT, seen: review };
  return { send: true, reviewed: review };
}

/**
 * The `seen` to keep for groupApproval, from the one kept so far: kept once set, while the preview is open; otherwise
 * the name and description it shows first (`shown`, or nothing while it loads); nothing once it closes. Returns `seen`
 * itself when nothing changes, so a screen can store it as state and set it only when this differs.
 */
export function groupSeenNext(seen: GroupReview | null, open: boolean, shown: ContentDto | null | undefined): GroupReview | null {
  if (!open) return null;
  return seen ?? groupReviewOf(shown);
}

/** "Retail · Surat". */
export function businessSummaryText(b: Pick<BusinessDto, "category" | "city">): string {
  return [BUSINESS_CATEGORY_LABELS[b.category], b.city].filter(Boolean).join(" · ");
}

/** A listing's website, email and phone, as the preview shows them: text, never links, so an admin reads them without following them. */
export function businessContactLines(b: Pick<BusinessDto, "websiteUrl" | "contactEmail" | "contactPhone">): string[] {
  return [b.websiteUrl, b.contactEmail, b.contactPhone].filter((v): v is string => !!v);
}

/**
 * Where "Open in app" takes an admin: the item's page in the member app, or null where there is none to open. A group's
 * page would be its members' conversation, which admins don't get to open; a comment has no page of its own; and a
 * section switched off has no pages. No default: a content type added without an answer here is a compile error.
 */
export function adminContentTarget(type: ContentType, id: string, features: TenantFeatures): NotificationTarget | null {
  switch (type) {
    case "POST":
      return features.feed ? { kind: "post", id } : null;
    case "JOB":
      return features.jobs ? { kind: "job", id } : null;
    case "FUNDING":
      return features.funding ? { kind: "funding", id } : null;
    case "EVENT":
      return features.events ? { kind: "event", id } : null;
    case "BUSINESS":
      return features.businesses ? { kind: "business", id } : null;
    case "GROUP":
    case "COMMENT":
      return null;
  }
}

const ACTION_DONE: Readonly<Record<ContentAction, string>> = { approve: "approved", reject: "rejected", remove: "removed", restore: "restored" };

/** What a moderation action did, for a toast or status line: "Job approved", "Post restored". */
export function moderationOutcomeText(type: ContentType, action: ContentAction): string {
  return `${CONTENT_TYPE_LABELS[type]} ${ACTION_DONE[action]}`;
}

export function pinOutcomeText(pinned: boolean): string {
  return pinned ? "Pinned to the top of the feed" : "Unpinned";
}

/** "1 report", "2 reports". */
export function reportCountLabel(n: number): string {
  return `${formatCount(n)} ${n === 1 ? "report" : "reports"}`;
}

/** A queue row's byline, with `ago` already written: "by Nisha Modi (2010–present) · 3h ago". */
export function moderationBylineText(item: Pick<ModerationItemDto, "author">, ago: string): string {
  if (!item.author) return `by a deleted member · ${ago}`;
  const years = memberYearsLabel(item.author);
  return `by ${item.author.fullName}${years ? ` (${years})` : ""} · ${ago}`;
}

export const MODERATION_EMPTY_TITLE = "Nothing to review";
const MODERATION_EMPTY: Readonly<Record<ModerationStatus, string>> = {
  PENDING: "Nothing is waiting for review.",
  APPROVED: "No published content.",
  REJECTED: "No rejected content.",
  REMOVED: "No removed content.",
};

/** Under MODERATION_EMPTY_TITLE, what an empty tab holds none of. */
export function moderationEmptyText(status: ModerationStatus): string {
  return MODERATION_EMPTY[status];
}

export const MODERATION_SUBTITLE = "Review what members post before (or after) it goes live";
export const REPORTS_SUBTITLE = "Content flagged by members";

/** One reason sheet or dialog of the console: its title, what it says, its confirm button and that button's tone. */
export interface ReasonPrompt {
  title: string;
  body?: string;
  confirm: string;
  tone: "primary" | "danger";
}

export type ReasonPromptKey = "reject" | "remove" | "reportRemove" | "reportResolve" | "reportDismiss";

/** The note-taking sheets of the moderation and reports queues, worded the same on both apps. A note is optional, up to 500 characters. */
export const ADMIN_REASON_PROMPTS: Readonly<Record<ReasonPromptKey, ReasonPrompt>> = {
  reject: { title: "Reject this content?", body: "The author sees your note and can edit and resubmit.", confirm: "Reject", tone: "danger" },
  remove: { title: "Remove this content?", body: "It disappears for members; you can restore it later.", confirm: "Remove", tone: "danger" },
  reportRemove: { title: "Remove the reported content?", body: "The author is notified; all open reports on it are resolved.", confirm: "Remove", tone: "danger" },
  reportResolve: { title: "Resolve without removing", body: "Add a note for the audit trail.", confirm: "Resolve", tone: "primary" },
  reportDismiss: { title: "Dismiss this report", confirm: "Dismiss", tone: "primary" },
};

/** A link's item that isn't in the queue's tab any more, on any page, as when another admin dealt with it first. */
export function itemGoneText(section: "moderation" | "reports"): string {
  return section === "moderation" ? "That item isn't waiting here any more. Another admin may have handled it." : "That report has already been handled.";
}

/** A link's item not found in the pages a queue looks through (LINKED_ROW_PAGE_LIMIT), with more still to come. */
export function itemFurtherText(section: "moderation" | "reports"): string {
  return section === "moderation" ? "That item is further down the queue. Scroll on to find it." : "That report is further down the list. Scroll on to find it.";
}

/** How many pages a queue looks through for a link's item before it stops looking and says it's further down. */
export const LINKED_ROW_PAGE_LIMIT = 10;

/** What a queue does about the row a link named: wait for an answer, open it, load the next page, or say why not. */
export type LinkedRowStep = "wait" | "found" | "more" | "gone" | "further";

/**
 * Where a queue stands on the row a link named (?item=, from a notice), from its list's state and whether its rows hold
 * that item. Only an answer fetched since the screen opened counts, with nothing still being fetched: a list cached from
 * an earlier visit can be from before the notice, missing a new item or still holding one handled since, so the screen
 * must fetch it again as it opens (refetchOnMount "always") and wait. The queue is newest first, so an older notice's
 * item can be pages down: while there's another page it loads it, up to LINKED_ROW_PAGE_LIMIT pages, rather than say the
 * item has gone. Gone only once every page has been looked through; past the limit, only that it's further down.
 */
export function linkedRowStep(list: { isSuccess: boolean; isFetchedAfterMount: boolean; isFetching: boolean; hasNextPage: boolean; pages: number }, found: boolean): LinkedRowStep {
  if (!list.isSuccess || !list.isFetchedAfterMount || list.isFetching) return "wait";
  if (found) return "found";
  if (!list.hasNextPage) return "gone";
  return list.pages < LINKED_ROW_PAGE_LIMIT ? "more" : "further";
}

/**
 * Where a queue says a one-tap action (approve, restore, pin) was refused. Above the list ("queue") when the item was
 * decided elsewhere (409 INVALID_TRANSITION), has gone (404) or isn't the admin's to handle (403): its row leaves the tab
 * once the list refetches, and a message in it would go too. In the row otherwise, which stays: a group changed meanwhile
 * (409 CONFLICT), a cap on restoring, a refused request or a failed connection.
 */
export function moderationRefusalPlace(err: unknown): "queue" | "row" {
  return isOutOfDate(err) && (err.status !== 409 || err.code === "INVALID_TRANSITION") ? "queue" : "row";
}

export interface QueueTabCounts {
  moderation: Partial<Record<ModerationStatus, number>>;
  reports: Partial<Record<ReportStatus, number>>;
  chatReports: Partial<Record<ReportStatus, number>>;
}

/** The queues' tab counts, from the console's dashboard, which counts only what waits: or undefined until it has loaded. */
export function queueTabCounts(d: Pick<DashboardDto, "pendingContent" | "openReports" | "openChatReports"> | undefined): QueueTabCounts | undefined {
  return d ? { moderation: { PENDING: d.pendingContent }, reports: { OPEN: d.openReports }, chatReports: { OPEN: d.openChatReports } } : undefined;
}

/**
 * Whether a report's row shows the content's title above its excerpt. A post's title is only the start of its body, but a
 * listing's name is its own text and may be what was reported.
 */
export function reportShowsTitle(content: Pick<ContentPreviewDto, "title" | "excerpt">): boolean {
  return !!content.excerpt && !!content.title && !content.excerpt.startsWith(content.title);
}

/** "Reported by Jignesh Patel · 2h ago", with `ago` already written. */
export function reportedByText(report: Pick<AdminReportDto, "reporter">, ago: string): string {
  return `Reported by ${report.reporter.fullName} · ${ago}`;
}

/** "No open reports". */
export function reportEmptyTitle(status: ReportStatus): string {
  return `No ${REPORT_STATUS_LABELS[status].toLowerCase()} reports`;
}

/** In place of a report's content once that has been deleted. */
export const REPORT_CONTENT_GONE_TEXT = "Content no longer exists";
