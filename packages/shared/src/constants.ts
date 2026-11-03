import { COUNTRIES, type Country } from "./data/countries";

export const TENANT_TYPES = ["UNIVERSITY", "COLLEGE", "SCHOOL", "OTHER"] as const;
export type TenantType = (typeof TENANT_TYPES)[number];

export const TENANT_STATUSES = ["ACTIVE", "SUSPENDED", "ARCHIVED"] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const APPROVAL_MODES = ["AUTO_APPROVE", "ADMIN_APPROVAL"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const MEMBERSHIP_ROLES = ["MEMBER", "TENANT_ADMIN"] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

export const PROFESSION_TYPES = ["EMPLOYED", "FOUNDER", "BUSINESS_OWNER", "STUDENT", "OTHER"] as const;
export type ProfessionType = (typeof PROFESSION_TYPES)[number];

export const MARITAL_STATUSES = ["SINGLE", "MARRIED", "PREFER_NOT_TO_SAY"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const MODERATION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "REMOVED"] as const;
export type ModerationStatus = (typeof MODERATION_STATUSES)[number];

export const JOB_TYPES = ["FULL_TIME", "PART_TIME", "CONTRACT", "INTERNSHIP", "FREELANCE"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const FUNDING_KINDS = ["SEEKING", "OFFERING"] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

export const FUNDING_STAGES = ["IDEA", "PRE_SEED", "SEED", "SERIES_A", "SERIES_B_PLUS", "GROWTH", "OTHER"] as const;
export type FundingStage = (typeof FUNDING_STAGES)[number];

/** A fixed list, because free text would make the filter useless. */
export const BUSINESS_CATEGORIES = [
  "RETAIL",
  "FOOD_BEVERAGE",
  "HEALTHCARE",
  "EDUCATION",
  "TECHNOLOGY",
  "FINANCE_LEGAL",
  "CONSULTING",
  "MANUFACTURING",
  "REAL_ESTATE",
  "MEDIA_DESIGN",
  "TRAVEL_HOSPITALITY",
  "AGRICULTURE",
  "LOGISTICS",
  "OTHER",
] as const;
export type BusinessCategory = (typeof BUSINESS_CATEGORIES)[number];
/** Listings one member may have, counting everything an admin hasn't removed. */
export const MAX_BUSINESS_LISTINGS = 5;

/** One thread per pair of members (DIRECT), or a shared room (GROUP). */
export const CHAT_CONVERSATION_KINDS = ["DIRECT", "GROUP"] as const;
export type ChatConversationKind = (typeof CHAT_CONVERSATION_KINDS)[number];
/** What opened the thread. A thread opened by accepting a mentorship or referral skips the message request. */
export const CHAT_ORIGINS = ["MESSAGE_REQUEST", "MENTORSHIP", "REFERRAL", "GROUP"] as const;
export type ChatOrigin = (typeof CHAT_ORIGINS)[number];
export const CHAT_DIRECT_STATES = ["PENDING", "ACCEPTED", "DECLINED", "CLOSED"] as const;
export type ChatDirectState = (typeof CHAT_DIRECT_STATES)[number];
export const CHAT_PARTICIPANT_STATES = ["INVITED", "ACTIVE", "LEFT", "REMOVED"] as const;
export type ChatParticipantState = (typeof CHAT_PARTICIPANT_STATES)[number];
export const CHAT_PARTICIPANT_ROLES = ["OWNER", "MEMBER"] as const;
export type ChatParticipantRole = (typeof CHAT_PARTICIPANT_ROLES)[number];
export const CHAT_MESSAGE_KINDS = ["TEXT", "SYSTEM"] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];
export const CHAT_INBOXES = ["MAIN", "REQUESTS"] as const;
export type ChatInbox = (typeof CHAT_INBOXES)[number];
export const CHAT_REPORT_TARGET_KINDS = ["MESSAGE", "MENTORSHIP_NOTE", "REFERRAL_NOTE"] as const;
export type ChatReportTargetKind = (typeof CHAT_REPORT_TARGET_KINDS)[number];
export const CHAT_REPORT_ACTIONS = ["NONE", "REMOVE_MESSAGE"] as const;
export type ChatReportAction = (typeof CHAT_REPORT_ACTIONS)[number];
export const CHAT_MESSAGE_MAX_LENGTH = 4000;
/** How long a requester waits before asking again, counted from their last request or from the thread closing. */
export const CHAT_REREQUEST_AFTER_DAYS = 30;
/** Requests one member may send another, the first included. */
export const CHAT_MAX_REQUESTS_PER_PAIR = 3;
/** Messages an admin can be shown either side of a reported one, frozen when the report is filed. */
export const CHAT_REPORT_CONTEXT_EACH_SIDE = 5;
/** How clients show a message or thread whose other member deleted their account. */
export const DELETED_MEMBER_NAME = "Deleted member";
/** How a group shows someone this member has blocked, in place of their name and words. */
export const BLOCKED_MEMBER_NAME = "Blocked member";

/** OPEN: any member can find and join it, with the whole history. INVITE_ONLY: only invitees see it, from when they join. Fixed at creation. */
export const CHAT_GROUP_VISIBILITIES = ["OPEN", "INVITE_ONLY"] as const;
export type ChatGroupVisibility = (typeof CHAT_GROUP_VISIBILITIES)[number];
/** What creating a group says about each choice, on both apps. */
export const CHAT_GROUP_VISIBILITY_INFO: Record<ChatGroupVisibility, { label: string; description: string }> = {
  OPEN: { label: "Open group", description: "Any member can find and join this group, and new members see the whole conversation." },
  INVITE_ONLY: { label: "Invite-only group", description: "Only people you invite can see this group. New members see messages from when they join." },
};
/** DISCOVER: open groups to find. MINE: groups the member is in. OWNED: groups they own, with how moderation left them. */
export const CHAT_GROUP_SCOPES = ["DISCOVER", "MINE", "OWNED"] as const;
export type ChatGroupScope = (typeof CHAT_GROUP_SCOPES)[number];
/** What a group's system line is about. Its member is the message's sender. */
export const CHAT_GROUP_EVENTS = ["JOINED", "LEFT", "REMOVED", "OWNER_CHANGED", "ARCHIVED"] as const;
export type ChatGroupEvent = (typeof CHAT_GROUP_EVENTS)[number];
export const CHAT_GROUP_NAME_MIN_LENGTH = 3;
export const CHAT_GROUP_NAME_MAX_LENGTH = 80;
export const CHAT_GROUP_DESCRIPTION_MAX_LENGTH = 500;
export const CHAT_GROUP_MAX_MEMBERS = 500;
/** Invitations a group may have waiting at once. */
export const CHAT_GROUP_MAX_PENDING_INVITES = 100;
/** Groups one member may own, not counting archived or removed ones. */
export const CHAT_GROUP_MAX_OWNED = 20;
export const CHAT_GROUP_INVITES_PER_CALL = 25;
/** An invitation lapses after this long, accepted or not. */
export const CHAT_GROUP_INVITE_TTL_DAYS = 30;
/** How long declining someone's invitation or message request keeps their invitations away. */
export const CHAT_INVITE_DECLINE_DAYS = 30;

export const EVENT_KINDS = ["CASUAL_MEETUP", "ORGANISED_EVENT"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const RSVP_STATUSES = ["YES", "NO", "MAYBE"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const REACTION_TYPES = ["LIKE", "LOVE", "CELEBRATE", "INSIGHTFUL"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

/** GROUP is a group's name and description, never its messages: chat stays out of moderation. */
export const CONTENT_TYPES = ["POST", "COMMENT", "JOB", "FUNDING", "EVENT", "BUSINESS", "GROUP"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const REPORT_REASONS = ["SPAM", "HARASSMENT", "INAPPROPRIATE", "MISINFORMATION", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  "MEMBERSHIP_APPROVED",
  "MEMBERSHIP_REJECTED",
  "MEMBERSHIP_SUSPENDED",
  "MEMBERSHIP_REINSTATED",
  "CONTENT_APPROVED",
  "CONTENT_REJECTED",
  "CONTENT_REMOVED",
  "POST_COMMENT",
  "POST_REACTION",
  "EVENT_RSVP",
  "EVENT_CANCELLED",
  "EVENT_UPDATED",
  "NEW_MEMBER_PENDING",
  "CONTENT_PENDING",
  "REPORT_FILED",
  "SYSTEM",
  "ANNOUNCEMENT",
  "CELEBRATION",
  "CELEBRATION_WISH",
  "CHAT_REPORT_FILED",
  "CHAT_MESSAGE_REMOVED",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const BILLING_MODELS = ["PER_ACTIVE_USER", "FLAT_FEE", "FREE"] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];

export const BILLING_CYCLES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const PUSH_PLATFORMS = ["IOS", "ANDROID", "WEB"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/** Outbound message channels, in no particular order (each message type sets its own preference). */
export const MESSAGE_CHANNELS = ["WHATSAPP", "SMS", "EMAIL"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/**
 * DELIVERED and READ are reported by provider webhooks (WhatsApp/MSG91 status callbacks). CANCELLED: dropped before
 * sending because it no longer applied (the member unsubscribed, the email changed, the content was removed).
 */
export const OUTBOUND_MESSAGE_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED", "CANCELLED"] as const;
export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUSES)[number];

/** What a payment is for; each purpose has a handler that prices it and acts when it is paid (Wave 3). */
export const PAYMENT_PURPOSES = ["EVENT_TICKET", "DONATION"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** ATTEMPTED: authorised but not yet captured. PAID is final unless refunded. */
export const PAYMENT_ORDER_STATUSES = ["CREATED", "ATTEMPTED", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED", "EXPIRED"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_REFUND_STATUSES = ["PENDING", "PROCESSED", "FAILED"] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

/** Admin-defined profile questions (beyond the built-in profile). */
export const PROFILE_FIELD_TYPES = ["TEXT", "LONG_TEXT", "NUMBER", "DATE", "SELECT", "MULTI_SELECT", "BOOLEAN"] as const;
export type ProfileFieldType = (typeof PROFILE_FIELD_TYPES)[number];
/** MEMBERS: shown on the profile to other members. ADMINS: only the member themself and admins see it. */
export const PROFILE_FIELD_VISIBILITIES = ["MEMBERS", "ADMINS"] as const;
export type ProfileFieldVisibility = (typeof PROFILE_FIELD_VISIBILITIES)[number];
export const MAX_PROFILE_FIELDS = 30;
export const MAX_PROFILE_FIELD_OPTIONS = 50;
export const PROFILE_FIELD_TYPE_LABELS: Record<ProfileFieldType, string> = {
  TEXT: "Short text",
  LONG_TEXT: "Paragraph",
  NUMBER: "Number",
  DATE: "Date",
  SELECT: "Choose one",
  MULTI_SELECT: "Choose several",
  BOOLEAN: "Yes / no",
};

/** PENDING: imported, not sent yet. SENT: sent at least once. Expiry is computed from expires_at. */
export const INVITATION_STATUSES = ["PENDING", "SENT", "ACCEPTED", "REVOKED"] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
/** Rows per import request (the browser sends a large CSV in chunks). */
export const MAX_INVITE_IMPORT_ROWS = 500;
export const INVITE_TTL_DAYS = 90;

export const TENANT_FEATURES = ["feed", "jobs", "funding", "events", "directory", "businesses", "messaging", "groups"] as const;
export type TenantFeature = (typeof TENANT_FEATURES)[number];
export type TenantFeatures = Record<TenantFeature, boolean>;

export const CELEBRATION_KINDS = ["BIRTHDAY", "ANNIVERSARY"] as const;
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

/** ANNOUNCEMENT: an admin's notice, pinned by default and sent to every member. */
export const POST_KINDS = ["POST", "ANNOUNCEMENT"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const MAX_POST_IMAGES = 4;
export const MAX_POLL_OPTIONS = 6;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MIN_BATCH_YEAR = 1950;
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;
/** Email confirmation links expire after this long. */
export const EMAIL_VERIFICATION_TTL_SECONDS = 24 * 3600;
export const DEFAULT_TENANT_TIMEZONE = "Asia/Kolkata";

export const PROFESSION_TYPE_LABELS: Record<ProfessionType, string> = {
  EMPLOYED: "Working at a company",
  FOUNDER: "Founder / co-founder",
  BUSINESS_OWNER: "Business owner",
  STUDENT: "Student",
  OTHER: "Other",
};

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  SINGLE: "Single",
  MARRIED: "Married",
  PREFER_NOT_TO_SAY: "Prefer not to say",
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  INTERNSHIP: "Internship",
  FREELANCE: "Freelance",
};

export const FUNDING_STAGE_LABELS: Record<FundingStage, string> = {
  IDEA: "Idea",
  PRE_SEED: "Pre-seed",
  SEED: "Seed",
  SERIES_A: "Series A",
  SERIES_B_PLUS: "Series B+",
  GROWTH: "Growth",
  OTHER: "Other",
};

export const BUSINESS_CATEGORY_LABELS: Record<BusinessCategory, string> = {
  RETAIL: "Retail",
  FOOD_BEVERAGE: "Food & beverage",
  HEALTHCARE: "Healthcare",
  EDUCATION: "Education",
  TECHNOLOGY: "Technology",
  FINANCE_LEGAL: "Finance & legal",
  CONSULTING: "Consulting",
  MANUFACTURING: "Manufacturing",
  REAL_ESTATE: "Real estate",
  MEDIA_DESIGN: "Media & design",
  TRAVEL_HOSPITALITY: "Travel & hospitality",
  AGRICULTURE: "Agriculture",
  LOGISTICS: "Logistics",
  OTHER: "Other",
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  CASUAL_MEETUP: "Casual meetup",
  ORGANISED_EVENT: "Organised event",
};

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: "Spam",
  HARASSMENT: "Harassment",
  INAPPROPRIATE: "Inappropriate content",
  MISINFORMATION: "Misinformation",
  OTHER: "Other",
};

export const CHAT_REPORT_TARGET_KIND_LABELS: Record<ChatReportTargetKind, string> = {
  MESSAGE: "Message",
  MENTORSHIP_NOTE: "Mentorship request",
  REFERRAL_NOTE: "Referral request",
};

export const MEMBERSHIP_STATUS_LABELS: Record<MembershipStatus, string> = {
  PENDING: "Pending approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUSPENDED: "Suspended",
};

export const MODERATION_STATUS_LABELS: Record<ModerationStatus, string> = {
  PENDING: "Awaiting approval",
  APPROVED: "Published",
  REJECTED: "Rejected",
  REMOVED: "Removed",
};

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  POST: "Post",
  COMMENT: "Comment",
  JOB: "Job",
  FUNDING: "Funding listing",
  EVENT: "Event",
  BUSINESS: "Business listing",
  GROUP: "Group",
};

export const TENANT_TYPE_LABELS: Record<TenantType, string> = {
  UNIVERSITY: "University",
  COLLEGE: "College",
  SCHOOL: "School",
  OTHER: "Other",
};

export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  PER_ACTIVE_USER: "Per active user",
  FLAT_FEE: "Flat fee",
  FREE: "Free",
};

export { COUNTRIES, type Country } from "./data/countries";

/** Shown above the full list in country pickers: India first, then the biggest alumni destinations. */
export const POPULAR_COUNTRY_CODES = ["IN", "US", "GB", "AE", "CA", "AU", "SG", "DE", "SA", "QA"] as const;

export const COUNTRY_NAME_BY_CODE: Record<string, string> = Object.fromEntries(COUNTRIES.map((c) => [c.code, c.name]));
const COUNTRY_BY_CODE = new Map<string, Country>(COUNTRIES.map((c) => [c.code, c]));

export function countryByCode(code: string | null | undefined): Country | undefined {
  return code ? COUNTRY_BY_CODE.get(code.toUpperCase()) : undefined;
}

/** Display name for a stored country code, falling back to the code itself. */
export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  return COUNTRY_BY_CODE.get(code.toUpperCase())?.name ?? code;
}

/** Regional-indicator flag emoji (renders as two letters on platforms without flag glyphs). */
export function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** Popular countries first, then the rest in list order (India-first, alphabetical). */
export function countriesPopularFirst(): Country[] {
  const popular = POPULAR_COUNTRY_CODES.map((c) => COUNTRY_BY_CODE.get(c)).filter((c): c is Country => !!c);
  const set = new Set<string>(POPULAR_COUNTRY_CODES);
  return [...popular, ...COUNTRIES.filter((c) => !set.has(c.code))];
}

/** Case- and accent-insensitive match on name, ISO code or dial code ("ind", "in", "+91", "91"). */
export function searchCountries(query: string, list: readonly Country[] = COUNTRIES): Country[] {
  const fold = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = fold(query.trim());
  if (!q) return [...list];
  const digits = q.replace(/^\+/, "");
  return list.filter((c) => fold(c.name).includes(q) || c.code.toLowerCase() === q || (/^\d+$/.test(digits) && c.dial.slice(1).startsWith(digits)));
}
