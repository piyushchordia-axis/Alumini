import { CONTENT_TYPES, type ContentType, type MentorshipBox, type NotificationType, type ReferralBox, type TenantFeatures } from "../constants";
import type { NotificationDto, NotificationSubjectDto } from "../types/dto";
import { chatAvailable, connectionsAvailable } from "./features";

/**
 * What kind of notification a type is, for member preferences. ACCOUNT (membership and moderation outcomes, system
 * notices) is always delivered; the rest each have a level the member chooses.
 */
export const NOTIFICATION_CATEGORIES = ["ACCOUNT", "ACTIVITY", "CHAT", "CONNECTIONS", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type ConfigurableCategory = Exclude<NotificationCategory, "ACCOUNT">;
export const CONFIGURABLE_CATEGORIES: readonly ConfigurableCategory[] = ["ACTIVITY", "CHAT", "CONNECTIONS", "EVENTS", "ANNOUNCEMENTS", "CELEBRATIONS", "ADMIN"];

export const NOTIFICATION_CATEGORY: Record<NotificationType, NotificationCategory> = {
  MEMBERSHIP_APPROVED: "ACCOUNT",
  MEMBERSHIP_REJECTED: "ACCOUNT",
  MEMBERSHIP_SUSPENDED: "ACCOUNT",
  MEMBERSHIP_REINSTATED: "ACCOUNT",
  CONTENT_APPROVED: "ACCOUNT",
  CONTENT_REJECTED: "ACCOUNT",
  CONTENT_REMOVED: "ACCOUNT",
  SYSTEM: "ACCOUNT",
  CHAT_MESSAGE_REMOVED: "ACCOUNT",
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
  CHAT_REPORT_FILED: "ADMIN",
  MENTORSHIP_REQUESTED: "CONNECTIONS",
  MENTORSHIP_ACCEPTED: "CONNECTIONS",
  MENTORSHIP_DECLINED: "CONNECTIONS",
  MENTORSHIP_ENDED: "CONNECTIONS",
  REFERRAL_REQUESTED: "CONNECTIONS",
  REFERRAL_ACCEPTED: "CONNECTIONS",
  REFERRAL_DECLINED: "CONNECTIONS",
};

/** OFF: not stored or shown. IN_APP: in the notification list and bell. IN_APP_PUSH: also a push to devices. */
export const NOTIFICATION_LEVELS = ["OFF", "IN_APP", "IN_APP_PUSH"] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const NOTIFICATION_CATEGORY_INFO: Record<ConfigurableCategory, { label: string; description: string; minLevel: NotificationLevel; adminOnly?: boolean }> = {
  ACTIVITY: { label: "Comments and reactions", description: "When members comment on or react to your posts.", minLevel: "OFF" },
  // The bell never shows chat, so the lowest level here is the Messages badge alone.
  CHAT: { label: "Messages", description: "New messages, message requests and group invitations. Unless you mute a conversation, its messages show on the Messages badge.", minLevel: "IN_APP" },
  CONNECTIONS: { label: "Mentorship and referrals", description: "Requests to be someone's mentor or to refer them for a job, and answers to the requests you send.", minLevel: "OFF" },
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

/** The categories this member has a choice about here: chat and connections only where they can use them, and admin work only for admins. */
export function visibleNotificationCategories(input: { features: TenantFeatures; chatEligible: boolean; isTenantAdmin: boolean }): ConfigurableCategory[] {
  const { features, chatEligible, isTenantAdmin } = input;
  return CONFIGURABLE_CATEGORIES.filter((c) => {
    if (NOTIFICATION_CATEGORY_INFO[c].adminOnly && !isTenantAdmin) return false;
    if (c === "CHAT") return chatAvailable(features, chatEligible);
    if (c === "CONNECTIONS") return connectionsAvailable(features, chatEligible);
    return true;
  });
}

/**
 * Chat that reaches a device and nowhere else. Outside NOTIFICATION_TYPES, so none of these can ever become a row in the
 * bell: `notify` won't take them, and the badge on Messages is what counts them.
 */
export const CHAT_PUSH_KINDS = ["CHAT_MESSAGE", "CHAT_REQUEST", "CHAT_ACCEPTED", "CHAT_OPENED", "CHAT_GROUP_INVITE"] as const;
export type ChatPushKind = (typeof CHAT_PUSH_KINDS)[number];

/** Where tapping a notification should take the member; each app maps this to its own routes. */
export type NotificationTarget =
  | { kind: "celebrations" }
  | { kind: "post"; id: string }
  | { kind: "event"; id: string }
  | { kind: "job"; id: string }
  | { kind: "funding"; id: string }
  | { kind: "business"; id: string }
  | { kind: "chat"; conversationId: string }
  /** The Groups section. Only ever its Invitations tab, because an invitation is all a push about a group can be. */
  | { kind: "chatGroup"; view: "invitations" }
  /** My posts, on one of its tabs when it matters which. */
  | { kind: "myContent"; tab?: "groups" }
  /** The Mentors section's Requests tab, on the list the request is in: received as the mentor, sent as the mentee. */
  | { kind: "mentorship"; box: MentorshipBox }
  /** The Jobs section's Referrals tab, on the list the request is in: received as the job's poster, sent as the one asking. */
  | { kind: "referral"; box: ReferralBox }
  | { kind: "profile" }
  /** A console section, with the ids of what the notice is about when it carried them. */
  | {
      kind: "admin";
      section: "members" | "moderation" | "reports" | "chat-reports";
      membershipId?: string;
      contentType?: ContentType;
      contentId?: string;
      reportId?: string;
      chatReportId?: string;
    };

interface NotificationData {
  postId?: string;
  eventId?: string;
  contentType?: string;
  contentId?: string;
  conversationId?: string;
  /** Which of the recipient's lists a mentorship or referral request is in. */
  box?: string;
  membershipId?: string;
  reportId?: string;
  chatReportId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only an id that is a UUID: it goes into a route, and a push or a link can carry anything. */
export function uuidOf(value: unknown): string | undefined {
  return typeof value === "string" && UUID.test(value) ? value : undefined;
}

type AdminTarget = Extract<NotificationTarget, { kind: "admin" }>;
type AdminIds = Omit<AdminTarget, "kind" | "section">;

/** With the ids that checked out: one that didn't is left out rather than undefined. */
function adminTarget(section: AdminTarget["section"], ids: AdminIds): AdminTarget {
  return { kind: "admin", section, ...(Object.fromEntries(Object.entries(ids).filter(([, id]) => id !== undefined)) as AdminIds) };
}

/** The item a notice is about, when it named both its type and a UUID. */
function adminContentIds(d: NotificationData): Pick<AdminIds, "contentType" | "contentId"> {
  const contentId = uuidOf(d.contentId);
  const contentType = CONTENT_TYPES.find((t) => t === d.contentType);
  return contentId && contentType ? { contentType, contentId } : {};
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
    case "BUSINESS":
      return { kind: "business", id: d.contentId };
    case "COMMENT":
      return d.postId ? { kind: "post", id: d.postId } : null;
    // A notice about a group's review is its owner's, and My posts is where they see it, with the admin's note.
    case "GROUP":
      return { kind: "myContent", tab: "groups" };
    default:
      return null;
  }
}

type TargetFor = (d: NotificationData) => NotificationTarget | null;

const postTarget: TargetFor = (d) => (d.postId ? { kind: "post", id: d.postId } : null);
const eventTarget: TargetFor = (d) => (d.eventId ? { kind: "event", id: d.eventId } : null);
const profileTarget: TargetFor = () => ({ kind: "profile" });
const celebrationsTarget: TargetFor = () => ({ kind: "celebrations" });
const chatTarget: TargetFor = (d) => (d.conversationId ? { kind: "chat", conversationId: d.conversationId } : null);
/** A mentorship's own list, or `fallback` for a payload that doesn't say, since each type has an obvious side. */
const mentorshipTarget =
  (fallback: MentorshipBox): TargetFor =>
  (d) => ({ kind: "mentorship", box: d.box === "received" || d.box === "sent" ? d.box : fallback });
/** A referral request's own list, the same way. */
const referralTarget =
  (fallback: ReferralBox): TargetFor =>
  (d) => ({ kind: "referral", box: d.box === "received" || d.box === "sent" ? d.box : fallback });

const TARGETS: Record<NotificationType | ChatPushKind, TargetFor> = {
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
  CONTENT_REMOVED: (d) => (d.contentType === "COMMENT" && d.postId ? { kind: "post", id: d.postId } : d.contentType === "GROUP" ? { kind: "myContent", tab: "groups" } : { kind: "myContent" }),
  MEMBERSHIP_APPROVED: profileTarget,
  MEMBERSHIP_REJECTED: profileTarget,
  MEMBERSHIP_SUSPENDED: profileTarget,
  MEMBERSHIP_REINSTATED: profileTarget,
  NEW_MEMBER_PENDING: (d) => adminTarget("members", { membershipId: uuidOf(d.membershipId) }),
  CONTENT_PENDING: (d) => adminTarget("moderation", adminContentIds(d)),
  REPORT_FILED: (d) => adminTarget("reports", { reportId: uuidOf(d.reportId), ...adminContentIds(d) }),
  CHAT_REPORT_FILED: (d) => adminTarget("chat-reports", { chatReportId: uuidOf(d.chatReportId) }),
  CHAT_MESSAGE_REMOVED: chatTarget,
  CHAT_MESSAGE: chatTarget,
  CHAT_REQUEST: chatTarget,
  CHAT_ACCEPTED: chatTarget,
  CHAT_OPENED: chatTarget,
  // Not into the group: the invitee isn't in it yet, and an invite-only one answers them 404 until they accept.
  CHAT_GROUP_INVITE: () => ({ kind: "chatGroup", view: "invitations" }),
  MENTORSHIP_REQUESTED: mentorshipTarget("received"),
  // Into the chat it opened, where the note is already the first message.
  MENTORSHIP_ACCEPTED: (d) => chatTarget(d) ?? mentorshipTarget("sent")(d),
  MENTORSHIP_DECLINED: mentorshipTarget("sent"),
  MENTORSHIP_ENDED: mentorshipTarget("sent"),
  REFERRAL_REQUESTED: referralTarget("received"),
  // Into the chat it opened, where the note is already the first message.
  REFERRAL_ACCEPTED: (d) => chatTarget(d) ?? referralTarget("sent")(d),
  // Declined by the poster, or closed with its job.
  REFERRAL_DECLINED: referralTarget("sent"),
  CELEBRATION: celebrationsTarget,
  CELEBRATION_WISH: celebrationsTarget,
  SYSTEM: contentTarget,
};

/**
 * Resolves a notification (type + data payload, as stored or as sent in a push) to a destination, or null. `type` can be
 * any string a push carried, and hasOwn keeps one like "constructor" from reaching a property of Object.prototype.
 */
export function notificationTarget(type: NotificationType | ChatPushKind | string, data: unknown): NotificationTarget | null {
  const d = (data && typeof data === "object" ? data : {}) as NotificationData;
  return Object.hasOwn(TARGETS, type) ? TARGETS[type as NotificationType | ChatPushKind](d) : null;
}

/**
 * The request a new-member notice is about, with its status now, so an admin's row can offer Approve and Reject while it
 * still waits. Null for any other notice, and for anyone the API didn't send it to (only admins get it).
 */
export function memberRequestOf(n: Pick<NotificationDto, "type" | "subject">): NotificationSubjectDto | null {
  return n.type === "NEW_MEMBER_PENDING" && n.subject?.kind === "membership" ? n.subject : null;
}
