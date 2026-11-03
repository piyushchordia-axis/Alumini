import type {
  ApprovalMode,
  BillingCycle,
  BillingModel,
  CelebrationKind,
  ChatConversationKind,
  ChatGroupVisibility,
  ChatMessageKind,
  ChatOrigin,
  ChatParticipantRole,
  ChatParticipantState,
  ChatReportAction,
  ChatReportTargetKind,
  ContentType,
  EventKind,
  BusinessCategory,
  FundingKind,
  FundingStage,
  InvitationStatus,
  JobType,
  MaritalStatus,
  MembershipRole,
  MentorArea,
  MentorAvailability,
  MentorshipBox,
  MentorshipStatus,
  MessageChannel,
  MembershipStatus,
  ModerationStatus,
  NotificationType,
  OutboundMessageStatus,
  PaymentOrderStatus,
  PaymentPurpose,
  PostKind,
  ProfessionType,
  ProfileFieldType,
  ProfileFieldVisibility,
  ReactionType,
  ReferralBox,
  ReferralStatus,
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
  /** Whether members' posts, listings and groups wait for an admin, so a form can say so before it's sent. Admins' never do. */
  contentModerationMode: ApprovalMode;
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
  inviteAutoApprove: boolean;
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

export interface InvitationDeliveryDto {
  status: OutboundMessageStatus;
  /** The channel that delivered (or was last tried). */
  channel: MessageChannel | null;
  lastError: string | null;
  at: string;
}

export interface InvitationDto {
  id: string;
  phone: string;
  email: string | null;
  fullName: string | null;
  batchYear: number | null;
  status: InvitationStatus;
  /** Past expires_at and not accepted or revoked. */
  expired: boolean;
  expiresAt: string;
  sendCount: number;
  lastSentAt: string | null;
  acceptedAt: string | null;
  acceptedMembershipId: string | null;
  createdAt: string;
  /** The link to share (null when the server has no WEB_APP_URL). */
  link: string | null;
  /** The latest message sent for this invitation. */
  delivery: InvitationDeliveryDto | null;
}

export interface InvitationImportResultDto {
  created: number;
  updated: number;
  skipped: number;
  /** How many were queued for sending. */
  queued: number;
  results: Array<{ row: number; phone: string; status: "created" | "updated" | "member" | "invalid"; message?: string; invitationId?: string }>;
}

export interface InvitationSummaryDto {
  pending: number;
  sent: number;
  accepted: number;
  revoked: number;
  expired: number;
  /** Channels the institution's plan allows for invites (empty: share links yourself). */
  channels: MessageChannel[];
  /** Invites that can still be sent today (daily limit). */
  sendableToday: number;
}

/** What a public invite link shows before sign-in. */
export interface InvitePublicDto {
  tenant: TenantSummaryDto;
  firstName: string | null;
  /** e.g. +91******210 */
  maskedPhone: string;
}

/** The signed-in person's open invitation to an institution, to prefill registration. */
export interface MyInvitationDto {
  fullName: string | null;
  batchYear: number | null;
  fields: Record<string, ProfileFieldValue>;
  /** Accepting approves the membership straight away. */
  autoApprove: boolean;
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
  celebrateBirthday: boolean;
  celebrateAnniversary: boolean;
  /** Answers to the institution's questions (the member's own and admins' views include admin-only ones). */
  fields: ProfileFieldAnswerDto[];
  /** Approved and not a current pupil, so private contact is open to them. Whether it's switched on is a separate question. */
  chatEligible: boolean;
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

/** A card in the directory, which alone works out whether a member mentors. */
export interface DirectoryCardDto extends MemberCardDto {
  /** An active mentor. Always false while mentorship is off here, or for a viewer who can't use it. */
  isMentor: boolean;
}

export interface MemberProfileDto extends MemberCardDto {
  bio: string | null;
  linkedinUrl: string | null;
  interests: string[];
  /** Answers to the institution's questions that members may see. */
  fields: ProfileFieldAnswerDto[];
  /** Present only when the member chose to share it. */
  phone: string | null;
  memberSince: string;
  /** Whether to offer "Message". Never false because of a block, which would reveal it. */
  canMessage: boolean;
}

export interface AdminMemberDto extends Omit<MembershipDto, "chatEligible"> {
  userId: string;
  phone: string;
  lastActiveAt: string | null;
  lastLoginAt: string | null;
}

/** One member, as an admin opens them. */
export interface AdminMemberDetailDto extends AdminMemberDto {
  audit: AuditDto[];
  /** Their mentor profile, active or not, or null if they never offered to mentor. Its note can't be reported, so admins see it here. */
  mentorProfile: MentorProfileDto | null;
}

/** A member's mentor profile, as they and admins see it. */
export interface MentorProfileDto {
  areas: MentorArea[];
  availability: MentorAvailability;
  availabilityNote: string | null;
  note: string | null;
  /** In the Mentors list. False once they stop mentoring, or an admin removes them as a mentor. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A mentor in the Mentors list. */
export interface MentorCardDto {
  member: MemberCardDto;
  areas: MentorArea[];
  availability: MentorAvailability;
}

/** The viewer's own request to a mentor that is still open. It reads the same whatever has become of it on the mentor's side. */
export interface MentorshipLinkDto {
  id: string;
  status: Extract<MentorshipStatus, "REQUESTED" | "ACCEPTED">;
  /** The chat, once accepted. */
  conversationId: string | null;
}

/** A mentor's own page. */
export interface MentorDto extends MentorCardDto {
  availabilityNote: string | null;
  note: string | null;
  isMe: boolean;
  /** Set while the viewer has a request waiting with them, or a mentorship under way: they can't ask again until it's over. */
  myRequest: MentorshipLinkDto | null;
}

/**
 * A mentorship request as one side of it sees it. The mentee's copy depends only on what they did and what the mentor
 * answered, so a request the mentor never sees reads exactly like one they haven't answered yet.
 */
export interface MentorshipDto {
  id: string;
  /** received: this member is the mentor. sent: the mentee. */
  box: MentorshipBox;
  status: MentorshipStatus;
  /** The other member: the mentee on a received request, the mentor on a sent one. Null once they've deleted their account: show DELETED_MEMBER_NAME. */
  member: MemberCardDto | null;
  /** The mentee's note, which became the chat's first message if accepted. */
  note: string;
  /** The chat an acceptance opened, still there once it has ended. */
  conversationId: string | null;
  /** ENDED by this member: they withdrew the request, or ended the mentorship. */
  endedByMe: boolean;
  createdAt: string;
  /** When the mentor accepted or declined, or stopped mentoring, which declines what was waiting. */
  respondedAt: string | null;
  /** Set only if it was accepted: ENDED without it was withdrawn before an answer. */
  acceptedAt: string | null;
  endedAt: string | null;
  canAccept: boolean;
  canDecline: boolean;
  /** On a received request that never became a mentorship and that this member hasn't reported yet, withdrawn ones included. */
  canReport: boolean;
  canWithdraw: boolean;
  canEnd: boolean;
}

export interface MentorshipPageDto extends CursorPage<MentorshipDto> {
  /** Requests in this list still waiting for an answer, across every page. */
  waiting: number;
}

/** What a member still has in mentorship, which decides whether the apps keep a way into it while they can't use it. */
export interface MentorshipSummaryDto {
  /** Listed as a mentor. */
  listed: boolean;
  /** Requests waiting and mentorships under way, sent or received, as their lists show them. */
  open: number;
}

export interface ChatMemberDto {
  id: string;
  fullName: string;
  avatarUrl: string | null;
}

export interface ChatMessageDto {
  id: string;
  conversationId: string;
  /** Position in the conversation. Order by this, never by time. A member can see gaps, which aren't missing messages. */
  seq: number;
  kind: ChatMessageKind;
  /** Null once the sender has deleted their account: show DELETED_MEMBER_NAME. Null too when `redacted`. */
  sender: ChatMemberDto | null;
  /** Null when an admin removed the message, and on a redacted TEXT message. A SYSTEM line keeps its fixed text. */
  body: string | null;
  removed: boolean;
  /**
   * Sent in a group by someone this member has blocked: show BLOCKED_MEMBER_NAME, and nothing they wrote. Only ever true for
   * the member who blocked them; everyone else, the sender included, sees the message as it is.
   */
  redacted: boolean;
  /** A SYSTEM line's `event` (ChatGroupEvent), which is about its sender. */
  meta: Record<string, unknown> | null;
  /** The client's own key for the send, on the sender's copy only, so it can settle its optimistic row. */
  clientKey: string | null;
  createdAt: string;
}

/**
 * A direct thread as this member sees it. A requester's REQUEST_SENT looks the same whether the request is waiting,
 * declined or blocked, and REQUEST_DECLINED is only ever shown to the member who declined.
 */
export type ChatThreadState = "REQUEST_SENT" | "REQUEST_RECEIVED" | "REQUEST_DECLINED" | "ACCEPTED" | "CLOSED";

export interface ChatLastMessageDto {
  seq: number;
  kind: ChatMessageKind;
  /** Null when an admin removed the message, or it's redacted for this member. */
  body: string | null;
  mine: boolean;
  /**
   * Who sent it, in a group, where a preview names them. Always null in a direct thread, where `mine` says all there is to
   * say, and null for a deleted or blocked member.
   */
  sender: ChatMemberDto | null;
  /** From someone this member blocked, in a group: see ChatMessageDto.redacted. */
  redacted: boolean;
  createdAt: string;
}

/** A group thread's own details, as an inbox row and a thread header need them. */
export interface ChatConversationGroupDto {
  /** The name an admin approved, which is all members ever see. Its owner sees their own until it's first approved. */
  name: string;
  visibility: ChatGroupVisibility;
  memberCount: number;
  /** Read-only for its members, and gone from Discover. */
  archived: boolean;
  isOwner: boolean;
}

export interface ChatConversationDto {
  id: string;
  kind: ChatConversationKind;
  origin: ChatOrigin;
  /** Null once the other member has deleted their account: show DELETED_MEMBER_NAME. Always null in a group. */
  peer: ChatMemberDto | null;
  /** A group's details, or null in a direct thread. A group's state is always ACCEPTED. */
  group: ChatConversationGroupDto | null;
  state: ChatThreadState;
  canSend: boolean;
  /** When this member may next ask, for a thread they can't send in until then. Null if they can't. */
  canRerequestAt: string | null;
  blockedByMe: boolean;
  /**
   * 0 while this member has the other blocked. In a group, the messages since they last read, not counting system lines,
   * removed messages or anything from someone they blocked.
   */
  unread: number;
  /** How far they've read of what they can see. */
  lastReadSeq: number;
  mutedUntil: string | null;
  /** When this member last had anything to see here, which a message withheld from them doesn't change. */
  lastMessageAt: string;
  /** Null on a request, which shows its text only when opened. */
  lastMessage: ChatLastMessageDto | null;
}

export interface ChatDirectResultDto {
  conversation: ChatConversationDto;
  message: ChatMessageDto;
}

/** The thread with a member, if this member's own inbox lists one. Null says nothing about whether the other member has one. */
export interface ChatDirectLookupDto {
  conversationId: string | null;
}

export interface ChatBadgeDto {
  /** Conversations with something unread, not messages. */
  unread: number;
  requests: number;
  /** Group invitations waiting for an answer. They belong on Groups, not Messages. */
  invites: number;
}

/** What a group's owner submitted and what moderation made of it. Only ever sent to its owner. */
export interface ChatGroupReviewDto extends ModerationFields {
  name: string;
  description: string | null;
  /** Whether members can see the group: an admin has approved it and hasn't since rejected or removed it. */
  shownToMembers: boolean;
}

/**
 * A group as one member sees it. Members only ever get the name and description an admin approved, never an edit waiting
 * for review, and nothing here says whether one is waiting.
 */
export interface ChatGroupDto {
  /** Its conversation's id, which its thread opens with. */
  id: string;
  /** The approved name. Its owner sees their own until it's first approved. */
  name: string;
  description: string | null;
  visibility: ChatGroupVisibility;
  memberCount: number;
  /** Null once nobody is left to own it. */
  owner: ChatMemberDto | null;
  archived: boolean;
  /** Null for someone who has never been in it, including anyone with an invitation they can't see. */
  myState: ChatParticipantState | null;
  isOwner: boolean;
  canSend: boolean;
  canJoin: boolean;
  canInvite: boolean;
  canEdit: boolean;
  canLeave: boolean;
  createdAt: string;
  /** Its owner's only. */
  review: ChatGroupReviewDto | null;
}

export interface ChatGroupMemberDto {
  member: ChatMemberDto;
  role: ChatParticipantRole;
  isMe: boolean;
  /** This member blocked them, which hides their messages here. Never says who blocked whom the other way. */
  blockedByMe: boolean;
}

export interface ChatGroupInviteDto {
  group: ChatGroupDto;
  /** Null if they've since deleted their account. */
  invitedBy: ChatMemberDto | null;
  invitedAt: string;
}

/** The same whichever invitations were delivered, because one that wasn't must look exactly like one that was. */
export interface ChatGroupInviteResultDto {
  /** Members asked who weren't in the group already. */
  invited: number;
}

/** A group as an admin reviews it: its name and description, never its messages. */
export interface ChatGroupContentDto extends ModerationFields {
  id: string;
  /** What its owner last submitted, which is what's under review. */
  name: string;
  description: string | null;
  /** What members see while that is reviewed, or null if it has never been approved. */
  approvedName: string | null;
  approvedDescription: string | null;
  visibility: ChatGroupVisibility;
  memberCount: number;
  owner: MemberCardDto | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ChatBlockDto {
  member: ChatMemberDto;
  createdAt: string;
}

export interface ChatReportDto {
  id: string;
  targetKind: ChatReportTargetKind;
  targetId: string;
  reason: ReportReason;
  status: ReportStatus;
  createdAt: string;
}

/**
 * A chat report in a queue, which holds no words anyone wrote: no message, no `details` and no notes, because a reporter's
 * or an admin's words may quote the message. A null member deleted their account.
 */
export interface AdminChatReportDto {
  id: string;
  targetKind: ChatReportTargetKind;
  reason: ReportReason;
  status: ReportStatus;
  reporter: ChatMemberDto | null;
  reported: ChatMemberDto | null;
  resolutionAction: ChatReportAction | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface PlatformChatReportDto extends AdminChatReportDto {
  tenant: { slug: string; name: string };
}

export interface AdminChatReportMessageDto {
  id: string;
  kind: ChatMessageKind;
  /** Null if they deleted their account, and on a system message. */
  sender: ChatMemberDto | null;
  body: string;
  removed: boolean;
  /** The message that was reported, which the rest are shown around. */
  isTarget: boolean;
  createdAt: string;
}

/** What an audited view returns. Never cache this or fetch it without an explicit click, because every fetch writes an audit row. */
export interface AdminChatReportViewDto extends AdminChatReportDto {
  details: string | null;
  /** What a reported request said, for a report on a request rather than a message. */
  noteSnapshot: string | null;
  resolutionNote: string | null;
  /** Oldest first. */
  messages: AdminChatReportMessageDto[];
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
  /** Those this viewer may act on: none naming them, and for Illuminize staff only the escalated ones. */
  openChatReports: number;
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
  /**
   * Its poster can refer people for it, so members may ask them. Always false while referrals are off here, for a viewer who
   * is a current pupil, or when the poster is one.
   */
  canRefer: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The viewer's own latest request for a referral on a job, whatever became of it. */
export interface JobReferralLinkDto {
  id: string;
  /** As its sender sees it: a request its poster never saw reads as REQUESTED, like one they haven't answered yet. */
  status: ReferralStatus;
  createdAt: string;
  /** The chat, once accepted. */
  conversationId: string | null;
}

/**
 * Why the viewer couldn't ask a job's poster for a referral again, whatever the job allows: they've asked about it as many
 * times as anyone may (LIMIT), or they've blocked its poster (YOU_BLOCKED). Never anything the poster did, so a poster who
 * blocked them reads the same as one who didn't.
 */
export type ReferralAskRefusal = "LIMIT" | "YOU_BLOCKED";

/** One job, as its own page shows it: every route that answers with a single job gives this. */
export interface JobDetailDto extends JobDto {
  /** The viewer's own latest request for a referral on this job, or null. Always null for its poster. */
  myReferral: JobReferralLinkDto | null;
  /**
   * Set when something of the viewer's own stands in the way of their asking for a referral on this job, so the apps can say
   * so before a note is written. Null while nothing does, on a job that can't refer (`canRefer` false), and for its poster.
   */
  referralAskRefusal: ReferralAskRefusal | null;
  /** On the poster's own job, the referral requests waiting for their answer that they can see. Null for anyone else. */
  pendingReferralCount: number | null;
}

/** The job a referral request is about, from what it said when the request was sent. */
export interface ReferralJobDto {
  /** Null once the job has been deleted. */
  id: string | null;
  title: string;
  companyName: string;
  /** Whether the viewer can open the job's page now: it may since have been deleted, removed or hidden. */
  available: boolean;
}

/**
 * A referral request as one side of it sees it. Its sender's copy depends only on what they did and what the poster did,
 * so a request the poster never sees reads exactly like one they haven't answered yet, closing with its job included.
 */
export interface ReferralDto {
  id: string;
  /** received: this member posted the job. sent: they asked. */
  box: ReferralBox;
  status: ReferralStatus;
  job: ReferralJobDto;
  /** The other member: who asked on a received request, the poster on a sent one. Null once they've deleted their account: show DELETED_MEMBER_NAME. */
  member: MemberCardDto | null;
  /** The sender's note, which became the chat's first message if accepted. */
  note: string;
  /** The chat an acceptance opened. */
  conversationId: string | null;
  createdAt: string;
  /** When the poster accepted or declined. */
  respondedAt: string | null;
  acceptedAt: string | null;
  /** When it was withdrawn, or closed with its job. */
  closedAt: string | null;
  canAccept: boolean;
  canDecline: boolean;
  /** On a received request that was never accepted and that this member hasn't reported yet, withdrawn and closed ones included. */
  canReport: boolean;
  canWithdraw: boolean;
}

export interface ReferralPageDto extends CursorPage<ReferralDto> {
  /** Requests in this list still waiting for an answer, across every page. */
  waiting: number;
}

/** What a member still has waiting in referrals, which decides whether the apps keep a way into them while they can't use them. */
export interface ReferralSummaryDto {
  /** Requests about their jobs waiting for their answer, as that list shows them. */
  received: number;
  /** Their own requests still waiting for an answer. */
  sent: number;
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

/** A listing as lists show it. No email or phone, so one page of a list isn't a contact scrape. */
export interface BusinessCardDto extends ModerationFields {
  id: string;
  name: string;
  category: BusinessCategory;
  description: string;
  logoUrl: string | null;
  city: string | null;
  websiteUrl: string | null;
  author: MemberCardDto;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A listing on its own page, the only place its contact details appear. */
export interface BusinessDto extends BusinessCardDto {
  contactEmail: string | null;
  contactPhone: string | null;
}

/** Who an announcement would reach, for the confirmation before posting. */
export interface AnnouncementAudienceDto {
  /** Approved members (besides you): all get it in the app. */
  members: number;
  /** Of those, how many have a confirmed email and haven't turned announcement messages off. */
  withEmail: number;
  /** Of those, how many haven't turned announcement messages off (everyone has a phone). */
  withPhone: number;
  /** Channels your plan lets you also send announcements by. */
  channels: MessageChannel[];
}

export interface CountRow {
  label: string;
  count: number;
}

/** Tenant admin analytics for the last N weeks. */
export interface TenantAnalyticsDto {
  timeZone: string;
  /** Monday of each week, oldest first; every series has one value per week. */
  weeks: string[];
  kpis: {
    /** Approved members now. */
    members: number;
    /** Approved during the range, and during the same-length range before it. */
    newMembers: number;
    newMembersPrev: number;
    /** Members who used the app on at least one day of the range (the billing definition). */
    activeMembers: number;
    activeMembersPrev: number;
    posts: number;
    postsPrev: number;
  };
  series: {
    /** Approvals per week. */
    joined: number[];
    /** Sign-ups per week (any outcome). */
    registered: number[];
    /** Members active at least one day that week. */
    active: number[];
    posts: number[];
    comments: number[];
    jobs: number[];
    events: number[];
  };
  coverage: {
    batches: CountRow[];
    cities: CountRow[];
    countries: CountRow[];
    professions: CountRow[];
    /** Approved members, and how many have filled each part of their profile. */
    completeness: { total: number; photo: number; city: number; company: number; birthday: number; linkedin: number; email: number };
    /** Answer counts for the institution's choice and yes/no fields. */
    fields: Array<{ key: string; label: string; options: CountRow[] }>;
  };
  invites: { total: number; sent: number; accepted: number };
}

export interface PlatformComparisonRowDto {
  tenant: TenantSummaryDto & { status: TenantStatus };
  /** Approved at the end of the period (billing definition). */
  approvedMembers: number;
  newMembers: number;
  activeMembers: number;
  /** activeMembers / approvedMembers (0-1). */
  activityRate: number;
  content: { posts: number; jobs: number; events: number };
  messages: Record<MessageChannel, number>;
  plan: { billingModel: BillingModel; billingCycle: BillingCycle; currency: string } | null;
  estimatedAmountMinor: number;
  currency: string;
}

export interface PlatformComparisonDto {
  periodStart: string;
  periodEnd: string;
  timeZone: string;
  rows: PlatformComparisonRowDto[];
}

/** The weekly digest: what happened in the institution in the past week (content still published when read). */
export interface DigestDto {
  /** Monday of the digest's week, in the institution's time zone. */
  weekStart: string;
  createdAt: string;
  posts: Array<{ id: string; excerpt: string; authorName: string; reactionCount: number; commentCount: number }>;
  jobs: Array<{ id: string; title: string; companyName: string; location: string | null; isRemote: boolean }>;
  events: Array<{ id: string; title: string; startAt: string; timezone: string; city: string }>;
  /** Members who joined that week. */
  newMembers: number;
}

/** Someone celebrating today. Never includes a birth year or age. */
export interface CelebrationDto {
  membershipId: string;
  fullName: string;
  avatarUrl: string | null;
  batchYear: number;
  kind: CelebrationKind;
  /** Anniversaries: whole years since joining. */
  years: number | null;
  isMe: boolean;
  wishedByMe: boolean;
  wishCount: number;
}

export interface CelebrationsTodayDto {
  /** Today in the institution's time zone (YYYY-MM-DD). */
  date: string;
  items: CelebrationDto[];
  /** Celebrating today beyond the ones listed. */
  more: number;
  /** Show the one-time "your birthday appears here on the day" notice. */
  showNotice: boolean;
}

export interface PollDto {
  options: Array<{ id: string; label: string; votes: number }>;
  /** People who voted (with several choices allowed, one person counts once here). */
  totalVoters: number;
  allowsMultiple: boolean;
  closesAt: string | null;
  isClosed: boolean;
  /** The viewer's chosen option ids (empty: not voted). */
  myVotes: string[];
}

export interface PostDto extends ModerationFields {
  id: string;
  body: string;
  imageUrls: string[];
  commentCount: number;
  reactionCount: number;
  myReaction: ReactionType | null;
  isPinned: boolean;
  kind: PostKind;
  /** A poll attached to the post (the body is the question). */
  poll: PollDto | null;
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
  authorMembershipId: string | null;
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
  /** Null when the author no longer exists. */
  author: MemberCardDto | null;
  moderationStatus: ModerationStatus;
  moderatedAt: string | null;
  createdAt: string;
  reportCount: number;
  /** Posts only: whether it is pinned to the top of the feed. */
  isPinned: boolean;
  /** Posts only: a regular post or an announcement. */
  kind: PostKind | null;
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

export type ContentDto = JobDto | FundingDto | PostDto | CommentDto | EventDto | BusinessDto | ChatGroupContentDto;

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
