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

export const EVENT_KINDS = ["CASUAL_MEETUP", "ORGANISED_EVENT"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const RSVP_STATUSES = ["YES", "NO", "MAYBE"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const REACTION_TYPES = ["LIKE", "LOVE", "CELEBRATE", "INSIGHTFUL"] as const;
export type ReactionType = (typeof REACTION_TYPES)[number];

export const CONTENT_TYPES = ["POST", "COMMENT", "JOB", "FUNDING", "EVENT"] as const;
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

/** DELIVERED and READ are reported by provider webhooks (WhatsApp/MSG91 status callbacks). */
export const OUTBOUND_MESSAGE_STATUSES = ["QUEUED", "SENDING", "SENT", "DELIVERED", "READ", "FAILED"] as const;
export type OutboundMessageStatus = (typeof OUTBOUND_MESSAGE_STATUSES)[number];

/** What a payment is for; each purpose has a handler that prices it and acts when it is paid (Wave 3). */
export const PAYMENT_PURPOSES = ["EVENT_TICKET", "DONATION"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

/** ATTEMPTED: authorised but not yet captured. PAID is final unless refunded. */
export const PAYMENT_ORDER_STATUSES = ["CREATED", "ATTEMPTED", "PAID", "FAILED", "PARTIALLY_REFUNDED", "REFUNDED", "EXPIRED"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

export const PAYMENT_REFUND_STATUSES = ["PENDING", "PROCESSED", "FAILED"] as const;
export type PaymentRefundStatus = (typeof PAYMENT_REFUND_STATUSES)[number];

export const TENANT_FEATURES = ["feed", "jobs", "funding", "events", "directory"] as const;
export type TenantFeature = (typeof TENANT_FEATURES)[number];
export type TenantFeatures = Record<TenantFeature, boolean>;
export const DEFAULT_TENANT_FEATURES: TenantFeatures = {
  feed: true,
  jobs: true,
  funding: true,
  events: true,
  directory: true,
};

export const MAX_POST_IMAGES = 4;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MIN_BATCH_YEAR = 1950;
export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

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
