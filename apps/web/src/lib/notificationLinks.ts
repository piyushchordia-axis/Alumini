import { jobsQuery, mentorsQuery, type NotificationTarget } from "@illuminize/shared";

/**
 * The page for a target: a notification's, or the admin console's "Open in app". Admin targets open the console, for
 * admins only.
 */
export function targetHref(slug: string, t: NotificationTarget, { isAdmin }: { isAdmin: boolean }): string | null {
  const base = `/t/${slug}/app`;
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
      return `${base}/my-content${t.tab ? `?tab=${t.tab}` : ""}`;
    case "mentorship":
      return `${base}/mentors${mentorsQuery("requests", t.box)}`;
    case "referral":
      return `${base}/jobs${jobsQuery("referrals", t.box)}`;
    case "profile":
      return `${base}/profile`;
    case "celebrations":
      return `${base}/feed`;
    case "admin":
      if (!isAdmin) return null;
      if (t.section === "members") return t.membershipId ? `/t/${slug}/admin/members/${t.membershipId}` : `/t/${slug}/admin/members?status=PENDING`;
      return `/t/${slug}/admin/${t.section}`;
  }
}
