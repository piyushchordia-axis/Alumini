import type { NotificationType } from "../constants";

/** Where tapping a notification should take the member; each app maps this to its own routes. */
export type NotificationTarget =
  | { kind: "post"; id: string }
  | { kind: "event"; id: string }
  | { kind: "job"; id: string }
  | { kind: "funding"; id: string }
  | { kind: "myContent" }
  | { kind: "profile" }
  | { kind: "admin"; section: "members" | "moderation" | "reports" };

interface NotificationData {
  postId?: string;
  eventId?: string;
  contentType?: string;
  contentId?: string;
}

function contentTarget(d: NotificationData): NotificationTarget | null {
  if (!d.contentId) return d.postId ? { kind: "post", id: d.postId } : null;
  switch (d.contentType) {
    case "POST":
      return { kind: "post", id: d.contentId };
    case "JOB":
      return { kind: "job", id: d.contentId };
    case "FUNDING":
      return { kind: "funding", id: d.contentId };
    case "EVENT":
      return { kind: "event", id: d.contentId };
    case "COMMENT":
      return d.postId ? { kind: "post", id: d.postId } : null;
    default:
      return null;
  }
}

/** Resolves a notification (type + data payload, as stored or as sent in a push) to a destination, or null. */
export function notificationTarget(type: NotificationType | string, data: unknown): NotificationTarget | null {
  const d = (data && typeof data === "object" ? data : {}) as NotificationData;
  switch (type) {
    case "POST_COMMENT":
    case "POST_REACTION":
      return d.postId ? { kind: "post", id: d.postId } : null;
    case "EVENT_RSVP":
    case "EVENT_UPDATED":
    case "EVENT_CANCELLED":
      return d.eventId ? { kind: "event", id: d.eventId } : null;
    case "CONTENT_APPROVED":
      return contentTarget(d) ?? { kind: "myContent" };
    case "CONTENT_REJECTED":
    case "CONTENT_REMOVED":
      // Rejected/removed items are listed (with the admin's note) under My posts.
      return contentTarget(d) ?? { kind: "myContent" };
    case "MEMBERSHIP_APPROVED":
    case "MEMBERSHIP_REJECTED":
    case "MEMBERSHIP_SUSPENDED":
    case "MEMBERSHIP_REINSTATED":
      return { kind: "profile" };
    case "NEW_MEMBER_PENDING":
      return { kind: "admin", section: "members" };
    case "CONTENT_PENDING":
      return { kind: "admin", section: "moderation" };
    case "REPORT_FILED":
      return { kind: "admin", section: "reports" };
    default:
      return contentTarget(d);
  }
}
