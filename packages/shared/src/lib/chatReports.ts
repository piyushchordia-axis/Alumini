import { DELETED_MEMBER_NAME, REPORT_STATUSES, REPORT_STATUS_LABELS, type ChatReportTargetKind, type ReportStatus } from "../constants";
import type { ChatReportResolveInput } from "../schemas/chat";
import type { AdminChatReportDto, AdminChatReportMessageDto, ChatMemberDto, DashboardDto } from "../types/dto";
import { statusTabs, type StatusTab } from "./admin";
import { uuidOf } from "./notifications";

/**
 * The admin console's chat reports, the same on both apps. A report as listed carries nobody's words: the messages and
 * the note of a reported request come only from the audited view, which writes an audit row on every call, so each app
 * keeps its answer in one component's state and never in a query or mutation cache.
 */

export const CHAT_REPORTS_SUBTITLE = "Private messages members reported. You see a message only if you choose to, and never a whole conversation.";

/** Beside a closed report's View button. */
export const CHAT_REPORT_VIEW_HINT = "Each view is recorded in the audit log.";

/**
 * What the phone app does with what a view showed: the app switcher and the recents screen keep a picture of the app,
 * and a screen under the member page stays mounted, so the text goes whenever this screen isn't the one in front.
 * Whether the system's picture is taken before the text goes is checked on a device (e2e/README), not by any script.
 */
export const CHAT_REPORT_PRIVACY_TEXT = "Messages you open are hidden again when you leave this screen, change tab or switch to another app. Seeing them again is another recorded view.";

/** In place of the thread when the reported message has been deleted since. */
export const CHAT_REPORT_MESSAGE_GONE_TEXT = "This message no longer exists.";

/** A member a report names, or DELETED_MEMBER_NAME once they have deleted their account. */
export function nameOrDeleted(member: Pick<ChatMemberDto, "fullName"> | null | undefined): string {
  return member?.fullName ?? DELETED_MEMBER_NAME;
}

/** Who wrote one of a report's messages: "System message" for a line the app wrote, which has no sender. */
export function chatReportSenderLabel(m: Pick<AdminChatReportMessageDto, "kind" | "sender">): string {
  return m.kind === "SYSTEM" ? "System message" : nameOrDeleted(m.sender);
}

/** "Hetal Shah reported Ravi Mehta". */
export function chatReportHeadline(r: Pick<AdminChatReportDto, "reporter" | "reported">): string {
  return `${nameOrDeleted(r.reporter)} reported ${nameOrDeleted(r.reported)}`;
}

/** The link from an opened report to the reported member's page in the console, where they can be suspended. */
export function chatReportMemberLinkText(reported: Pick<ChatMemberDto, "fullName">): string {
  return `${reported.fullName}'s member page`;
}

/** The button that opens a report: a reported message is shown with the messages around it, a request on its own. */
export function chatReportViewLabel(kind: ChatReportTargetKind): string {
  return kind === "MESSAGE" ? "View messages" : "View request";
}

/** The ways to close an open report: a message can also be removed, a request's note only kept or set aside. */
export type ChatReportCloseAction = "remove" | "resolve" | "dismiss";

/** What can be done to a report, in the order its buttons show: nothing once it's closed. */
export function chatReportActionsFor(r: Pick<AdminChatReportDto, "status" | "targetKind">): ChatReportCloseAction[] {
  if (r.status !== "OPEN") return [];
  return r.targetKind === "MESSAGE" ? ["remove", "resolve", "dismiss"] : ["resolve", "dismiss"];
}

/** Resolving keeps a reported message, so its button says so; a request has nothing to keep. */
export function chatReportResolveLabel(kind: ChatReportTargetKind): string {
  return kind === "MESSAGE" ? "Resolve, keep message" : "Resolve";
}

export function chatReportActionLabel(action: ChatReportCloseAction, kind: ChatReportTargetKind): string {
  return action === "remove" ? "Remove message" : action === "resolve" ? chatReportResolveLabel(kind) : "Dismiss";
}

/** The sheet or dialog that takes an optional note (up to 500 characters) before closing a report. */
export interface ChatReportPrompt {
  title: string;
  body?: string;
  confirm: string;
  tone: "primary" | "danger";
}

export function chatReportPrompt(action: ChatReportCloseAction, kind: ChatReportTargetKind): ChatReportPrompt {
  switch (action) {
    case "remove":
      return {
        title: "Remove this message?",
        body: "Everyone in the thread sees that it was removed. The sender is notified and sees your note in the app. All open reports on it are resolved.",
        confirm: "Remove",
        tone: "danger",
      };
    case "resolve":
      return { title: kind === "MESSAGE" ? "Resolve without removing" : "Resolve this report", body: "Add a note for the record.", confirm: "Resolve", tone: "primary" };
    case "dismiss":
      return { title: "Dismiss this report", confirm: "Dismiss", tone: "primary" };
  }
}

/** What closing a report sends: a resolve saying whether the message goes, or a dismiss, each with its note or null. */
export function chatReportCloseRequest(action: ChatReportCloseAction, note: string): { call: "resolve"; input: ChatReportResolveInput } | { call: "dismiss"; note: string | null } {
  const text = note.trim() || null;
  if (action === "dismiss") return { call: "dismiss", note: text };
  return { call: "resolve", input: { action: action === "remove" ? "REMOVE_MESSAGE" : "NONE", note: text } };
}

/** What closing a report did, for a toast or status line. */
export function chatReportDoneText(action: ChatReportCloseAction): string {
  return action === "dismiss" ? "Report dismissed" : "Report resolved";
}

/**
 * What closing a report failed with, for a screen whose sheet went (with the note) while the call was on its way, as
 * when the app went to the background: said there, so the admin doesn't take the report as closed.
 */
export function chatReportNotDoneText(action: ChatReportCloseAction, reason: string): string {
  return `${action === "dismiss" ? "The report wasn't dismissed" : "The report wasn't resolved"}: ${reason}`;
}

/** "No open chat reports". */
export function chatReportEmptyTitle(status: ReportStatus): string {
  return `No ${REPORT_STATUS_LABELS[status].toLowerCase()} chat reports`;
}

/** The status tabs, Open with the dashboard's count of open reports once it has loaded (the dashboard counts only those). */
export function chatReportTabs(d: Pick<DashboardDto, "openChatReports"> | undefined): StatusTab<ReportStatus>[] {
  return statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, d ? { OPEN: d.openChatReports } : undefined);
}

/** An app's router may give a repeated parameter as a list. */
const firstOf = (raw: unknown): unknown => (Array.isArray(raw) ? raw[0] : raw);

/** The tab from the address (?status=): anything that isn't a status opens Open rather than reaching the API as a 400. */
export function parseChatReportStatus(raw: unknown): ReportStatus {
  const value = firstOf(raw);
  return REPORT_STATUSES.find((s) => s === value) ?? "OPEN";
}

/** The report a link names (?item=, from a notice), only when it's an id. It is only ever scrolled to: opening it would write an audit row. */
export function parseChatReportItem(raw: unknown): string | undefined {
  return uuidOf(firstOf(raw));
}

/** How many pages the list looks through for a link's report before it says the report isn't there. */
export const CHAT_REPORT_LINK_PAGE_LIMIT = 5;

/** A link's report not in the list: handled since, by this admin elsewhere or by another, or older than the pages looked through. */
export const CHAT_REPORT_LINK_MISSING_TEXT = "That report isn't in this list any more: it may have been handled already.";

/**
 * What the list does about the report a link named: wait for an answer that isn't being fetched again, scroll to it, load
 * the next page (the list is newest first, so an older notice's report can be further down), or say it isn't there.
 */
export function chatReportLinkStep(list: { isSuccess: boolean; isFetching: boolean; hasNextPage: boolean; pages: number }, found: boolean): "wait" | "found" | "more" | "missing" {
  if (!list.isSuccess || list.isFetching) return "wait";
  if (found) return "found";
  return list.hasNextPage && list.pages < CHAT_REPORT_LINK_PAGE_LIMIT ? "more" : "missing";
}

/**
 * The one report whose words are open on a screen, by request. Every open starts a request and only that request's
 * answer is shown: an answer to one closed since (Hide, leaving the screen, the app going to the background) or to one
 * another open replaced is dropped, so it can't bring the text back.
 */
export interface ChatReportViewState<V> {
  /** The request whose answer may still be shown. */
  awaiting: { request: number; reportId: string } | null;
  shown: { reportId: string; view: V } | null;
  /** Why the last view failed, said in its report's row. */
  problem: { reportId: string; text: string } | null;
}

export type ChatReportViewEvent<V> =
  | { type: "open"; request: number; reportId: string }
  | { type: "answer"; request: number; view: V }
  /** `text` is null for a refusal the screen says elsewhere, such as a report handled meanwhile. */
  | { type: "failed"; request: number; text: string | null }
  | { type: "close" };

export const CHAT_REPORT_VIEW_CLOSED: ChatReportViewState<never> = { awaiting: null, shown: null, problem: null };

export function chatReportViewStep<V>(state: ChatReportViewState<V>, event: ChatReportViewEvent<V>): ChatReportViewState<V> {
  switch (event.type) {
    case "open":
      return { awaiting: { request: event.request, reportId: event.reportId }, shown: null, problem: null };
    case "answer":
      return state.awaiting?.request === event.request ? { awaiting: null, shown: { reportId: state.awaiting.reportId, view: event.view }, problem: null } : state;
    case "failed":
      return state.awaiting?.request === event.request ? { awaiting: null, shown: null, problem: event.text === null ? null : { reportId: state.awaiting.reportId, text: event.text } } : state;
    case "close":
      return state.awaiting || state.shown || state.problem ? CHAT_REPORT_VIEW_CLOSED : state;
  }
}

/**
 * Whether the open (or opening) report must close: the screen isn't the one in front or the app isn't active, or the
 * report has left the list, as when another admin closed it and the list was fetched again. `listed` is undefined while
 * the list has no answer to go by.
 */
export function chatReportViewMustClose(state: Pick<ChatReportViewState<unknown>, "awaiting" | "shown">, visible: boolean, listed: ReadonlySet<string> | undefined): boolean {
  const id = state.shown?.reportId ?? state.awaiting?.reportId;
  if (id === undefined) return false;
  return !visible || (listed !== undefined && !listed.has(id));
}
