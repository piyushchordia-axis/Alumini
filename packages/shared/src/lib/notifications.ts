import type { NotificationType } from "../constants";

/**
 * What kind of notification a type is, for member preferences. ACCOUNT (membership and moderation outcomes, system
 * notices) is always delivered; the rest each have a level the member chooses.
 */
export const NOTIFICATION_CATEGORIES = ["ACCOUNT", "ACTIVITY", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type ConfigurableCategory = Exclude<NotificationCategory, "ACCOUNT">;
export const CONFIGURABLE_CATEGORIES: readonly ConfigurableCategory[] = ["ACTIVITY", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"];

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  MEMBERSHIP_APPROVED: "ACCOUNT",
  MEMBERSHIP_REJECTED: "ACCOUNT",
  MEMBERSHIP_SUSPENDED: "ACCOUNT",
  MEMBERSHIP_REINSTATED: "ACCOUNT",
  CONTENT_APPROVED: "ACCOUNT",
  CONTENT_REJECTED: "ACCOUNT",
  CONTENT_REMOVED: "ACCOUNT",
  SYSTEM: "ACCOUNT",
  POST_COMMENT: "ACTIVITY",
  POST_REACTION: "ACTIVITY",
  EVENT_RSVP: "EVENTS",
  EVENT_CANCELLED: "EVENTS",
  EVENT_UPDATED: "EVENTS",
  ANNOUNCEMENT: "ANNOUNCEMENTS",
  CELEBRATION: "CELEBRATIONS",
  CELEBRATION_WISH: "CELEBRATIONS",
  NEW_MEMBER_PENDING: "ADMIN",
  CONTENT_PENDING: "ADMIN",
  REPORT_FILED: "ADMIN",
};

/** OFF: not stored or shown. IN_APP: in the notification list and bell. IN_APP_PUSH: also a push to devices. */
export const NOTIFICATION_LEVELS = ["OFF", "IN_APP", "IN_APP_PUSH"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_CATEGORY_INFO: Record<ConfigurableCategory, { label: string; description: string; minLevel: NotificationLevel; adminOnly?: boolean }> = {
  ACTIVITY: { label: "Comments and reactions", description: "When members comment on or react to your posts.", minLevel: "OFF" },
  EVENTS: { label: "Events", description: "RSVPs to your events, and changes to events you're going to.", minLevel: "OFF" },
  ANNOUNCEMENTS: { label: "Announcements", description: "Notices from your institution's admins. Always shown in the app.", minLevel: "IN_APP" },
  CELEBRATIONS: { label: "Birthdays and anniversaries", description: "Greetings on your day and wishes from other members.", minLevel: "OFF" },
  ADMIN: { label: "Admin work", description: "New members to approve, content to review, reports.", minLevel: "OFF", adminOnly: true },
};

/** A member's choices as stored; anything missing takes the default. */
export interface NotificationPrefs {
  categories?: Partial<Record<ConfigurableCategory, NotificationLevel>>;
  /** The weekly digest by email (needs a confirmed email). */
  digestEmail?: boolean;
  /** Announcements by email, WhatsApp or SMS, when the institution sends them that way. */
  announcementMessages?: boolean;
  /** When the member dismissed the notice about birthdays being shown on the feed. */
  celebrationsNoticeSeenAt?: string | null;
}

export interface ResolvedNotificationPrefs {
  categories: Record<ConfigurableCategory, NotificationLevel>;
  digestEmail: boolean;
  announcementMessages: boolean;
  celebrationsNoticeSeenAt: string | null;
}

const LEVEL_RANK: Record<NotificationLevel, number> = { OFF: 0, IN_APP: 1, IN_APP_PUSH: 2 };

/** Fills defaults (everything on) and raises any level below its category's minimum. */
export function resolveNotificationPrefs(p: NotificationPrefs | null | undefined): ResolvedNotificationPrefs {
  const categories = {} as Record<ConfigurableCategory, NotificationLevel>;
  for (const c of CONFIGURABLE_CATEGORIES) {
    const chosen = p?.categories?.[c] ?? "IN_APP_PUSH";
    const min = NOTIFICATION_CATEGORY_INFO[c].minLevel;
    categories[c] = LEVEL_RANK[chosen] < LEVEL_RANK[min] ? min : chosen;
  }
  return {
    categories,
    digestEmail: p?.digestEmail ?? true,
    announcementMessages: p?.announcementMessages ?? true,
    celebrationsNoticeSeenAt: p?.celebrationsNoticeSeenAt ?? null,
  };
}

/** How a notification of `type` reaches a member with these preferences. */
export function notificationLevelFor(type: NotificationType, prefs: NotificationPrefs | null | undefined): NotificationLevel {
  const category = NOTIFICATION_CATEGORY[type];
  if (category === "ACCOUNT") return "IN_APP_PUSH";
  return resolveNotificationPrefs(prefs).categories[category];
}

/** Where tapping a notification should take the member; each app maps this to its own routes. */
export type NotificationTarget =
  | { kind: "celebrations" }
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
    case "ANNOUNCEMENT":
      return d.postId ? { kind: "post", id: d.postId } : null;
    case "CELEBRATION":
    case "CELEBRATION_WISH":
      return { kind: "celebrations" };
    default:
      return contentTarget(d);
  }
}
