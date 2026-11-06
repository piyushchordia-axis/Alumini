import {
  CHAT_REPORT_LINK_PAGE_LIMIT,
  CHAT_REPORT_TARGET_KINDS,
  CHAT_REPORT_VIEW_CLOSED,
  DELETED_MEMBER_NAME,
  REPORT_STATUSES,
  chatReportActionLabel,
  chatReportActionsFor,
  chatReportCloseRequest,
  chatReportDoneText,
  chatReportEmptyTitle,
  chatReportHeadline,
  chatReportLinkStep,
  chatReportMemberLinkText,
  chatReportNotDoneText,
  chatReportPrompt,
  chatReportResolveLabel,
  chatReportResolveSchema,
  chatReportSenderLabel,
  chatReportTabs,
  chatReportViewLabel,
  chatReportViewMustClose,
  chatReportViewStep,
  nameOrDeleted,
  parseChatReportItem,
  parseChatReportStatus,
  type ChatReportViewState,
} from "@illuminize/shared";
import { describe, expect, it } from "vitest";

const ID = "3f2b8a4e-9c1d-4e5f-8a7b-0c1d2e3f4a5b";
const hetal = { id: "m1", fullName: "Hetal Shah", avatarUrl: null };
const ravi = { id: "m2", fullName: "Ravi Mehta", avatarUrl: null };

describe("a chat report's names", () => {
  it("names a member who deleted their account as a deleted member", () => {
    expect(nameOrDeleted(hetal)).toBe("Hetal Shah");
    expect(nameOrDeleted(null)).toBe(DELETED_MEMBER_NAME);
    expect(nameOrDeleted(undefined)).toBe(DELETED_MEMBER_NAME);
  });

  it("says who reported whom, either of them perhaps deleted", () => {
    expect(chatReportHeadline({ reporter: hetal, reported: ravi })).toBe("Hetal Shah reported Ravi Mehta");
    expect(chatReportHeadline({ reporter: null, reported: ravi })).toBe("Deleted member reported Ravi Mehta");
    expect(chatReportHeadline({ reporter: hetal, reported: null })).toBe("Hetal Shah reported Deleted member");
  });

  it("labels a system line as one, whatever its sender, and a deleted sender as deleted", () => {
    expect(chatReportSenderLabel({ kind: "TEXT", sender: ravi })).toBe("Ravi Mehta");
    expect(chatReportSenderLabel({ kind: "TEXT", sender: null })).toBe(DELETED_MEMBER_NAME);
    expect(chatReportSenderLabel({ kind: "SYSTEM", sender: null })).toBe("System message");
    expect(chatReportSenderLabel({ kind: "SYSTEM", sender: ravi })).toBe("System message");
  });

  it("names the reported member's page", () => {
    expect(chatReportMemberLinkText(ravi)).toBe("Ravi Mehta's member page");
  });
});

describe("a chat report's buttons", () => {
  it("opens a message with the messages around it, and a request on its own", () => {
    expect(CHAT_REPORT_TARGET_KINDS.map(chatReportViewLabel)).toEqual(["View messages", "View request", "View request"]);
    expect(CHAT_REPORT_TARGET_KINDS.map(chatReportResolveLabel)).toEqual(["Resolve, keep message", "Resolve", "Resolve"]);
  });

  it("offers removing only a message, and nothing on a report that's closed", () => {
    expect(chatReportActionsFor({ status: "OPEN", targetKind: "MESSAGE" })).toEqual(["remove", "resolve", "dismiss"]);
    for (const kind of ["MENTORSHIP_NOTE", "REFERRAL_NOTE"] as const) expect(chatReportActionsFor({ status: "OPEN", targetKind: kind }), kind).toEqual(["resolve", "dismiss"]);
    for (const status of ["RESOLVED", "DISMISSED"] as const) for (const kind of CHAT_REPORT_TARGET_KINDS) expect(chatReportActionsFor({ status, targetKind: kind })).toEqual([]);
    expect(chatReportActionsFor({ status: "OPEN", targetKind: "MESSAGE" }).map((a) => chatReportActionLabel(a, "MESSAGE"))).toEqual(["Remove message", "Resolve, keep message", "Dismiss"]);
    expect(chatReportActionLabel("resolve", "REFERRAL_NOTE")).toBe("Resolve");
  });

  it("asks before each way of closing a report, in the web console's words, the removal as destructive", () => {
    expect(chatReportPrompt("remove", "MESSAGE")).toEqual({
      title: "Remove this message?",
      body: "Everyone in the thread sees that it was removed. The sender is notified and sees your note in the app. All open reports on it are resolved.",
      confirm: "Remove",
      tone: "danger",
    });
    expect(chatReportPrompt("resolve", "MESSAGE")).toEqual({ title: "Resolve without removing", body: "Add a note for the record.", confirm: "Resolve", tone: "primary" });
    expect(chatReportPrompt("resolve", "MENTORSHIP_NOTE").title).toBe("Resolve this report");
    expect(chatReportPrompt("dismiss", "MESSAGE")).toEqual({ title: "Dismiss this report", confirm: "Dismiss", tone: "primary" });
  });

  it("sends whether the message goes, and the note or nothing, in a shape the API takes", () => {
    expect(chatReportCloseRequest("remove", " Threatening another member ")).toEqual({ call: "resolve", input: { action: "REMOVE_MESSAGE", note: "Threatening another member" } });
    expect(chatReportCloseRequest("resolve", "")).toEqual({ call: "resolve", input: { action: "NONE", note: null } });
    expect(chatReportCloseRequest("dismiss", "   ")).toEqual({ call: "dismiss", note: null });
    expect(chatReportCloseRequest("dismiss", "Not abuse")).toEqual({ call: "dismiss", note: "Not abuse" });
    for (const action of ["remove", "resolve"] as const) {
      const request = chatReportCloseRequest(action, "a note");
      if (request.call !== "resolve") throw new Error(`${action} didn't resolve`);
      expect(chatReportResolveSchema.parse(request.input), action).toEqual(request.input);
    }
    expect(chatReportDoneText("remove")).toBe("Report resolved");
    expect(chatReportDoneText("resolve")).toBe("Report resolved");
    expect(chatReportDoneText("dismiss")).toBe("Report dismissed");
    expect(chatReportNotDoneText("remove", "Network request failed")).toBe("The report wasn't resolved: Network request failed");
    expect(chatReportNotDoneText("resolve", "e")).toBe("The report wasn't resolved: e");
    expect(chatReportNotDoneText("dismiss", "e")).toBe("The report wasn't dismissed: e");
  });
});

describe("the chat reports list", () => {
  it("keeps the web console's empty title for each tab", () => {
    expect(REPORT_STATUSES.map(chatReportEmptyTitle)).toEqual(["No open chat reports", "No resolved chat reports", "No dismissed chat reports"]);
  });

  it("counts the Open tab from the dashboard once it has loaded, and no other", () => {
    expect(chatReportTabs(undefined)).toEqual([
      { value: "OPEN", label: "Open" },
      { value: "RESOLVED", label: "Resolved" },
      { value: "DISMISSED", label: "Dismissed" },
    ]);
    expect(chatReportTabs({ openChatReports: 3 })).toEqual([
      { value: "OPEN", label: "Open", count: 3 },
      { value: "RESOLVED", label: "Resolved" },
      { value: "DISMISSED", label: "Dismissed" },
    ]);
    expect(chatReportTabs({ openChatReports: 0 })[0]).toEqual({ value: "OPEN", label: "Open", count: 0 });
  });

  it("opens Open for anything in the address that isn't a status", () => {
    expect(parseChatReportStatus("RESOLVED")).toBe("RESOLVED");
    expect(parseChatReportStatus(["DISMISSED", "OPEN"])).toBe("DISMISSED");
    for (const raw of [undefined, null, "", "resolved", "PENDING", 3, ["nope"]]) expect(parseChatReportStatus(raw), JSON.stringify(raw)).toBe("OPEN");
  });

  it("takes a link's report only when it's an id, as a link can carry anything", () => {
    expect(parseChatReportItem(ID)).toBe(ID);
    expect(parseChatReportItem([ID, "x"])).toBe(ID);
    for (const raw of [undefined, "", "../members", `${ID}&status=RESOLVED`, 42, null]) expect(parseChatReportItem(raw), JSON.stringify(raw)).toBeUndefined();
  });

  it("looks for a link's report only in an answer that isn't being fetched again, page after page up to a limit", () => {
    const list = (over: Partial<Parameters<typeof chatReportLinkStep>[0]> = {}) => ({ isSuccess: true, isFetching: false, hasNextPage: false, pages: 1, ...over });
    expect(chatReportLinkStep(list({ isSuccess: false }), false)).toBe("wait");
    // A cached answer being fetched again may be from before the notice.
    expect(chatReportLinkStep(list({ isFetching: true }), true)).toBe("wait");
    expect(chatReportLinkStep(list(), true)).toBe("found");
    expect(chatReportLinkStep(list({ hasNextPage: true }), false)).toBe("more");
    expect(chatReportLinkStep(list({ hasNextPage: true, pages: CHAT_REPORT_LINK_PAGE_LIMIT }), false)).toBe("missing");
    expect(chatReportLinkStep(list(), false)).toBe("missing");
  });
});

describe("chatReportViewStep", () => {
  type View = { words: string };
  const step = (state: ChatReportViewState<View>, ...events: Parameters<typeof chatReportViewStep<View>>[1][]) => events.reduce((s, e) => chatReportViewStep(s, e), state);
  const closed: ChatReportViewState<View> = CHAT_REPORT_VIEW_CLOSED;
  const words = { words: "e2e-chat-7Q4X" };

  it("shows the answer to the request it's waiting for", () => {
    const opening = step(closed, { type: "open", request: 1, reportId: "a" });
    expect(opening).toEqual({ awaiting: { request: 1, reportId: "a" }, shown: null, problem: null });
    expect(step(opening, { type: "answer", request: 1, view: words })).toEqual({ awaiting: null, shown: { reportId: "a", view: words }, problem: null });
  });

  it("drops an answer that lands after the report was closed, as by Hide, leaving the screen or the app going to the background", () => {
    expect(step(closed, { type: "open", request: 1, reportId: "a" }, { type: "close" }, { type: "answer", request: 1, view: words })).toEqual(closed);
  });

  it("drops an answer to a report another open replaced, and shows that one's", () => {
    const state = step(closed, { type: "open", request: 1, reportId: "a" }, { type: "open", request: 2, reportId: "b" }, { type: "answer", request: 1, view: words });
    expect(state).toEqual({ awaiting: { request: 2, reportId: "b" }, shown: null, problem: null });
    expect(step(state, { type: "answer", request: 2, view: { words: "b's" } }).shown).toEqual({ reportId: "b", view: { words: "b's" } });
  });

  it("closes the open report's words when another is opened", () => {
    const open = step(closed, { type: "open", request: 1, reportId: "a" }, { type: "answer", request: 1, view: words });
    expect(step(open, { type: "open", request: 2, reportId: "b" }).shown).toBeNull();
  });

  it("says a failure in the report's row, only for the request waited for, and nothing for one said elsewhere", () => {
    const opening = step(closed, { type: "open", request: 1, reportId: "a" });
    expect(step(opening, { type: "failed", request: 1, text: "Too many requests" })).toEqual({ awaiting: null, shown: null, problem: { reportId: "a", text: "Too many requests" } });
    expect(step(opening, { type: "failed", request: 1, text: null })).toEqual(closed);
    expect(step(opening, { type: "close" }, { type: "failed", request: 1, text: "late" })).toEqual(closed);
    // Opening again clears the last failure.
    expect(step(opening, { type: "failed", request: 1, text: "e" }, { type: "open", request: 2, reportId: "a" }).problem).toBeNull();
  });

  it("returns the same state for a close with nothing open, so a screen closing it on every blur doesn't render again", () => {
    expect(chatReportViewStep(closed, { type: "close" })).toBe(closed);
  });
});

describe("chatReportViewMustClose", () => {
  const listed = new Set(["a", "b"]);
  const shown = { awaiting: null, shown: { reportId: "a", view: {} } };
  const opening = { awaiting: { request: 1, reportId: "a" }, shown: null };

  it("closes the words, or a view on its way, once the app isn't active", () => {
    expect(chatReportViewMustClose(shown, false, listed)).toBe(true);
    expect(chatReportViewMustClose(opening, false, listed)).toBe(true);
    expect(chatReportViewMustClose(shown, true, listed)).toBe(false);
  });

  it("closes them once the report has left the list, and not while the list has no answer to go by", () => {
    expect(chatReportViewMustClose(shown, true, new Set(["b"]))).toBe(true);
    expect(chatReportViewMustClose(opening, true, new Set())).toBe(true);
    expect(chatReportViewMustClose(shown, true, undefined)).toBe(false);
  });

  it("has nothing to close with nothing open", () => {
    expect(chatReportViewMustClose(CHAT_REPORT_VIEW_CLOSED, false, new Set())).toBe(false);
  });
});
