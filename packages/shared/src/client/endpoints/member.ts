import type { AttendeesQuery, CommentCreateInput, DirectoryQuery, EventCreateInput, EventListQuery, EventUpdateInput, FundingCreateInput, FundingListQuery, FundingUpdateInput, JobCreateInput, JobListQuery, JobSeekerUpsertInput, JobUpdateInput, MembershipProfileInput, MembershipProfileUpdate, NotificationPrefsUpdate, NotificationsQuery, PaymentConfirmInput, PostCreateInput, PostListQuery, PostUpdateInput, ReportCreateInput, CursorQuery } from "../..";
import type {
  CommentDto,
  CursorPage,
  DirectoryFiltersDto,
  EventDto,
  FundingDto,
  JobDto,
  JobSeekerDto,
  MemberCardDto,
  MemberProfileDto,
  MembershipDto,
  NotificationDto,
  MyInvitationDto,
  NotificationPrefsDto,
  ProfileFieldDto,
  PaymentOrderDto,
  PostDto,
  PostPageDto,
  ReactionEntryDto,
  ReactionSummaryDto,
  ReportDto,
  RsvpSummaryDto,
  UploadResultDto,
} from "../../types/dto";
import type { ReactionType, RsvpStatus } from "../../constants";
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
    search: (slug: string, query?: Partial<Omit<DirectoryQuery, "field">> & { field?: string[] }) => core.request<CursorPage<MemberCardDto>>({ path: "/directory", tenantSlug: slug, query: q(query) }),
    filters: (slug: string) => core.data<DirectoryFiltersDto>({ path: "/directory/filters", tenantSlug: slug }),
    profile: (slug: string, membershipId: string) => core.data<MemberProfileDto>({ path: `/directory/${membershipId}`, tenantSlug: slug }),
  };
}

export function jobEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<JobListQuery>) => core.request<CursorPage<JobDto>>({ path: "/jobs", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: JobCreateInput) => core.data<JobDto>({ method: "POST", path: "/jobs", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<JobDto>({ path: `/jobs/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: JobUpdateInput) => core.data<JobDto>({ method: "PATCH", path: `/jobs/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/jobs/${id}`, tenantSlug: slug }),
    close: (slug: string, id: string) => core.data<JobDto>({ method: "POST", path: `/jobs/${id}/close`, tenantSlug: slug }),
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

export function postEndpoints(core: ApiCore) {
  return {
    list: (slug: string, query?: Partial<PostListQuery>) => core.request<PostPageDto>({ path: "/posts", tenantSlug: slug, query: q(query) }),
    create: (slug: string, input: PostCreateInput) => core.data<PostDto>({ method: "POST", path: "/posts", tenantSlug: slug, body: input }),
    get: (slug: string, id: string) => core.data<PostDto>({ path: `/posts/${id}`, tenantSlug: slug }),
    update: (slug: string, id: string, input: PostUpdateInput) => core.data<PostDto>({ method: "PATCH", path: `/posts/${id}`, tenantSlug: slug, body: input }),
    remove: (slug: string, id: string) => core.request<void>({ method: "DELETE", path: `/posts/${id}`, tenantSlug: slug }),
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
