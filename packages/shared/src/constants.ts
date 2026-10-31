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

/** ISO-3166 alpha-2 country list with dial codes; India first since it is the primary market. */
export const COUNTRIES: ReadonlyArray<{ code: string; name: string; dial: string }> = [
  { code: "IN", name: "India", dial: "+91" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "CH", name: "Switzerland", dial: "+41" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "HK", name: "Hong Kong", dial: "+852" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "VN", name: "Vietnam", dial: "+84" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "OM", name: "Oman", dial: "+968" },
  { code: "BH", name: "Bahrain", dial: "+973" },
  { code: "ZA", name: "South Africa", dial: "+27" },
  { code: "KE", name: "Kenya", dial: "+254" },
  { code: "NG", name: "Nigeria", dial: "+234" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "LK", name: "Sri Lanka", dial: "+94" },
  { code: "NP", name: "Nepal", dial: "+977" },
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "MU", name: "Mauritius", dial: "+230" },
  { code: "IL", name: "Israel", dial: "+972" },
  { code: "TR", name: "Türkiye", dial: "+90" },
  { code: "RU", name: "Russia", dial: "+7" },
];

export const COUNTRY_NAME_BY_CODE: Record<string, string> = Object.fromEntries(
  COUNTRIES.map((c) => [c.code, c.name]),
);
