import { notificationTarget } from "@illuminize/shared";

/** Screen for a notification (list tap or push tap). Mobile has no admin console, so admin notifications open nothing. */
export function notificationHref(slug: string, type: string, data: unknown): `/t/${string}` | null {
  const t = notificationTarget(type, data);
  if (!t) return null;
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
    case "profile":
      return `${base}/profile`;
    case "celebrations":
      return `${base}/feed`;
    case "admin":
      return null;
  }
}
