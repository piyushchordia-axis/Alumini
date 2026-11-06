import {
  ADMIN_REASON_PROMPTS,
  CONTENT_TYPES,
  GROUP_CHANGED_HINT,
  GROUP_REVIEW_HINT,
  LINKED_ROW_PAGE_LIMIT,
  MODERATION_STATUSES,
  MODERATION_STATUS_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  TENANT_FEATURES,
  adminContentTarget,
  businessContactLines,
  businessSummaryText,
  contentPreviewKind,
  groupApproval,
  groupBeingEdited,
  groupReviewOf,
  groupSeenNext,
  groupSummaryText,
  itemFurtherText,
  itemGoneText,
  linkedRowStep,
  moderationBylineText,
  moderationEmptyText,
  moderationItemKey,
  moderationOutcomeText,
  moderationRefusalPlace,
  parseContentType,
  parseItemId,
  parseModerationStatus,
  parseReportStatus,
  pinOutcomeText,
  queueTabCounts,
  reportCountLabel,
  reportEmptyTitle,
  reportShowsTitle,
  reportedByText,
  statusTabs,
  type ContentDto,
  type ContentType,
  type ErrorCode,
  type MemberCardDto,
  type TenantFeatures,
} from "@illuminize/shared";
import { ApiClientError } from "@illuminize/shared/client";
import { describe, expect, it } from "vitest";
import { targetHref as mobileTargetHref } from "../../../mobile/src/lib/notificationLinks";
import { targetHref as webTargetHref } from "../../../web/src/lib/notificationLinks";

const ID = "3f2b8a4e-9c1d-4e5f-8a7b-0c1d2e3f4a5b";
const ALL_ON = Object.fromEntries(TENANT_FEATURES.map((f) => [f, true])) as TenantFeatures;
const author = { fullName: "Nisha Modi", startYear: 2010, batchYear: null } as MemberCardDto;

// Each type's answer as GET /admin/moderation/:type/:id gives it, cut to what the previews read. A group, a business and
// an event all have a description, and a post and a comment a body.
const GROUP = { id: ID, name: "Surat traders", description: "Buying and selling", approvedName: null, approvedDescription: null, visibility: "OPEN", memberCount: 4, owner: author, archived: false };
const BUSINESS = { id: ID, name: "Shah Fabrics", category: "RETAIL", description: "Cotton blends", logoUrl: null, city: "Surat", websiteUrl: "https://example.com", contactEmail: "hi@example.com", contactPhone: null };
const EVENT = { id: ID, title: "Garba night", description: "Nine evenings of Garba", startAt: "2026-11-20T13:30:00Z", city: "Ahmedabad" };
const POST = { id: ID, body: "Any members in New Jersey?", imageUrls: [], poll: null };
const COMMENT = { id: ID, postId: ID, body: "Count me in" };
const FUNDING = { id: ID, title: "Angel cheques", pitch: "Writing cheques into SMEs" };
const JOB = { id: ID, title: "Export Documentation Executive", companyName: "Shah Fabrics", description: "Handle shipping documents" };
const FIXTURES: Record<ContentType, ContentDto> = { GROUP, BUSINESS, EVENT, POST, COMMENT, FUNDING, JOB } as unknown as Record<ContentType, ContentDto>;

describe("the queues' addresses", () => {
  it("open Awaiting approval, Open and every type unless the address names a real one", () => {
    for (const s of MODERATION_STATUSES) expect(parseModerationStatus(s)).toBe(s);
    for (const raw of [undefined, "", "pending", "APPROVED ", ["REMOVED", "PENDING"], 3]) expect(parseModerationStatus(raw), String(raw)).toBe(Array.isArray(raw) ? "REMOVED" : "PENDING");
    for (const t of CONTENT_TYPES) expect(parseContentType(t)).toBe(t);
    for (const raw of [undefined, "", "post", "CHAT", ["JOB"]]) expect(parseContentType(raw), String(raw)).toBe(Array.isArray(raw) ? "JOB" : undefined);
    for (const s of REPORT_STATUSES) expect(parseReportStatus(s)).toBe(s);
    expect(parseReportStatus("closed")).toBe("OPEN");
  });

  it("take an item only when it's an id", () => {
    expect(parseItemId(ID)).toBe(ID);
    expect(parseItemId([ID, "x"])).toBe(ID);
    for (const raw of [undefined, "", "../admin", `${ID} `, 42]) expect(parseItemId(raw), String(raw)).toBeUndefined();
  });

  it("key an item by its type and id, as ids are only unique within a table", () => {
    expect(moderationItemKey({ contentType: "POST", id: ID })).toBe(`POST:${ID}`);
    expect(moderationItemKey({ contentType: "JOB", id: ID })).not.toBe(moderationItemKey({ contentType: "POST", id: ID }));
  });
});

describe("contentPreviewKind", () => {
  it("previews each type its own way", () => {
    const kinds = Object.fromEntries(CONTENT_TYPES.map((t) => [t, contentPreviewKind(t, FIXTURES[t])]));
    expect(kinds).toEqual({
      GROUP: { kind: "group", content: GROUP },
      BUSINESS: { kind: "business", content: BUSINESS },
      POST: { kind: "post", content: POST },
      JOB: { kind: "job", content: JOB },
      COMMENT: { kind: "text", text: "Count me in" },
      FUNDING: { kind: "text", text: "Writing cheques into SMEs" },
      EVENT: { kind: "text", text: "Nine evenings of Garba" },
    });
  });

  it("goes by the row's type, so content sharing a field with another type is never previewed as that type", () => {
    // A business and a group have a description, as an event does; a comment has a body, as a post does.
    expect(contentPreviewKind("EVENT", FIXTURES.BUSINESS)).toBeNull();
    expect(contentPreviewKind("EVENT", FIXTURES.GROUP)).toBeNull();
    expect(contentPreviewKind("BUSINESS", FIXTURES.EVENT)).toBeNull();
    expect(contentPreviewKind("GROUP", FIXTURES.BUSINESS)).toBeNull();
    expect(contentPreviewKind("POST", FIXTURES.COMMENT)).toBeNull();
    expect(contentPreviewKind("COMMENT", FIXTURES.POST)).toBeNull();
    expect(contentPreviewKind("JOB", FIXTURES.FUNDING)).toBeNull();
    expect(contentPreviewKind("FUNDING", FIXTURES.JOB)).toBeNull();
  });
});

describe("a group under review", () => {
  it("is being edited once its approved name or description differs from what it says now", () => {
    expect(groupBeingEdited({ name: "A", description: "d", approvedName: null, approvedDescription: null })).toBe(false);
    expect(groupBeingEdited({ name: "B", description: "d", approvedName: "A", approvedDescription: "d" })).toBe(true);
    expect(groupBeingEdited({ name: "A", description: "e", approvedName: "A", approvedDescription: "d" })).toBe(true);
    expect(groupBeingEdited({ name: "A", description: null, approvedName: "A", approvedDescription: "d" })).toBe(true);
    expect(groupBeingEdited({ name: "A", description: "d", approvedName: "A", approvedDescription: "d" })).toBe(false);
  });

  it("is approved in two presses: the first, with nothing shown, asks to check it; the second sends what was shown", () => {
    const review = { send: false, reason: "review", hint: GROUP_REVIEW_HINT };
    expect(groupApproval("GROUP", null)).toEqual(review);
    expect(groupApproval("GROUP", undefined)).toEqual(review);
    // What's open isn't a group's answer (a mismatched load): nothing is sent.
    expect(groupApproval("GROUP", FIXTURES.BUSINESS)).toEqual(review);
    expect(groupApproval("GROUP", FIXTURES.GROUP)).toEqual({ send: true, reviewed: { name: "Surat traders", description: "Buying and selling" } });
    expect(groupApproval("GROUP", { ...GROUP, description: null } as unknown as ContentDto)).toEqual({ send: true, reviewed: { name: "Surat traders", description: null } });
    // Shown as it was first seen: sent.
    expect(groupApproval("GROUP", FIXTURES.GROUP, { name: "Surat traders", description: "Buying and selling" })).toEqual({ send: true, reviewed: { name: "Surat traders", description: "Buying and selling" } });
  });

  it("sends nothing when its preview refreshed to say something else than what was first seen, and asks to check it again", () => {
    const now = { name: "Surat traders", description: "Buying and selling" };
    // Renamed, or its description changed or cleared, while the admin was reading it.
    for (const seen of [{ name: "Surat chapter", description: "Buying and selling" }, { name: "Surat traders", description: "Chapter news" }, { name: "Surat traders", description: null }]) {
      expect(groupApproval("GROUP", FIXTURES.GROUP, seen), JSON.stringify(seen)).toEqual({ send: false, reason: "changed", hint: GROUP_CHANGED_HINT, seen: now });
    }
    expect(groupApproval("GROUP", { ...GROUP, description: null } as unknown as ContentDto, now)).toEqual({ send: false, reason: "changed", hint: GROUP_CHANGED_HINT, seen: { name: "Surat traders", description: null } });
    // The press after, with what it says now kept as seen, sends it.
    const step = groupApproval("GROUP", FIXTURES.GROUP, { name: "Surat chapter", description: "Buying and selling" });
    if (step.send || step.reason !== "changed") throw new Error("expected a changed group to send nothing");
    expect(groupApproval("GROUP", FIXTURES.GROUP, step.seen)).toEqual({ send: true, reviewed: now });
  });

  it("keeps what its preview first showed while it's open, and forgets it once closed", () => {
    const first = { name: "Surat traders", description: "Buying and selling" };
    // Opened, still loading: nothing seen yet; then the first answer is what was seen.
    expect(groupSeenNext(null, true, undefined)).toBeNull();
    expect(groupSeenNext(null, true, FIXTURES.GROUP)).toEqual(first);
    // A refresh saying something else later doesn't replace it, and it's the same value, so a screen sets nothing.
    const renamed = { ...GROUP, name: "Something else" } as unknown as ContentDto;
    expect(groupSeenNext(first, true, renamed)).toBe(first);
    expect(groupSeenNext(first, true, FIXTURES.GROUP)).toBe(first);
    // Closed: forgotten, so opening it again starts from what it shows then.
    expect(groupSeenNext(first, false, FIXTURES.GROUP)).toBeNull();
    expect(groupSeenNext(null, false, FIXTURES.GROUP)).toBeNull();
    // Not a group's content: nothing to keep.
    expect(groupSeenNext(null, true, FIXTURES.BUSINESS)).toBeNull();
    expect(groupReviewOf(FIXTURES.GROUP)).toEqual(first);
    expect(groupReviewOf(FIXTURES.EVENT)).toBeNull();
    expect(groupReviewOf(null)).toBeNull();
  });

  it("is the only type that needs looking at first", () => {
    for (const type of CONTENT_TYPES.filter((t) => t !== "GROUP")) {
      expect(groupApproval(type, null), type).toEqual({ send: true });
      expect(groupApproval(type, FIXTURES[type]), type).toEqual({ send: true });
      expect(groupApproval(type, FIXTURES[type], { name: "Other", description: null }), type).toEqual({ send: true });
    }
  });

  it("is summed up with its kind, members and owner", () => {
    expect(groupSummaryText({ visibility: "OPEN", memberCount: 4, owner: author })).toBe("Open group · 4 members · owned by Nisha Modi");
    expect(groupSummaryText({ visibility: "INVITE_ONLY", memberCount: 1, owner: null })).toBe("Invite-only group · 1 member");
  });
});

describe("a business listing's preview", () => {
  it("says its category and city, and lists its contacts as text", () => {
    expect(businessSummaryText({ category: "RETAIL", city: "Surat" })).toBe("Retail · Surat");
    expect(businessSummaryText({ category: "RETAIL", city: null })).toBe("Retail");
    expect(businessContactLines({ websiteUrl: "https://example.com", contactEmail: "hi@example.com", contactPhone: null })).toEqual(["https://example.com", "hi@example.com"]);
    expect(businessContactLines({ websiteUrl: null, contactEmail: null, contactPhone: null })).toEqual([]);
  });
});

describe("adminContentTarget", () => {
  const sectionOf: Partial<Record<ContentType, keyof TenantFeatures>> = { POST: "feed", JOB: "jobs", FUNDING: "funding", EVENT: "events", BUSINESS: "businesses" };
  const kindOf: Partial<Record<ContentType, string>> = { POST: "post", JOB: "job", FUNDING: "funding", EVENT: "event", BUSINESS: "business" };

  it("opens an item's page in the member app while its section is on", () => {
    for (const type of CONTENT_TYPES) {
      const section = sectionOf[type];
      if (!section) continue;
      expect(adminContentTarget(type, ID, ALL_ON), type).toEqual({ kind: kindOf[type], id: ID });
      expect(adminContentTarget(type, ID, { ...ALL_ON, [section]: false }), `${type} with ${section} off`).toBeNull();
    }
  });

  it("opens nothing for a group, whose page is its members' conversation, or a comment, which has no page", () => {
    expect(adminContentTarget("GROUP", ID, ALL_ON)).toBeNull();
    expect(adminContentTarget("COMMENT", ID, ALL_ON)).toBeNull();
  });

  it("lands on the same member pages as a notice's link, on each app", () => {
    const target = (type: ContentType) => adminContentTarget(type, ID, ALL_ON)!;
    expect(mobileTargetHref("demo", target("POST"), { isAdmin: true })).toBe(`/t/demo/feed/${ID}`);
    expect(mobileTargetHref("demo", target("JOB"), { isAdmin: true })).toBe(`/t/demo/jobs/${ID}`);
    expect(mobileTargetHref("demo", target("BUSINESS"), { isAdmin: true })).toBe(`/t/demo/businesses/${ID}`);
    expect(webTargetHref("demo", target("POST"), { isAdmin: true })).toBe(`/t/demo/app/feed/${ID}`);
    expect(webTargetHref("demo", target("FUNDING"), { isAdmin: true })).toBe(`/t/demo/app/funding/${ID}`);
    expect(webTargetHref("demo", target("EVENT"), { isAdmin: true })).toBe(`/t/demo/app/events/${ID}`);
  });
});

describe("the queues' words", () => {
  it("say what an action did, a restore as restored", () => {
    expect(moderationOutcomeText("JOB", "approve")).toBe("Job approved");
    expect(moderationOutcomeText("BUSINESS", "approve")).toBe("Business listing approved");
    expect(moderationOutcomeText("POST", "reject")).toBe("Post rejected");
    expect(moderationOutcomeText("POST", "remove")).toBe("Post removed");
    expect(moderationOutcomeText("POST", "restore")).toBe("Post restored");
    expect(pinOutcomeText(true)).toBe("Pinned to the top of the feed");
    expect(pinOutcomeText(false)).toBe("Unpinned");
  });

  it("count reports and name the author, or say they've gone", () => {
    expect(reportCountLabel(1)).toBe("1 report");
    expect(reportCountLabel(2)).toBe("2 reports");
    expect(reportCountLabel(1200)).toBe("1,200 reports");
    expect(moderationBylineText({ author }, "3h ago")).toBe("by Nisha Modi (2010–present) · 3h ago");
    expect(moderationBylineText({ author: { ...author, startYear: 2006, batchYear: 2010 } }, "3h ago")).toBe("by Nisha Modi (2006–2010) · 3h ago");
    expect(moderationBylineText({ author: null }, "3h ago")).toBe("by a deleted member · 3h ago");
  });

  it("say what an empty tab holds none of", () => {
    expect(Object.fromEntries(MODERATION_STATUSES.map((s) => [s, moderationEmptyText(s)]))).toEqual({
      PENDING: "Nothing is waiting for review.",
      APPROVED: "No published content.",
      REJECTED: "No rejected content.",
      REMOVED: "No removed content.",
    });
    expect(REPORT_STATUSES.map(reportEmptyTitle)).toEqual(["No open reports", "No resolved reports", "No dismissed reports"]);
  });

  it("word every reason sheet as the web console's dialogs did", () => {
    expect(ADMIN_REASON_PROMPTS.reject).toEqual({ title: "Reject this content?", body: "The author sees your note and can edit and resubmit.", confirm: "Reject", tone: "danger" });
    expect(ADMIN_REASON_PROMPTS.remove).toEqual({ title: "Remove this content?", body: "It disappears for members; you can restore it later.", confirm: "Remove", tone: "danger" });
    expect(ADMIN_REASON_PROMPTS.reportRemove).toEqual({ title: "Remove the reported content?", body: "The author is notified; all open reports on it are resolved.", confirm: "Remove", tone: "danger" });
    expect(ADMIN_REASON_PROMPTS.reportResolve).toEqual({ title: "Resolve without removing", body: "Add a note for the audit trail.", confirm: "Resolve", tone: "primary" });
    expect(ADMIN_REASON_PROMPTS.reportDismiss).toEqual({ title: "Dismiss this report", confirm: "Dismiss", tone: "primary" });
  });

  it("say a link's item has gone, or is further down, in each queue's own words", () => {
    expect(itemGoneText("moderation")).toBe("That item isn't waiting here any more. Another admin may have handled it.");
    expect(itemGoneText("reports")).toBe("That report has already been handled.");
    expect(itemFurtherText("moderation")).toBe("That item is further down the queue. Scroll on to find it.");
    expect(itemFurtherText("reports")).toBe("That report is further down the list. Scroll on to find it.");
  });
});

describe("a link's item in a queue", () => {
  const answered = { isSuccess: true, isFetchedAfterMount: true, isFetching: false, hasNextPage: false, pages: 1 };

  it("is looked for only in an answer fetched since the screen opened, with nothing still being fetched", () => {
    // Rows cached from a visit moments ago, as the notice is tapped: they may be from before it, so they decide nothing,
    // found or not, until the list fetched as the screen opened has answered.
    for (const found of [true, false]) {
      expect(linkedRowStep({ ...answered, isFetchedAfterMount: false }, found)).toBe("wait");
      expect(linkedRowStep({ ...answered, isFetchedAfterMount: false, isFetching: true }, found)).toBe("wait");
      // Fetched since, but fetching again (a refresh, or the next page): what's in hand may change.
      expect(linkedRowStep({ ...answered, isFetching: true }, found)).toBe("wait");
      // Still loading, or failed: the list says so, and the link waits for an answer (a retry).
      expect(linkedRowStep({ ...answered, isSuccess: false }, found)).toBe("wait");
    }
  });

  it("opens once a fresh answer holds it, on any page", () => {
    expect(linkedRowStep(answered, true)).toBe("found");
    expect(linkedRowStep({ ...answered, hasNextPage: true, pages: 3 }, true)).toBe("found");
  });

  it("loads the next page rather than say it's gone while there are more, up to a limit", () => {
    // Newest first: an older notice's item can be pages down.
    expect(linkedRowStep({ ...answered, hasNextPage: true }, false)).toBe("more");
    expect(linkedRowStep({ ...answered, hasNextPage: true, pages: LINKED_ROW_PAGE_LIMIT - 1 }, false)).toBe("more");
    expect(linkedRowStep({ ...answered, hasNextPage: true, pages: LINKED_ROW_PAGE_LIMIT }, false)).toBe("further");
    expect(LINKED_ROW_PAGE_LIMIT).toBe(10);
  });

  it("is gone only once every page has been looked through", () => {
    expect(linkedRowStep(answered, false)).toBe("gone");
    expect(linkedRowStep({ ...answered, pages: 4 }, false)).toBe("gone");
    expect(linkedRowStep({ ...answered, pages: LINKED_ROW_PAGE_LIMIT + 2 }, false)).toBe("gone");
  });
});

describe("a refused one-tap action", () => {
  const refused = (status: number, code: ErrorCode | "NETWORK_ERROR") => new ApiClientError(status, code, "Refused");

  it("is said above the list when its row leaves the tab: decided elsewhere, gone, or not the admin's", () => {
    expect(moderationRefusalPlace(refused(409, "INVALID_TRANSITION"))).toBe("queue");
    expect(moderationRefusalPlace(refused(404, "NOT_FOUND"))).toBe("queue");
    expect(moderationRefusalPlace(refused(403, "FORBIDDEN"))).toBe("queue");
  });

  it("is said in its row, which stays, for anything else", () => {
    // A group changed meanwhile: the row stays, showing what it says now.
    expect(moderationRefusalPlace(refused(409, "CONFLICT"))).toBe("row");
    expect(moderationRefusalPlace(refused(429, "RATE_LIMITED"))).toBe("row");
    expect(moderationRefusalPlace(refused(400, "VALIDATION_ERROR"))).toBe("row");
    expect(moderationRefusalPlace(refused(500, "INTERNAL"))).toBe("row");
    expect(moderationRefusalPlace(refused(0, "NETWORK_ERROR"))).toBe("row");
    expect(moderationRefusalPlace(new Error("Refused"))).toBe("row");
    expect(moderationRefusalPlace(undefined)).toBe("row");
  });
});

describe("queueTabCounts", () => {
  const dashboard = { pendingContent: 3, openReports: 120, openChatReports: 0 };

  it("counts only the tab that waits, in each queue", () => {
    const counts = queueTabCounts(dashboard)!;
    expect(statusTabs(MODERATION_STATUSES, MODERATION_STATUS_LABELS, counts.moderation)).toEqual([
      { value: "PENDING", label: "Awaiting approval", count: 3 },
      { value: "APPROVED", label: "Published" },
      { value: "REJECTED", label: "Rejected" },
      { value: "REMOVED", label: "Removed" },
    ]);
    expect(statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, counts.reports)).toEqual([
      { value: "OPEN", label: "Open", count: 120 },
      { value: "RESOLVED", label: "Resolved" },
      { value: "DISMISSED", label: "Dismissed" },
    ]);
    // A zero is still a count: the tab says nothing waits.
    expect(counts.chatReports).toEqual({ OPEN: 0 });
  });

  it("is nothing until the dashboard has loaded, so the tabs show no count rather than a wrong one", () => {
    expect(queueTabCounts(undefined)).toBeUndefined();
    expect(statusTabs(REPORT_STATUSES, REPORT_STATUS_LABELS, queueTabCounts(undefined)?.reports).every((t) => t.count === undefined)).toBe(true);
  });
});

describe("a report's row", () => {
  it("shows a title only when it isn't just the start of the excerpt", () => {
    expect(reportShowsTitle({ title: "Shah Fabrics has a new range", excerpt: "Shah Fabrics has a new range of cotton blends" })).toBe(false);
    expect(reportShowsTitle({ title: "Instant Visa Desk", excerpt: "Guaranteed visas in 24 hours" })).toBe(true);
    expect(reportShowsTitle({ title: "Instant Visa Desk", excerpt: null })).toBe(false);
    expect(reportShowsTitle({ title: null, excerpt: "Guaranteed visas in 24 hours" })).toBe(false);
  });

  it("says who reported it and when", () => {
    expect(reportedByText({ reporter: { fullName: "Jignesh Patel" } as MemberCardDto }, "2h ago")).toBe("Reported by Jignesh Patel · 2h ago");
  });
});
