import { notificationTarget } from "@illuminize/shared";

/** Screen for a notification (list tap or push tap). Mobile has no admin console, so admin notifications open nothing. */
export function notificationHref(slug: string, type: string, data: unknown): `/t/${string}` | null {
  const t = notificationTarget(type, data);
  const base = `/t/${slug}` as const;
  switch (t?.kind) {
    case "post":
      return `${base}/feed/${t.id}`;
    case "event":
      return `${base}/events/${t.id}`;
    case "job":
      return `${base}/jobs/${t.id}`;
    case "funding":
      return `${base}/funding/${t.id}`;
    case "myContent":
      return `${base}/profile/my-content`;
    case "profile":
      return `${base}/profile`;
    case "celebrations":
      return `${base}/feed`;
    default:
      return null;
  }
}
