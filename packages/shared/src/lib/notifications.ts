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

type TargetFor = (d: NotificationData) => NotificationTarget | null;

const postTarget: TargetFor = (d) => (d.postId ? { kind: "post", id: d.postId } : null);
const eventTarget: TargetFor = (d) => (d.eventId ? { kind: "event", id: d.eventId } : null);
const profileTarget: TargetFor = () => ({ kind: "profile" });
const celebrationsTarget: TargetFor = () => ({ kind: "celebrations" });

const TARGETS: Record<NotificationType, TargetFor> = {
  POST_COMMENT: postTarget,
  POST_REACTION: postTarget,
  ANNOUNCEMENT: postTarget,
  EVENT_RSVP: eventTarget,
  EVENT_UPDATED: eventTarget,
  EVENT_CANCELLED: eventTarget,
  CONTENT_APPROVED: (d) => contentTarget(d) ?? { kind: "myContent" },
  // The author can still open a rejected item, and its page shows the admin's note.
  CONTENT_REJECTED: (d) => contentTarget(d) ?? { kind: "myContent" },
  // A removed item's page 404s even for its author, so go to My posts, which lists it. A removed comment's post is still there.
  CONTENT_REMOVED: (d) => (d.contentType === "COMMENT" && d.postId ? { kind: "post", id: d.postId } : { kind: "myContent" }),
  MEMBERSHIP_APPROVED: profileTarget,
  MEMBERSHIP_REJECTED: profileTarget,
  MEMBERSHIP_SUSPENDED: profileTarget,
  MEMBERSHIP_REINSTATED: profileTarget,
  NEW_MEMBER_PENDING: () => ({ kind: "admin", section: "members" }),
  CONTENT_PENDING: () => ({ kind: "admin", section: "moderation" }),
  REPORT_FILED: () => ({ kind: "admin", section: "reports" }),
  CELEBRATION: celebrationsTarget,
  CELEBRATION_WISH: celebrationsTarget,
  SYSTEM: contentTarget,
};

/**
 * Resolves a notification (type + data payload, as stored or as sent in a push) to a destination, or null. `type` can be
 * any string a push carried, and hasOwn keeps one like "constructor" from reaching a property of Object.prototype.
 */
export function notificationTarget(type: NotificationType | string, data: unknown): NotificationTarget | null {
  const d = (data && typeof data === "object" ? data : {}) as NotificationData;
  return Object.hasOwn(TARGETS, type) ? TARGETS[type as NotificationType](d) : null;
}
