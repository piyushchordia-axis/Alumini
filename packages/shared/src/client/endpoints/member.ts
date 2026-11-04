import type { AttendeesQuery, BusinessCreateInput, BusinessListQuery, BusinessUpdateInput, ChatConversationsQuery, ChatDirectCreateInput, ChatGroupCandidatesQuery, ChatGroupCreateInput, ChatGroupsQuery, ChatGroupUpdateInput, ChatMessageCreateInput, ChatMessagesQuery, ChatMuteInput, ChatReadInput, ChatReportCreateInput, CommentCreateInput, DirectoryQuery, EventCreateInput, EventListQuery, EventUpdateInput, FundingCreateInput, FundingListQuery, FundingUpdateInput, JobCreateInput, JobListQuery, JobSeekerUpsertInput, JobUpdateInput, MembershipProfileInput, MembershipProfileUpdate, MentorProfileUpsertInput, MentorsQuery, MentorshipRequestCreateInput, MentorshipRequestsQuery, NotificationPrefsUpdate, ReferralRequestCreateInput, ReferralRequestsQuery, NotificationsQuery, PaymentConfirmInput, PostCreateInput, PostListQuery, PostUpdateInput, ReportCreateInput, CursorQuery } from "../..";
import type {
  CommentDto,
  CursorPage,
  DirectoryCardDto,
  DirectoryFiltersDto,
  EventDto,
  BusinessCardDto,
  BusinessDto,
  ChatBadgeDto,
  ChatBlockDto,
  ChatConversationDto,
  ChatDirectLookupDto,
  ChatDirectResultDto,
  ChatGroupDto,
  ChatGroupInviteDto,
  ChatGroupInviteResultDto,
  ChatGroupMemberDto,
  ChatMemberDto,
  ChatMessageDto,
  ChatReportDto,
  FundingDto,
  JobDetailDto,
  JobCardDto,
  JobSeekerDto,
  MemberCardDto,
  MemberProfileDto,
  MembershipDto,
  MentorCardDto,
  MentorDto,
  MentorProfileDto,
  MentorshipDto,
  MentorshipPageDto,
  MentorshipSummaryDto,
  NotificationDto,
  MyInvitationDto,
  NotificationPrefsDto,
  CelebrationsTodayDto,
  DigestDto,
  PollDto,
  ProfileFieldDto,
  PaymentOrderDto,
  PostDto,
  PostPageDto,
  ReactionEntryDto,
  ReactionSummaryDto,
  ReferralDto,
  ReferralPageDto,
  ReferralSummaryDto,
  ReportDto,
  RsvpSummaryDto,
  UploadResultDto,
} from "../../types/dto";
import type { CelebrationKind, ReactionType, RsvpStatus } from "../../constants";
import type { ApiCore, QueryParams } from "../core";

type Q = Record<string, unknown> | undefined;
const q = (v: Q): QueryParams | undefined => v as QueryParams | undefined;

export function membershipEndpoints(core: ApiCore) {
  return {
    /** An open invitation for the signed-in person's phone (prefills registration), or null. */
    invitation: (slug: string) => core.data<MyInvitationDto | null>({ path: "/memberships/invitation", tenantSlug: slug }),
    /** The institution's own profile questions (for registration and profile forms). */
    profileFields: (slug: string) => core.data<ProfileFieldDto[]>({ path: "/profile-fields", tenantSlug: slug }),
    register: (slug: string, input: MembershipProfileInput) => core.data<MembershipDto>({ method: "POST", path: "/memberships", tenantSlug: slug, body: input }),
    me: (slug: string) => core.data<MembershipDto>({ path: "/memberships/me", tenantSlug: slug }),
    updateMe: (slug: string, input: MembershipProfileUpdate) => core.data<MembershipDto>({ method: "PATCH", path: "/memberships/me", tenantSlug: slug, body: input }),
  };
}

export function directoryEndpoints(core: ApiCore) {
  return {
    /** `field`: custom-field filters as "key:value". */
    search: (slug: string, query?: Partial<Omit<DirectoryQuery, "field">> & { field?: string[] }) => core.request<CursorPage<DirectoryCardDto>>({ path: "/directory", tenantSlug: slug, query: q(query) }),
    filters: (slug: string) => core.data<DirectoryFiltersDto>({ path: "/directory/filters", tenantSlug: slug }),
    profile: (slug: string, membershipId: string) => core.data<MemberProfileDto>({ path: `/directory/${membershipId}`, tenantSlug: slug }),
  };
}

export function jobEndpoints(core: ApiCore) {
  const referralAction = (name: "accept" | "decline" | "withdraw") => (slug: string, id: string) => core.data<ReferralDto>({ method: "POST", path: `/jobs/referrals/${id}/${name}`, tenantSlug: slug });
  return {
    list: (slug: string, query?: Partial<JobListQuery>) => core.request<CursorPage<JobCardDto>>({ path: "/jobs", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: JobCreateInput) => core.data<JobDetailDto>({ method: "POST", path: "/jobs", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<JobDetailDto>({ path: `/jobs/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: JobUpdateInput) => core.data<JobDetailDto>({ method: "PATCH", path: `/jobs/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/jobs/${id}`, tenantSlug: slug }),
    close: (slug: string, id: string) => core.data<JobDetailDto>({ method: "POST", path: `/jobs/${id}/close`, tenantSlug: slug }),
    referrals: {
      /** Asks the job's poster for a referral, with a note they'll read. */
      request: (slug: string, jobId: string, input: ReferralRequestCreateInput) => core.data<ReferralDto>({ method: "POST", path: `/jobs/${jobId}/referrals`, tenantSlug: slug, body: input }),
      /** The requests about one of the member's own jobs. Only its poster may ask. */
      forJob: (slug: string, jobId: string, query?: Partial<CursorQuery>) => core.request<ReferralPageDto>({ path: `/jobs/${jobId}/referrals`, tenantSlug: slug, query: q(query) }),
      /** The member's own requests: received, about their jobs, or sent. Works while referrals are off, as a way out. */
      mine: (slug: string, query?: Partial<ReferralRequestsQuery>) => core.request<ReferralPageDto>({ path: "/jobs/referrals/mine", tenantSlug: slug, query: q(query) }),
      /** How many requests wait in each list, even while referrals are off for them. */
      summary: (slug: string) => core.data<ReferralSummaryDto>({ path: "/jobs/referrals/summary", tenantSlug: slug }),
      accept: referralAction("accept"),
      decline: referralAction("decline"),
      withdraw: referralAction("withdraw"),
      /** Reports a received request's note to the institution's admins, who see only the note. One still waiting is declined. */
      report: (slug: string, id: string, input: ChatReportCreateInput) => core.data<ReferralDto>({ method: "POST", path: `/jobs/referrals/${id}/report`, tenantSlug: slug, body: input }),
    },
    seekers: {
      list: (slug: string, query?: Partial<CursorQuery>) => core.request<CursorPage<JobSeekerDto>>({ path: "/jobs/seekers", tenantSlug: slug, query: q(query) }),
      me: (slug: string) => core.data<JobSeekerDto | null>({ path: "/jobs/seekers/me", tenantSlug: slug }),
      upsert: (slug: string, input: JobSeekerUpsertInput) => core.data<JobSeekerDto>({ method: "PUT", path: "/jobs/seekers/me", tenantSlug: slug, body: input }),
      remove: (slug: string) => core.request<void>({ method: "DELETE", path: "/jobs/seekers/me", tenantSlug: slug }),
    },
  };
}

export function fundingEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<FundingListQuery>) => core.request<CursorPage<FundingDto>>({ path: "/funding", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: FundingCreateInput) => core.data<FundingDto>({ method: "POST", path: "/funding", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<FundingDto>({ path: `/funding/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: FundingUpdateInput) => core.data<FundingDto>({ method: "PATCH", path: `/funding/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/funding/${id}`, tenantSlug: slug }),
    close: (slug: string, id: string) => core.data<FundingDto>({ method: "POST", path: `/funding/${id}/close`, tenantSlug: slug }),
  };
}

export function businessEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<BusinessListQuery>) => core.request<CursorPage<BusinessCardDto>>({ path: "/businesses", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: BusinessCreateInput) => core.data<BusinessDto>({ method: "POST", path: "/businesses", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<BusinessDto>({ path: `/businesses/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: BusinessUpdateInput) => core.data<BusinessDto>({ method: "PATCH", path: `/businesses/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/businesses/${id}`, tenantSlug: slug }),
  };
}

export function chatEndpoints(core: ApiCore) {
  return {
    /** Sends to a member, opening the thread if there isn't one: the first message goes as a request. */
    direct: (slug: string, input: ChatDirectCreateInput) => core.data<ChatDirectResultDto>({ method: "POST", path: "/chat/direct", tenantSlug: slug, body: input }),
    directThread: (slug: string, membershipId: string) => core.data<ChatDirectLookupDto>({ path: `/chat/direct/${membershipId}`, tenantSlug: slug }),
    conversations: (slug: string, query?: Partial<ChatConversationsQuery>) => core.request<CursorPage<ChatConversationDto>>({ path: "/chat/conversations", tenantSlug: slug, query: q(query) }),
    conversation: (slug: string, id: string) => core.data<ChatConversationDto>({ path: `/chat/conversations/${id}`, tenantSlug: slug }),
    /** Newest first by `cursor`, or oldest first after `afterSeq`, where `nextCursor` means more came after this page than it holds. */
    messages: (slug: string, id: string, query?: Partial<ChatMessagesQuery>) => core.request<CursorPage<ChatMessageDto>>({ path: `/chat/conversations/${id}/messages`, tenantSlug: slug, query: q(query) }),
    send: (slug: string, id: string, input: ChatMessageCreateInput, options?: { signal?: AbortSignal }) =>
      core.data<ChatMessageDto>({ method: "POST", path: `/chat/conversations/${id}/messages`, tenantSlug: slug, body: input, signal: options?.signal }),
    read: (slug: string, id: string, input: ChatReadInput) => core.data<{ lastReadSeq: number }>({ method: "POST", path: `/chat/conversations/${id}/read`, tenantSlug: slug, body: input }),
    mute: (slug: string, id: string, input: ChatMuteInput) => core.data<ChatConversationDto>({ method: "PUT", path: `/chat/conversations/${id}/mute`, tenantSlug: slug, body: input }),
    accept: (slug: string, id: string) => core.data<ChatConversationDto>({ method: "POST", path: `/chat/conversations/${id}/accept`, tenantSlug: slug }),
    decline: (slug: string, id: string) => core.data<ChatConversationDto>({ method: "POST", path: `/chat/conversations/${id}/decline`, tenantSlug: slug }),
    badge: (slug: string) => core.data<ChatBadgeDto>({ path: "/chat/badge", tenantSlug: slug }),
    blocks: (slug: string, query?: Partial<CursorQuery>) => core.request<CursorPage<ChatBlockDto>>({ path: "/chat/blocks", tenantSlug: slug, query: q(query) }),
    block: (slug: string, membershipId: string) => core.data<ChatBlockDto>({ method: "POST", path: "/chat/blocks", tenantSlug: slug, body: { membershipId } }),
    unblock: (slug: string, membershipId: string) => core.request<void>({ method: "DELETE", path: `/chat/blocks/${membershipId}`, tenantSlug: slug }),
    report: (slug: string, messageId: string, input: ChatReportCreateInput) => core.data<ChatReportDto>({ method: "POST", path: `/chat/messages/${messageId}/report`, tenantSlug: slug, body: input }),
    groups: {
      /** DISCOVER (open groups, searchable by name), MINE or OWNED. */
      list: (slug: string, query?: Partial<ChatGroupsQuery>) => core.request<CursorPage<ChatGroupDto>>({ path: "/chat/groups", tenantSlug: slug, query: q(query) }),
      create: (slug: string, input: ChatGroupCreateInput) => core.data<ChatGroupDto>({ method: "POST", path: "/chat/groups", tenantSlug: slug, body: input }),
      invites: (slug: string, query?: Partial<CursorQuery>) => core.request<CursorPage<ChatGroupInviteDto>>({ path: "/chat/groups/invites", tenantSlug: slug, query: q(query) }),
      get: (slug: string, id: string) => core.data<ChatGroupDto>({ path: `/chat/groups/${id}`, tenantSlug: slug }),
      update: (slug: string, id: string, input: Pick<ChatGroupUpdateInput, "name" | "description">) => core.data<ChatGroupDto>({ method: "PATCH", path: `/chat/groups/${id}`, tenantSlug: slug, body: input }),
      archive: (slug: string, id: string) => core.data<ChatGroupDto>({ method: "PATCH", path: `/chat/groups/${id}`, tenantSlug: slug, body: { archived: true } }),
      members: (slug: string, id: string, query?: Partial<CursorQuery>) => core.request<CursorPage<ChatGroupMemberDto>>({ path: `/chat/groups/${id}/members`, tenantSlug: slug, query: q(query) }),
      inviteCandidates: (slug: string, id: string, query?: Partial<ChatGroupCandidatesQuery>) => core.data<ChatMemberDto[]>({ path: `/chat/groups/${id}/invite-candidates`, tenantSlug: slug, query: q(query) }),
      join: (slug: string, id: string) => core.data<ChatGroupDto>({ method: "POST", path: `/chat/groups/${id}/join`, tenantSlug: slug }),
      /** Answers nothing, because an invite-only group is gone from view the moment its member leaves. */
      leave: (slug: string, id: string) => core.request<void>({ method: "POST", path: `/chat/groups/${id}/leave`, tenantSlug: slug }),
      invite: (slug: string, id: string, membershipIds: string[]) => core.data<ChatGroupInviteResultDto>({ method: "POST", path: `/chat/groups/${id}/invites`, tenantSlug: slug, body: { membershipIds } }),
      accept: (slug: string, id: string) => core.data<ChatGroupDto>({ method: "POST", path: `/chat/groups/${id}/invites/accept`, tenantSlug: slug }),
      decline: (slug: string, id: string) => core.request<void>({ method: "POST", path: `/chat/groups/${id}/invites/decline`, tenantSlug: slug }),
      removeMember: (slug: string, id: string, membershipId: string) => core.request<void>({ method: "DELETE", path: `/chat/groups/${id}/members/${membershipId}`, tenantSlug: slug }),
    },
  };
}

export function mentorshipEndpoints(core: ApiCore) {
  const action = (name: "accept" | "decline" | "withdraw" | "end") => (slug: string, id: string) => core.data<MentorshipDto>({ method: "POST", path: `/mentorship/requests/${id}/${name}`, tenantSlug: slug });
  return {
    /** This member's own mentor profile, active or not, or null if they never offered. */
    me: (slug: string) => core.data<MentorProfileDto | null>({ path: "/mentorship/me", tenantSlug: slug }),
    /** Offers to mentor, or edits the profile. */
    saveMe: (slug: string, input: MentorProfileUpsertInput) => core.data<MentorProfileDto>({ method: "PUT", path: "/mentorship/me", tenantSlug: slug, body: input }),
    /** Stops mentoring: declines what's waiting and leaves mentorships under way as they are. */
    stop: (slug: string) => core.request<void>({ method: "DELETE", path: "/mentorship/me", tenantSlug: slug }),
    /** Whether they're listed, and how many requests and mentorships they have open, even while mentorship is off for them. */
    summary: (slug: string) => core.data<MentorshipSummaryDto>({ path: "/mentorship/summary", tenantSlug: slug }),
    mentors: (slug: string, query?: Partial<MentorsQuery>) => core.request<CursorPage<MentorCardDto>>({ path: "/mentorship/mentors", tenantSlug: slug, query: q(query) }),
    mentor: (slug: string, membershipId: string) => core.data<MentorDto>({ path: `/mentorship/mentors/${membershipId}`, tenantSlug: slug }),
    request: (slug: string, input: MentorshipRequestCreateInput) => core.data<MentorshipDto>({ method: "POST", path: "/mentorship/requests", tenantSlug: slug, body: input }),
    requests: (slug: string, query?: Partial<MentorshipRequestsQuery>) => core.request<MentorshipPageDto>({ path: "/mentorship/requests", tenantSlug: slug, query: q(query) }),
    accept: action("accept"),
    decline: action("decline"),
    withdraw: action("withdraw"),
    end: action("end"),
    /** Reports a received request's note to the institution's admins, who see only the note. One still waiting is declined. */
    report: (slug: string, id: string, input: ChatReportCreateInput) => core.data<MentorshipDto>({ method: "POST", path: `/mentorship/requests/${id}/report`, tenantSlug: slug, body: input }),
  };
}

export function celebrationEndpoints(core: ApiCore) {
  return {
    today: (slug: string) => core.data<CelebrationsTodayDto>({ path: "/celebrations/today", tenantSlug: slug }),
    /** The latest weekly digest, or null before the first one. */
    digest: (slug: string) => core.data<DigestDto | null>({ path: "/digest/latest", tenantSlug: slug }),
    wish: (slug: string, membershipId: string, kind: CelebrationKind) => core.data<{ wishCount: number }>({ method: "POST", path: `/celebrations/${membershipId}/wishes`, tenantSlug: slug, body: { kind } }),
  };
}

export function postEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<PostListQuery>) => core.request<PostPageDto>({ path: "/posts", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: PostCreateInput) => core.data<PostDto>({ method: "POST", path: "/posts", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<PostDto>({ path: `/posts/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: PostUpdateInput) => core.data<PostDto>({ method: "PATCH", path: `/posts/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/posts/${id}`, tenantSlug: slug }),
    poll: {
      /** Replaces the caller's vote with these options. */
      vote: (slug: string, postId: string, optionIds: string[]) => core.data<PollDto>({ method: "PUT", path: `/posts/${postId}/poll/vote`, tenantSlug: slug, body: { optionIds } }),
      clear: (slug: string, postId: string) => core.data<PollDto>({ method: "DELETE", path: `/posts/${postId}/poll/vote`, tenantSlug: slug }),
    },
    comments: {
      list: (slug: string, postId: string, query?: Partial<CursorQuery>) => core.request<CursorPage<CommentDto>>({ path: `/posts/${postId}/comments`, tenantSlug: slug, query: q(query) }),
      create: (slug: string, postId: string, input: CommentCreateInput) => core.data<CommentDto>({ method: "POST", path: `/posts/${postId}/comments`, tenantSlug: slug, body: input }),
      remove: (slug: string, postId: string, commentId: string) => core.request<void>({ method: "DELETE", path: `/posts/${postId}/comments/${commentId}`, tenantSlug: slug }),
    },
    reactions: {
      set: (slug: string, postId: string, type: ReactionType) => core.data<ReactionSummaryDto>({ method: "PUT", path: `/posts/${postId}/reactions`, tenantSlug: slug, body: { type } }),
      clear: (slug: string, postId: string) => core.data<ReactionSummaryDto>({ method: "DELETE", path: `/posts/${postId}/reactions`, tenantSlug: slug }),
      list: (slug: string, postId: string, query?: Partial<CursorQuery> & { type?: ReactionType }) => core.request<CursorPage<ReactionEntryDto>>({ path: `/posts/${postId}/reactions`, tenantSlug: slug, query: q(query) }),
    },
  };
}

export function eventEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<EventListQuery>) => core.request<CursorPage<EventDto>>({ path: "/events", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: EventCreateInput) => core.data<EventDto>({ method: "POST", path: "/events", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<EventDto>({ path: `/events/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: EventUpdateInput) => core.data<EventDto>({ method: "PATCH", path: `/events/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/events/${id}`, tenantSlug: slug }),
    cancel: (slug: string, id: string, reason?: string | null) => core.data<EventDto>({ method: "POST", path: `/events/${id}/cancel`, tenantSlug: slug, body: { reason: reason ?? null } }),
    rsvp: (slug: string, id: string, status: RsvpStatus) => core.data<RsvpSummaryDto>({ method: "PUT", path: `/events/${id}/rsvp`, tenantSlug: slug, body: { status } }),
    clearRsvp: (slug: string, id: string) => core.data<RsvpSummaryDto>({ method: "DELETE", path: `/events/${id}/rsvp`, tenantSlug: slug }),
    attendees: (slug: string, id: string, query?: Partial<AttendeesQuery>) => core.request<CursorPage<MemberCardDto>>({ path: `/events/${id}/attendees`, tenantSlug: slug, query: q(query) }),
  };
}

export function reportEndpoints(core: ApiCore) {
  return {
    create: (slug: string, input: ReportCreateInput) => core.data<ReportDto>({ method: "POST", path: "/reports", tenantSlug: slug, body: input }),
    mine: (slug: string, query?: Partial<CursorQuery>) => core.request<CursorPage<ReportDto>>({ path: "/reports/mine", tenantSlug: slug, query: q(query) }),
  };
}

export function notificationEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<NotificationsQuery>) => core.request<CursorPage<NotificationDto>>({ path: "/notifications", tenantSlug: slug, query: q(query) }),
    unreadCount: (slug: string) => core.data<{ count: number }>({ path: "/notifications/unread-count", tenantSlug: slug }),
    markRead: (slug: string, id: string) => core.request<void>({ method: "POST", path: `/notifications/${id}/read`, tenantSlug: slug }),
    markAllRead: (slug: string) => core.request<void>({ method: "POST", path: "/notifications/read-all", tenantSlug: slug }),
    prefs: (slug: string) => core.data<NotificationPrefsDto>({ path: "/notification-prefs", tenantSlug: slug }),
    updatePrefs: (slug: string, input: NotificationPrefsUpdate) => core.data<NotificationPrefsDto>({ method: "PATCH", path: "/notification-prefs", tenantSlug: slug, body: input }),
  };
}

export interface NativeFile {
  uri: string;
  name: string;
  type: string;
}

export function uploadEndpoints(core: ApiCore) {
  return {
    upload: (slug: string, file: Blob | NativeFile, filename = "image.jpg") => {
      const formData = new FormData();
      if (typeof Blob !== "undefined" && file instanceof Blob) formData.append("file", file, (file as File).name || filename);
      else formData.append("file", file as unknown as Blob);
      return core.data<UploadResultDto>({ method: "POST", path: "/uploads", tenantSlug: slug, formData });
    },
  };
}

export function paymentEndpoints(core: ApiCore) {
  return {
    get: (slug: string, id: string) => core.data<PaymentOrderDto>({ path: `/payments/${id}`, tenantSlug: slug }),
    /** After the provider's checkout succeeds: the server verifies the payment and marks the order paid. */
    confirm: (slug: string, id: string, input: PaymentConfirmInput) => core.data<PaymentOrderDto>({ method: "POST", path: `/payments/${id}/confirm`, tenantSlug: slug, body: input }),
    /** Development only (mock provider): simulates a successful checkout and returns what to confirm with. */
    mockCheckout: (slug: string, id: string) => core.data<PaymentConfirmInput>({ method: "POST", path: `/payments/${id}/mock-checkout`, tenantSlug: slug }),
  };
}
