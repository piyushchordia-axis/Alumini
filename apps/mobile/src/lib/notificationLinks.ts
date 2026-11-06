import { jobsQuery, notificationTarget, type NotificationTarget } from "@illuminize/shared";
import { adminMemberHref, adminSectionHref } from "./admin";

type AdminTarget = Extract<NotificationTarget, { kind: "admin" }>;

/**
 * The console's screen for an admin target: a request to join opens the member's page (the members waiting, from a
 * notice that didn't name them); content to review the moderation queue, on the item when the notice named it; a report
 * the open reports, on the report; and a chat report the open chat reports, on the report.
 */
function adminTargetHref(slug: string, t: AdminTarget): `/t/${string}` {
  switch (t.section) {
    case "members":
      return t.membershipId ? adminMemberHref(slug, t.membershipId) : `/t/${slug}/admin/members?status=PENDING`;
    case "moderation":
      return adminSectionHref(slug, "moderation", { status: "PENDING", ...(t.contentType && t.contentId ? { type: t.contentType, item: t.contentId } : {}) });
    case "reports":
      return adminSectionHref(slug, "reports", { status: "OPEN", ...(t.reportId ? { item: t.reportId } : {}) });
    case "chat-reports":
      // Scrolled to the report but never opened: opening its messages writes an audit row.
      return adminSectionHref(slug, "chatReports", { status: "OPEN", ...(t.chatReportId ? { item: t.chatReportId } : {}) });
  }
}

/**
 * The screen for a target: a notification's, or the console's "Open in app". Admin targets open the console, for admins
 * only.
 */
export function targetHref(slug: string, t: NotificationTarget, { isAdmin }: { isAdmin: boolean }): `/t/${string}` | null {
  const base = `/t/${slug}` as const;
  // No default: a target kind added without a route here is a compile error, not a silent dead link.
  switch (t.kind) {
    case "post":
      return `${base}/feed/${t.id}`;
    case "event":
      return `${base}/events/${t.id}`;
    case "job":
      return `${base}/jobs/${t.id}`;
    case "funding":
      return `${base}/funding/${t.id}`;
    case "business":
      return `${base}/businesses/${t.id}`;
    case "chat":
      return `${base}/messages/${t.conversationId}`;
    case "chatGroup":
      return `${base}/groups?tab=invitations`;
    case "myContent":
      return `${base}/profile/my-content${t.tab ? `?tab=${t.tab}` : ""}`;
    case "mentorship":
      return `${base}/mentors?tab=requests&box=${t.box}`;
    case "referral":
      return `${base}/jobs${jobsQuery("referrals", t.box)}`;
    case "profile":
      return `${base}/profile`;
    case "celebrations":
      return `${base}/feed`;
    case "admin":
      return isAdmin ? adminTargetHref(slug, t) : null;
  }
}

/** Screen for a notification (list tap or push tap). Admin notices open the console, for admins only. */
export function notificationHref(slug: string, type: string, data: unknown, options: { isAdmin: boolean }): `/t/${string}` | null {
  const t = notificationTarget(type, data);
  return t ? targetHref(slug, t, options) : null;
}
