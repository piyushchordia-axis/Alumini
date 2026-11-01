import type {
  ApprovalMode,
  BillingCycle,
  BillingModel,
  ContentType,
  EventKind,
  FundingKind,
  FundingStage,
  JobType,
  MaritalStatus,
  MembershipRole,
  MessageChannel,
  MembershipStatus,
  ModerationStatus,
  NotificationType,
  OutboundMessageStatus,
  PaymentOrderStatus,
  PaymentPurpose,
  ProfessionType,
  ProfileFieldType,
  ProfileFieldVisibility,
  ReactionType,
  ReportReason,
  ReportStatus,
  RsvpStatus,
  TenantFeatures,
  TenantStatus,
  TenantType,
} from "../constants";
import type { ErrorCode } from "../errorCodes";
import type { ResolvedNotificationPrefs } from "../lib/notifications";
import type { ProfileFieldOption, ProfileFieldValue } from "../lib/profileFields";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: unknown };
}

export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface TenantSummaryDto {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  type: TenantType;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
  primaryColor: string;
}

export interface TenantPublicSettings {
  memberApprovalMode: ApprovalMode;
  allowSelfRegistration: boolean;
  minBatchYear: number;
  maxBatchYear: number;
  features: TenantFeatures;
}

export interface TenantPublicDto extends TenantSummaryDto {
  status: TenantStatus;
  coverImageUrl: string | null;
  secondaryColor: string;
  tagline: string | null;
  welcomeMessage: string | null;
  websiteUrl: string | null;
  /** IANA time zone of the institution. */
  timezone: string;
  settings: TenantPublicSettings;
}

export interface TenantSettingsDto {
  memberApprovalMode: ApprovalMode;
  contentModerationMode: ApprovalMode;
  allowSelfRegistration: boolean;
  minBatchYear: number;
  maxBatchYear: number;
  features: TenantFeatures;
  updatedAt: string;
}

/** The tenant admin settings page: settings, branding, and what the subscription allows. */
export interface AdminSettingsDto {
  settings: TenantSettingsDto;
  branding: TenantPublicDto;
  /** WhatsApp/SMS/email channels the institution can use for invites and announcements today (plan ∩ configured). */
  outboundChannels: MessageChannel[];
}

export type OtpChannel = "whatsapp" | "sms" | "console";

export interface OtpRequestResultDto {
  expiresInSec: number;
  resendAfterSec: number;
  channel: OtpChannel;
  /** Only present when the API runs in development mode. */
  devCode?: string;
}

/** A member's notification preferences in one institution, with defaults filled in. */
export interface NotificationPrefsDto extends ResolvedNotificationPrefs {
  /** Whether the account has a confirmed email (email preferences only apply then). */
  hasEmail: boolean;
}

/** What an unsubscribe link turns off. */
export interface UnsubscribeInfoDto {
  tenantName: string;
  scope: "digest" | "announcements";
  /** Already off. */
  unsubscribed: boolean;
}

export interface UserDto {
  id: string;
  phone: string;
  displayName: string | null;
  /** The confirmed email address, if any. Never shown to other members. */
  email: string | null;
  emailVerifiedAt: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
}

/** The caller's email: the confirmed address, and an address waiting for its confirmation link to be opened. */
export interface EmailStatusDto {
  email: string | null;
  verifiedAt: string | null;
  pending: { email: string; expiresAt: string } | null;
}

export interface MembershipSummaryDto {
  id: string;
  tenant: TenantSummaryDto;
  role: MembershipRole;
  status: MembershipStatus;
  statusReason: string | null;
  fullName: string;
  batchYear: number;
  avatarUrl: string | null;
}

export interface MeDto {
  user: UserDto;
  memberships: MembershipSummaryDto[];
}

export interface AuthSessionDto extends MeDto {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPairDto {
  accessToken: string;
  refreshToken: string;
}

/** An institution's own profile question. */
export interface ProfileFieldDto {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  type: ProfileFieldType;
  options: ProfileFieldOption[];
  required: boolean;
  visibility: ProfileFieldVisibility;
  memberEditable: boolean;
  filterable: boolean;
  position: number;
  /** Archived fields are hidden everywhere; their answers are kept. */
  archivedAt: string | null;
}

/** One answer on a profile, with the field's label and a ready-to-show text. */
export interface ProfileFieldAnswerDto {
  key: string;
  label: string;
  type: ProfileFieldType;
  visibility: ProfileFieldVisibility;
  value: ProfileFieldValue | null;
  display: string;
}

export interface MembershipDto {
  id: string;
  tenantId: string;
  role: MembershipRole;
  status: MembershipStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  fullName: string;
  batchYear: number;
  dateOfBirth: string | null;
  professionType: ProfessionType;
  companyName: string | null;
  designation: string | null;
  city: string | null;
  country: string | null;
  maritalStatus: MaritalStatus | null;
  kidsCount: number | null;
  bio: string | null;
  linkedinUrl: string | null;
  interests: string[];
  avatarUrl: string | null;
  isPhoneVisible: boolean;
  /** Answers to the institution's questions (the member's own and admins' views include admin-only ones). */
  fields: ProfileFieldAnswerDto[];
  /** Deprecated (older app versions): members-visible answers as { label: text }. */
  extra: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** Compact member representation used in lists, authors and attendees. */
export interface MemberCardDto {
  id: string;
  fullName: string;
  batchYear: number;
  professionType: ProfessionType;
  companyName: string | null;
  designation: string | null;
  city: string | null;
  country: string | null;
  avatarUrl: string | null;
  role: MembershipRole;
  isOpenToWork: boolean;
}

export interface MemberProfileDto extends MemberCardDto {
  bio: string | null;
  linkedinUrl: string | null;
  interests: string[];
  /** Answers to the institution's questions that members may see. */
  fields: ProfileFieldAnswerDto[];
  /** Deprecated (older app versions): the same answers as { label: text }. */
  extra: Record<string, unknown>;
  /** Present only when the member chose to share it. */
  phone: string | null;
  memberSince: string;
}

export interface AdminMemberDto extends MembershipDto {
  userId: string;
  phone: string;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export interface AuditDto {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  actorMembershipId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardDto {
  pendingMembers: number;
  approvedMembers: number;
  rejectedMembers: number;
  suspendedMembers: number;
  newMembersLast30d: number;
  activeMembersLast30d: number;
  pendingContent: number;
  openReports: number;
  upcomingEvents: number;
  postsLast7d: number;
}

export interface ModerationFields {
  moderationStatus: ModerationStatus;
  moderationNote: string | null;
  moderatedAt: string | null;
}

export interface JobDto extends ModerationFields {
  id: string;
  title: string;
  companyName: string;
  location: string | null;
  isRemote: boolean;
  jobType: JobType;
  description: string;
  applyUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  salaryRange: string | null;
  isClosed: boolean;
  expiresAt: string | null;
  author: MemberCardDto;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface JobSeekerDto {
  member: MemberCardDto;
  note: string;
  preferredRoles: string | null;
  preferredLocations: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface FundingDto extends ModerationFields {
  id: string;
  kind: FundingKind;
  title: string;
  stage: FundingStage | null;
  amountMinMinor: number | null;
  amountMaxMinor: number | null;
  currency: string;
  pitch: string;
  sectors: string[];
  websiteUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  isClosed: boolean;
  author: MemberCardDto;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PostDto extends ModerationFields {
  id: string;
  body: string;
  imageUrls: string[];
  commentCount: number;
  reactionCount: number;
  myReaction: ReactionType | null;
  isPinned: boolean;
  author: MemberCardDto;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommentDto {
  id: string;
  postId: string;
  body: string;
  author: MemberCardDto;
  isMine: boolean;
  moderationStatus: ModerationStatus;
  createdAt: string;
}

export interface ReactionSummaryDto {
  reactionCount: number;
  myReaction: ReactionType | null;
}

export interface ReactionEntryDto {
  member: MemberCardDto;
  type: ReactionType;
  createdAt: string;
}

export interface EventDto extends ModerationFields {
  id: string;
  title: string;
  description: string;
  kind: EventKind;
  city: string;
  venueName: string | null;
  address: string | null;
  startAt: string;
  endAt: string | null;
  timezone: string;
  maxAttendees: number | null;
  coverImageUrl: string | null;
  isCancelled: boolean;
  yesCount: number;
  maybeCount: number;
  myRsvp: RsvpStatus | null;
  author: MemberCardDto;
  isMine: boolean;
  attendeePreview?: MemberCardDto[];
  createdAt: string;
  updatedAt: string;
}

export interface RsvpSummaryDto {
  myRsvp: RsvpStatus | null;
  yesCount: number;
  maybeCount: number;
}

export interface ReportDto {
  id: string;
  contentType: ContentType;
  contentId: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolutionNote: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ContentPreviewDto {
  title: string | null;
  excerpt: string | null;
  moderationStatus: ModerationStatus;
  authorMembershipId: string;
}

export interface AdminReportDto extends ReportDto {
  reporter: MemberCardDto;
  content: ContentPreviewDto | null;
}

export interface ModerationItemDto {
  contentType: ContentType;
  id: string;
  title: string | null;
  excerpt: string | null;
  author: MemberCardDto;
  moderationStatus: ModerationStatus;
  moderatedAt: string | null;
  createdAt: string;
  reportCount: number;
  /** Posts only: whether it is pinned to the top of the feed. */
  isPinned: boolean;
}

export interface DirectoryFiltersDto {
  batchYears: number[];
  cities: string[];
  countries: string[];
  companies: string[];
  /** The institution's filterable questions (choice and yes/no fields). */
  fields: Array<{ key: string; label: string; options: ProfileFieldOption[] }>;
}

export interface UploadResultDto {
  url: string;
}

export interface PostPageDto extends CursorPage<PostDto> {
  pinned?: PostDto[];
}

export type ContentDto = JobDto | FundingDto | PostDto | CommentDto | EventDto;

export interface TenantCountsDto {
  approvedMembers: number;
  pendingMembers: number;
  suspendedMembers: number;
  activeMembers30d: number;
  newMembers30d: number;
}

export interface PlatformTenantRowDto extends TenantSummaryDto {
  status: TenantStatus;
  createdAt: string;
  counts: TenantCountsDto;
  billingModel: BillingModel | null;
}

export interface BillingPlanDto {
  id: string;
  tenantId: string;
  billingModel: BillingModel;
  billingCycle: BillingCycle;
  currency: string;
  pricePerActiveUserMinor: number | null;
  flatFeeMinor: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
  /** Channels the institution may use for invites and announcements (in-app and push are always included). */
  includedChannels: MessageChannel[];
  /** Charge per delivered message, in minor units (may be fractional). Missing = not charged. */
  messageRatesMinor: Partial<Record<MessageChannel, number>>;
  createdAt: string;
}

export interface BillingSnapshotDto {
  id: string;
  tenantId: string;
  billingPlanId: string | null;
  periodStart: string;
  periodEnd: string;
  approvedMemberCount: number;
  activeMemberCount: number;
  newMemberCount: number;
  /** Delivered messages per channel in the period. */
  messageCounts: Partial<Record<MessageChannel, number>>;
  /** Message charges (included in amountMinor). */
  messageAmountMinor: number;
  amountMinor: number;
  currency: string;
  notes: string | null;
  createdAt: string;
}

export interface BillingUsageDto {
  /** Inclusive calendar days in `timeZone`. */
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  /** Approved at the end of the period (and not suspended by then). */
  approvedMembers: number;
  /** Distinct members who used the app on at least one day of the period. */
  activeMembers: number;
  /** Members first approved during the period. */
  newMembers: number;
  plan: BillingPlanDto | null;
  /** Share of the plan's billing cycle the period covers (1 = one full cycle); the estimate is prorated by it. */
  cycleFraction: number;
  /** Delivered WhatsApp, SMS and email messages sent for the institution in the period (sent, delivered or read). */
  messages: Record<MessageChannel, number>;
  /** Membership charge (plan price, prorated). */
  memberAmountMinor: number;
  /** Messages × the plan's per-message rates. */
  messageAmountMinor: number;
  /** memberAmountMinor + messageAmountMinor. */
  estimatedAmountMinor: number;
  currency: string;
}

export interface PlatformTenantDto {
  tenant: TenantPublicDto & { createdAt: string; updatedAt: string };
  settings: TenantSettingsDto;
  counts: TenantCountsDto;
  currentPlan: BillingPlanDto | null;
  admins: AdminMemberDto[];
}

export interface PlatformUserDto extends UserDto {
  lastLoginAt: string | null;
  memberships: MembershipSummaryDto[];
}

export interface PlatformStatsDto {
  tenants: { total: number; byStatus: Record<TenantStatus, number> };
  users: number;
  memberships: Record<MembershipStatus, number>;
  content: { posts: number; jobs: number; funding: number; events: number };
  activeMembers30d: number;
  perTenant: PlatformTenantRowDto[];
}

/** An outbound WhatsApp/SMS/email message and its delivery state (platform console, Wave 1 invite status). */
export interface OutboundMessageDto {
  id: string;
  tenantId: string | null;
  type: string;
  status: OutboundMessageStatus;
  /** Requested channels in preference order, and the one that delivered (or was last tried). */
  channels: MessageChannel[];
  channel: MessageChannel | null;
  provider: string | null;
  toPhone: string | null;
  toEmail: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  failedAt: string | null;
  createdAt: string;
}

/** What the app needs to open the provider's checkout (Razorpay Checkout options, or the mock). */
export interface PaymentCheckoutDto {
  provider: "razorpay" | "mock";
  /** Razorpay key id (public). */
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  notes: Record<string, string>;
}

export interface PaymentOrderDto {
  id: string;
  purpose: PaymentPurpose;
  referenceId: string;
  amountMinor: number;
  currency: string;
  status: PaymentOrderStatus;
  amountRefundedMinor: number;
  description: string | null;
  paidAt: string | null;
  createdAt: string;
  /** Present while the order can still be paid. */
  checkout: PaymentCheckoutDto | null;
}
