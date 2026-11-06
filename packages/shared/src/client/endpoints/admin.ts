import type {
  AdminChatReportsQuery,
  AdminMembersQuery,
  AdminReportsQuery,
  AuditQuery,
  ChatReportResolveInput,
  InvitationImportInput,
  InvitationsQuery,
  MembershipProfileUpdate,
  MembershipRole,
  ModerationActionInput,
  ModerationQuery,
  ProfileFieldCreateInput,
  ProfileFieldUpdateInput,
  ReportResolveInput,
  TenantBrandingUpdate,
  TenantSettingsUpdate,
} from "../..";
import type { ContentType, MembershipStatus, ModerationStatus } from "../../constants";
import type { ContentAction } from "../../lib/admin";
import type { AdminChatReportDto, AdminChatReportViewDto, AdminMemberDetailDto, AdminMemberDto, AdminReportDto, MentorProfileDto, AdminSettingsDto, AnnouncementAudienceDto, AuditDto, TenantAnalyticsDto, InvitationDto, InvitationImportResultDto, InvitationSummaryDto, ProfileFieldDto, ContentDto, DashboardDto, ModerationItemDto, Page, PostDto, ReportDto, TenantPublicDto, TenantSettingsDto } from "../../types/dto";
import type { ApiCore, DownloadAs, QueryParams } from "../core";

const q = (v: Record<string, unknown> | undefined): QueryParams | undefined => v as QueryParams | undefined;

export type ModerationAction = ContentAction;

export interface ModerationResultDto {
  contentType: ContentType;
  id: string;
  from: ModerationStatus;
  to: ModerationStatus;
  content: ContentDto;
}

export function adminEndpoints(core: ApiCore) {
  const p = (slug: string, path: string) => ({ tenantSlug: slug, path: `/admin${path}` });
  return {
    dashboard: (slug: string) => core.data<DashboardDto>(p(slug, "/dashboard")),
    members: {
      list: (slug: string, query?: Partial<AdminMembersQuery>) => core.request<Page<AdminMemberDto>>({ ...p(slug, "/members"), query: q(query) }),
      get: (slug: string, id: string) => core.data<AdminMemberDetailDto>(p(slug, `/members/${id}`)),
      /** `expectedStatus`, the status the admin acted on, makes the API refuse (409) once the member has moved on: see memberApproveSchema. */
      approve: (slug: string, id: string, expectedStatus?: MembershipStatus) =>
        core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/approve`), ...(expectedStatus ? { body: { expectedStatus } } : {}) }),
      reinstate: (slug: string, id: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/reinstate`) }),
      reject: (slug: string, id: string, reason: string, expectedStatus?: MembershipStatus) =>
        core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/reject`), body: { reason, ...(expectedStatus ? { expectedStatus } : {}) } }),
      suspend: (slug: string, id: string, reason: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/suspend`), body: { reason } }),
      approveAllPending: (slug: string) => core.data<{ approved: number }>({ method: "POST", ...p(slug, "/members/approve-all-pending") }),
      setRole: (slug: string, id: string, role: MembershipRole) => core.data<AdminMemberDto>({ method: "PATCH", ...p(slug, `/members/${id}/role`), body: { role } }),
      updateProfile: (slug: string, id: string, input: MembershipProfileUpdate) => core.data<AdminMemberDto>({ method: "PATCH", ...p(slug, `/members/${id}/profile`), body: input }),
    },
    moderation: {
      list: (slug: string, query?: Partial<ModerationQuery>) => core.request<Page<ModerationItemDto>>({ ...p(slug, "/moderation"), query: q(query) }),
      get: (slug: string, contentType: ContentType, id: string) => core.data<ContentDto>(p(slug, `/moderation/${contentType}/${id}`)),
      /** `reviewed` is the name and description an admin approving a group was shown, which the API requires for that. */
      act: (slug: string, contentType: ContentType, id: string, action: ModerationAction, note?: string | null, reviewed?: ModerationActionInput["reviewed"]) =>
        core.data<ModerationResultDto>({ method: "POST", ...p(slug, `/moderation/${contentType}/${id}/${action}`), body: { note: note ?? null, ...(reviewed ? { reviewed } : {}) } }),
      pin: (slug: string, postId: string) => core.data<PostDto>({ method: "POST", ...p(slug, `/moderation/POST/${postId}/pin`) }),
      unpin: (slug: string, postId: string) => core.data<PostDto>({ method: "POST", ...p(slug, `/moderation/POST/${postId}/unpin`) }),
    },
    reports: {
      list: (slug: string, query?: Partial<AdminReportsQuery>) => core.request<Page<AdminReportDto>>({ ...p(slug, "/reports"), query: q(query) }),
      resolve: (slug: string, id: string, input: ReportResolveInput) => core.data<ReportDto>({ method: "POST", ...p(slug, `/reports/${id}/resolve`), body: input }),
      dismiss: (slug: string, id: string, note?: string | null) => core.data<ReportDto>({ method: "POST", ...p(slug, `/reports/${id}/dismiss`), body: { note: note ?? null } }),
    },
    chatReports: {
      list: (slug: string, query?: Partial<AdminChatReportsQuery>) => core.request<Page<AdminChatReportDto>>({ ...p(slug, "/chat-reports"), query: q(query) }),
      /** Writes an audit row each time, so call it only when someone asks to see the messages. Keep the result out of the query cache. */
      view: (slug: string, id: string) => core.data<AdminChatReportViewDto>({ method: "POST", ...p(slug, `/chat-reports/${id}/view`) }),
      resolve: (slug: string, id: string, input: ChatReportResolveInput) => core.data<AdminChatReportDto>({ method: "POST", ...p(slug, `/chat-reports/${id}/resolve`), body: input }),
      dismiss: (slug: string, id: string, note?: string | null) => core.data<AdminChatReportDto>({ method: "POST", ...p(slug, `/chat-reports/${id}/dismiss`), body: { note: note ?? null } }),
    },
    mentors: {
      /** Takes a member out of the Mentors list and declines what's waiting for them. They can offer again, and suspension is there for repeats. */
      remove: (slug: string, membershipId: string) => core.data<MentorProfileDto>({ method: "POST", ...p(slug, `/mentors/${membershipId}/remove`) }),
    },
    analytics: (slug: string, weeks = 12) => core.data<TenantAnalyticsDto>({ ...p(slug, "/analytics"), query: { weeks } }),
    /** CSV downloads (streamed by the server; saved by the caller), as a Blob or, with `{ as: "text" }`, as text. */
    exports: {
      members: <A extends DownloadAs = "blob">(slug: string, read?: { as: A }) => core.download(p(slug, "/exports/members.csv"), read),
      activity: <A extends DownloadAs = "blob">(slug: string, weeks = 12, read?: { as: A }) => core.download({ ...p(slug, "/exports/activity.csv"), query: { weeks } }, read),
    },
    announcements: {
      audience: (slug: string) => core.data<AnnouncementAudienceDto>(p(slug, "/announcements/audience")),
    },
    invitations: {
      list: (slug: string, query?: Partial<InvitationsQuery>) => core.request<Page<InvitationDto>>({ ...p(slug, "/invitations"), query: q(query) }),
      summary: (slug: string) => core.data<InvitationSummaryDto>(p(slug, "/invitations/summary")),
      import: (slug: string, input: InvitationImportInput) => core.data<InvitationImportResultDto>({ method: "POST", ...p(slug, "/invitations/import"), body: input }),
      send: (slug: string, ids: string[]) => core.data<{ queued: number; skipped: number }>({ method: "POST", ...p(slug, "/invitations/send"), body: { ids } }),
      sendPending: (slug: string) => core.data<{ queued: number; skipped: number }>({ method: "POST", ...p(slug, "/invitations/send-pending") }),
      revoke: (slug: string, id: string) => core.data<InvitationDto>({ method: "POST", ...p(slug, `/invitations/${id}/revoke`) }),
    },
    profileFields: {
      list: (slug: string, includeArchived = false) => core.data<ProfileFieldDto[]>({ ...p(slug, "/profile-fields"), query: { includeArchived: includeArchived ? "true" : undefined } }),
      create: (slug: string, input: ProfileFieldCreateInput) => core.data<ProfileFieldDto>({ method: "POST", ...p(slug, "/profile-fields"), body: input }),
      update: (slug: string, id: string, input: ProfileFieldUpdateInput) => core.data<ProfileFieldDto>({ method: "PATCH", ...p(slug, `/profile-fields/${id}`), body: input }),
      reorder: (slug: string, ids: string[]) => core.data<ProfileFieldDto[]>({ method: "POST", ...p(slug, "/profile-fields/reorder"), body: { ids } }),
      archive: (slug: string, id: string) => core.data<ProfileFieldDto>({ method: "POST", ...p(slug, `/profile-fields/${id}/archive`) }),
      restore: (slug: string, id: string) => core.data<ProfileFieldDto>({ method: "POST", ...p(slug, `/profile-fields/${id}/restore`) }),
    },
    settings: {
      get: (slug: string) => core.data<AdminSettingsDto>(p(slug, "/settings")),
      update: (slug: string, input: TenantSettingsUpdate) => core.data<TenantSettingsDto>({ method: "PATCH", ...p(slug, "/settings"), body: input }),
      updateBranding: (slug: string, input: TenantBrandingUpdate) => core.data<TenantPublicDto>({ method: "PATCH", ...p(slug, "/branding"), body: input }),
    },
    audit: {
      list: (slug: string, query?: Partial<AuditQuery>) => core.request<Page<AuditDto>>({ ...p(slug, "/audit"), query: q(query) }),
    },
  };
}
