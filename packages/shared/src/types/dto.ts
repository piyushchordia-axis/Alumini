import type {
  ApprovalMode,
  ContentType,
  EventKind,
  FundingKind,
  FundingStage,
  JobType,
  MaritalStatus,
  MembershipRole,
  MembershipStatus,
  ModerationStatus,
  NotificationType,
  ProfessionType,
  ReactionType,
  ReportReason,
  ReportStatus,
  RsvpStatus,
  TenantFeatures,
  TenantStatus,
  TenantType,
} from "../constants";
import type { ErrorCode } from "../errorCodes";

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

export type OtpChannel = "whatsapp" | "sms" | "console";

export interface OtpRequestResultDto {
  expiresInSec: number;
  resendAfterSec: number;
  channel: OtpChannel;
  /** Only present when the API runs in development mode. */
  devCode?: string;
}

export interface UserDto {
  id: string;
  phone: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
  createdAt: string;
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
}

export interface DirectoryFiltersDto {
  batchYears: number[];
  cities: string[];
  countries: string[];
  companies: string[];
}

export interface UploadResultDto {
  url: string;
}

export interface PostPageDto extends CursorPage<PostDto> {
  pinned?: PostDto[];
}

export type ContentDto = JobDto | FundingDto | PostDto | CommentDto | EventDto;
