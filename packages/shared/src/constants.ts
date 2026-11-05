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

/** Where a member works, and the industry of a job's company. A fixed list, because free text would make the filter useless. */
export const INDUSTRIES = [
  "SOFTWARE_INTERNET",
  "IT_SERVICES",
  "BANKING_FINANCE",
  "INVESTMENT_VC",
  "CONSULTING",
  "ACCOUNTING",
  "LAW",
  "HEALTHCARE",
  "PHARMA_BIOTECH",
  "EDUCATION_RESEARCH",
  "GOVERNMENT",
  "MANUFACTURING_ENGINEERING",
  "ENERGY",
  "CONSTRUCTION_REAL_ESTATE",
  "RETAIL_CONSUMER",
  "MEDIA_ENTERTAINMENT",
  "MARKETING_ADVERTISING",
  "TELECOM",
  "TRANSPORT_LOGISTICS",
  "HOSPITALITY_TRAVEL",
  "AGRICULTURE",
  "NON_PROFIT",
  "ARTS_DESIGN",
  "OTHER",
] as const;
export type Industry = (typeof INDUSTRIES)[number];
export const INDUSTRY_LABELS: Record<Industry, string> = {
  SOFTWARE_INTERNET: "Software and internet",
  IT_SERVICES: "IT services",
  BANKING_FINANCE: "Banking and finance",
  INVESTMENT_VC: "Investment and venture capital",
  CONSULTING: "Consulting",
  ACCOUNTING: "Accounting",
  LAW: "Law",
  HEALTHCARE: "Healthcare",
  PHARMA_BIOTECH: "Pharma and biotech",
  EDUCATION_RESEARCH: "Education and research",
  GOVERNMENT: "Government and public service",
  MANUFACTURING_ENGINEERING: "Manufacturing and engineering",
  ENERGY: "Energy",
  CONSTRUCTION_REAL_ESTATE: "Construction and real estate",
  RETAIL_CONSUMER: "Retail and consumer goods",
  MEDIA_ENTERTAINMENT: "Media and entertainment",
  MARKETING_ADVERTISING: "Marketing and advertising",
  TELECOM: "Telecom",
  TRANSPORT_LOGISTICS: "Transport and logistics",
  HOSPITALITY_TRAVEL: "Hospitality and travel",
  AGRICULTURE: "Agriculture",
  NON_PROFIT: "Non-profit",
  ARTS_DESIGN: "Arts and design",
  OTHER: "Other",
};

/** What a member is open to, beyond work (the job-seeker profile) and mentoring (the mentor profile). */
export const OPEN_TO = ["HIRING", "COLLABORATING", "INVESTING"] as const;
export type OpenTo = (typeof OPEN_TO)[number];
export const OPEN_TO_LABELS: Record<OpenTo, string> = {
  HIRING: "Hiring",
  COLLABORATING: "Collaborating",
  INVESTING: "Investing",
};

/**
 * The background a member chooses for the signed-in app, at one institution: the plain page, a tint of the institution's
 * colour, the institution's cover photo, or a photo of their own (see pageBackdrop).
 */
export const MEMBER_BACKDROPS = ["PLAIN", "BRAND", "COVER", "PHOTO"] as const;
export type MemberBackdrop = (typeof MEMBER_BACKDROPS)[number];

export const WORK_MODES = ["ON_SITE", "HYBRID", "REMOTE"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  ON_SITE: "On-site",
  HYBRID: "Hybrid",
  REMOTE: "Remote",
};

export const JOB_SENIORITIES = ["ENTRY", "MID", "SENIOR", "LEAD", "MANAGER", "EXECUTIVE"] as const;
export type JobSeniority = (typeof JOB_SENIORITIES)[number];
export const JOB_SENIORITY_LABELS: Record<JobSeniority, string> = {
  ENTRY: "Entry level",
  MID: "Mid level",
  SENIOR: "Senior",
  LEAD: "Lead",
  MANAGER: "Manager",
  EXECUTIVE: "Executive",
};

export const SALARY_PERIODS = ["YEAR", "MONTH", "HOUR"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];
export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  YEAR: "Per year",
  MONTH: "Per month",
  HOUR: "Per hour",
};

/** Salaries are stored in minor units, and every currency here has two minor digits. */
export const SALARY_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "CAD", "AUD"] as const;
export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];
export const SALARY_CURRENCY_LABELS: Record<SalaryCurrency, string> = {
  INR: "Indian rupee (₹)",
  USD: "US dollar ($)",
  EUR: "Euro (€)",
  GBP: "British pound (£)",
  AED: "UAE dirham (AED)",
  SGD: "Singapore dollar (S$)",
  CAD: "Canadian dollar (C$)",
  AUD: "Australian dollar (A$)",
};
/** Written before the amount. The dirham's own sign is right-to-left script, so its code stands in for it. */
export const SALARY_CURRENCY_SYMBOLS: Record<SalaryCurrency, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
  GBP: "£",
  AED: "AED ",
  SGD: "S$",
  CAD: "C$",
  AUD: "A$",
};

export const COMPANY_SIZES = ["SIZE_1_10", "SIZE_11_50", "SIZE_51_200", "SIZE_201_1000", "SIZE_1001_5000", "SIZE_5001_PLUS"] as const;
export type CompanySize = (typeof COMPANY_SIZES)[number];
export const COMPANY_SIZE_LABELS: Record<CompanySize, string> = {
  SIZE_1_10: "1–10",
  SIZE_11_50: "11–50",
  SIZE_51_200: "51–200",
  SIZE_201_1000: "201–1,000",
  SIZE_1001_5000: "1,001–5,000",
  SIZE_5001_PLUS: "5,001+",
};

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
/** Why a chat report is Illuminize staff's: it's about an admin, or no other admin can handle it. */
export const CHAT_REPORT_ESCALATION_BASES = ["REPORTED_ADMIN", "NO_ELIGIBLE_ADMIN"] as const;
export type ChatReportEscalationBasis = (typeof CHAT_REPORT_ESCALATION_BASES)[number];
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

/** What a mentor can help with. A fixed list, because free text would make the filter useless. */
export const MENTOR_AREAS = [
  "CAREER_ADVICE",
  "HIGHER_STUDIES",
  "ENTREPRENEURSHIP",
  "SOFTWARE_IT",
  "FINANCE",
  "CONSULTING",
  "MARKETING_SALES",
  "DESIGN_MEDIA",
  "LAW",
  "HEALTHCARE",
  "PUBLIC_SERVICE",
  "WORKING_ABROAD",
] as const;
export type MentorArea = (typeof MENTOR_AREAS)[number];
export const MENTOR_AREA_LABELS: Record<MentorArea, string> = {
  CAREER_ADVICE: "Career advice",
  HIGHER_STUDIES: "Higher studies",
  ENTREPRENEURSHIP: "Entrepreneurship",
  SOFTWARE_IT: "Software and IT",
  FINANCE: "Finance",
  CONSULTING: "Consulting",
  MARKETING_SALES: "Marketing and sales",
  DESIGN_MEDIA: "Design and media",
  LAW: "Law",
  HEALTHCARE: "Healthcare",
  PUBLIC_SERVICE: "Public service",
  WORKING_ABROAD: "Working abroad",
};
/** Areas one mentor may list. */
export const MENTOR_MAX_AREAS = 5;

export const MENTOR_AVAILABILITIES = ["WEEKLY", "FORTNIGHTLY", "MONTHLY", "ONE_OFF"] as const;
export type MentorAvailability = (typeof MENTOR_AVAILABILITIES)[number];
export const MENTOR_AVAILABILITY_LABELS: Record<MentorAvailability, string> = {
  WEEKLY: "Weekly",
  FORTNIGHTLY: "Every two weeks",
  MONTHLY: "Monthly",
  ONE_OFF: "A one-off conversation",
};
export const MENTOR_NOTE_MAX_LENGTH = 500;
export const MENTOR_AVAILABILITY_NOTE_MAX_LENGTH = 200;

/**
 * REQUESTED: waiting for the mentor. ACCEPTED: under way, with a chat. DECLINED: the mentor said no, or stopped mentoring
 * first. ENDED: withdrawn by the mentee before an answer, or ended by either side after.
 */
export const MENTORSHIP_STATUSES = ["REQUESTED", "ACCEPTED", "DECLINED", "ENDED"] as const;
export type MentorshipStatus = (typeof MENTORSHIP_STATUSES)[number];
/** received: requests to this member as a mentor. sent: this member's own requests. Lower case, as it goes in URLs. */
export const MENTORSHIP_BOXES = ["received", "sent"] as const;
export type MentorshipBox = (typeof MENTORSHIP_BOXES)[number];
/** A request's note, after trimming. The mentor reads it, and it becomes the chat's first message if they accept. */
export const MENTORSHIP_NOTE_MIN_LENGTH = 10;
export const MENTORSHIP_NOTE_MAX_LENGTH = 500;
/** Requests one member may send one mentor in any MENTORSHIP_REQUEST_WINDOW_DAYS, whatever became of them. */
export const MENTORSHIP_MAX_REQUESTS_PER_PAIR = 3;
export const MENTORSHIP_REQUEST_WINDOW_DAYS = 30;
/** Requests waiting and mentorships under way, together, that one mentee may have. */
export const MENTORSHIP_MAX_OPEN_PER_MENTEE = 5;

/**
 * REQUESTED: waiting for the job's poster. ACCEPTED: the poster agreed, which opened a chat. DECLINED: the poster said no,
 * which is final for that job. WITHDRAWN: its sender took it back before an answer. CLOSED: the job stopped taking referral
 * requests while it waited.
 */
export const REFERRAL_STATUSES = ["REQUESTED", "ACCEPTED", "DECLINED", "WITHDRAWN", "CLOSED"] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];
/** received: requests about this member's own jobs. sent: this member's own requests. Lower case, as it goes in URLs. */
export const REFERRAL_BOXES = ["received", "sent"] as const;
export type ReferralBox = (typeof REFERRAL_BOXES)[number];
/** A request's note, after trimming. The poster reads it, and it becomes the chat's first message if they accept. */
export const REFERRAL_NOTE_MIN_LENGTH = 10;
export const REFERRAL_NOTE_MAX_LENGTH = 500;
/** Requests one member may send about one job, whatever became of them. */
export const REFERRAL_MAX_REQUESTS_PER_JOB = 3;
/** Requests waiting for an answer that one member may have at once. */
export const REFERRAL_MAX_OPEN_PER_REQUESTER = 10;
/** Requests one job may have waiting for its poster at once, counting only those the poster can see. */
export const REFERRAL_MAX_WAITING_PER_JOB = 25;

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
  "MENTORSHIP_REQUESTED",
  "MENTORSHIP_ACCEPTED",
  "MENTORSHIP_DECLINED",
  "MENTORSHIP_ENDED",
  "REFERRAL_REQUESTED",
  "REFERRAL_ACCEPTED",
  "REFERRAL_DECLINED",
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
/** A channel on its own, as a label or a checkbox names it. */
export const MESSAGE_CHANNEL_LABELS: Record<MessageChannel, string> = { WHATSAPP: "WhatsApp", SMS: "SMS", EMAIL: "Email" };

/** A channel inside a sentence ("by WhatsApp, then email"), where email takes a small letter. */
export function channelName(channel: MessageChannel): string {
  return channel === "EMAIL" ? "email" : MESSAGE_CHANNEL_LABELS[channel];
}

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

export const TENANT_FEATURES = ["feed", "jobs", "funding", "events", "directory", "businesses", "messaging", "groups", "mentorship"] as const;
export type TenantFeature = (typeof TENANT_FEATURES)[number];
export type TenantFeatures = Record<TenantFeature, boolean>;
/** What an admin's settings and the API's refusals call each switch. */
export const TENANT_FEATURE_LABELS: Record<TenantFeature, string> = {
  feed: "Community feed",
  jobs: "Jobs",
  funding: "Funding",
  events: "Events & meetups",
  directory: "Member directory",
  businesses: "Business directory",
  messaging: "Messaging",
  groups: "Groups",
  mentorship: "Mentorship",
};

export const CELEBRATION_KINDS = ["BIRTHDAY", "ANNIVERSARY"] as const;
export type CelebrationKind = (typeof CELEBRATION_KINDS)[number];

/** ANNOUNCEMENT: an admin's notice, pinned by default and sent to every member. */
export const POST_KINDS = ["POST", "ANNOUNCEMENT"] as const;
export type PostKind = (typeof POST_KINDS)[number];

export const MAX_POST_IMAGES = 4;
export const MAX_POLL_OPTIONS = 6;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
/**
 * What an upload is for (`?purpose=`). An avatar is cropped to a square JPEG and is the only kind a profile photo may use;
 * a backdrop is a JPEG of at most BACKDROP_MAX_SIDE and the only kind a member's own background may use.
 */
export const UPLOAD_PURPOSES = ["image", "avatar", "backdrop"] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
/** Side of the square a profile photo is cropped to, in pixels. */
export const AVATAR_SIZE = 512;
/** Longest side of a member's background photo. It sits under a veil that hides most of its detail. */
export const BACKDROP_MAX_SIDE = 1600;
/** Longest side of a stored image; the server scales larger ones down, and the apps prepare photos to fit it. */
export const MAX_IMAGE_SIDE = 2048;
/** JPEG quality (0 to 1) the apps save a prepared photo at; the server encodes it once more. */
export const UPLOAD_JPEG_QUALITY = 0.85;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
export const MIN_BATCH_YEAR = 1950;
/** Limits on the profile's own details (see membershipProfileSchema). */
export const PROFILE_HEADLINE_MAX_LENGTH = 120;
export const PROFILE_MAX_SKILLS = 20;
export const SKILL_MAX_LENGTH = 40;
/** A degree's name, and a field of study, here or elsewhere. */
export const PROFILE_DEGREE_MAX_LENGTH = 80;
/** A company, title or institution in the work and study history. */
export const PROFILE_HISTORY_NAME_MAX_LENGTH = 120;
export const PROFILE_MAX_EXPERIENCES = 15;
export const PROFILE_MAX_EDUCATION = 10;
/** The earliest year a profile's work or studies may start or end in. */
export const PROFILE_MIN_YEAR = 1940;
/** How many years ahead studies elsewhere may be due to end, as a batch may be. */
export const PROFILE_EDUCATION_YEARS_AHEAD = 10;
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

export const CHAT_REPORT_ESCALATION_LABELS: Record<ChatReportEscalationBasis, string> = {
  REPORTED_ADMIN: "About an admin",
  NO_ELIGIBLE_ADMIN: "No other admin",
};

/** The NEEDS_OTHER_STAFF answer, which the platform console also shows on such a report. */
export const NEEDS_OTHER_STAFF_TEXT = "You changed this institution's admins after this report was filed, so another member of Illuminize staff needs to handle it.";

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

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  OPEN: "Open",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

/** The badge tones both apps have, for a status badge: waiting, fine, refused, or set aside. */
export type StatusTone = "warning" | "success" | "danger" | "neutral";
export const MEMBER_STATUS_TONE: Record<MembershipStatus, StatusTone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", SUSPENDED: "neutral" };
export const MODERATION_STATUS_TONE: Record<ModerationStatus, StatusTone> = { PENDING: "warning", APPROVED: "success", REJECTED: "danger", REMOVED: "neutral" };

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
