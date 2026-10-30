import type { AdminMembersQuery, AdminReportsQuery, AuditQuery, MembershipProfileUpdate, MembershipRole, ModerationQuery, ReportResolveInput, TenantBrandingUpdate, TenantSettingsUpdate } from "../..";
import type { ContentType, ModerationStatus } from "../../constants";
import type { AdminMemberDto, AdminReportDto, AuditDto, ContentDto, DashboardDto, ModerationItemDto, Page, PostDto, ReportDto, TenantPublicDto, TenantSettingsDto } from "../../types/dto";
import type { ApiCore, QueryParams } from "../core";

const q = (v: Record<string, unknown> | undefined): QueryParams | undefined => v as QueryParams | undefined;

export type ModerationAction = "approve" | "reject" | "remove" | "restore";

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
      get: (slug: string, id: string) => core.data<AdminMemberDto & { audit: AuditDto[] }>(p(slug, `/members/${id}`)),
      approve: (slug: string, id: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/approve`) }),
      reinstate: (slug: string, id: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/reinstate`) }),
      reject: (slug: string, id: string, reason: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/reject`), body: { reason } }),
      suspend: (slug: string, id: string, reason: string) => core.data<AdminMemberDto>({ method: "POST", ...p(slug, `/members/${id}/suspend`), body: { reason } }),
      approveAllPending: (slug: string) => core.data<{ approved: number }>({ method: "POST", ...p(slug, "/members/approve-all-pending") }),
      setRole: (slug: string, id: string, role: MembershipRole) => core.data<AdminMemberDto>({ method: "PATCH", ...p(slug, `/members/${id}/role`), body: { role } }),
      updateProfile: (slug: string, id: string, input: MembershipProfileUpdate) => core.data<AdminMemberDto>({ method: "PATCH", ...p(slug, `/members/${id}/profile`), body: input }),
    },
    moderation: {
      list: (slug: string, query?: Partial<ModerationQuery>) => core.request<Page<ModerationItemDto>>({ ...p(slug, "/moderation"), query: q(query) }),
      get: (slug: string, contentType: ContentType, id: string) => core.data<ContentDto>(p(slug, `/moderation/${contentType}/${id}`)),
      act: (slug: string, contentType: ContentType, id: string, action: ModerationAction, note?: string | null) =>
        core.data<ModerationResultDto>({ method: "POST", ...p(slug, `/moderation/${contentType}/${id}/${action}`), body: { note: note ?? null } }),
      pin: (slug: string, postId: string) => core.data<PostDto>({ method: "POST", ...p(slug, `/moderation/POST/${postId}/pin`) }),
      unpin: (slug: string, postId: string) => core.data<PostDto>({ method: "POST", ...p(slug, `/moderation/POST/${postId}/unpin`) }),
    },
    reports: {
      list: (slug: string, query?: Partial<AdminReportsQuery>) => core.request<Page<AdminReportDto>>({ ...p(slug, "/reports"), query: q(query) }),
      resolve: (slug: string, id: string, input: ReportResolveInput) => core.data<ReportDto>({ method: "POST", ...p(slug, `/reports/${id}/resolve`), body: input }),
      dismiss: (slug: string, id: string, note?: string | null) => core.data<ReportDto>({ method: "POST", ...p(slug, `/reports/${id}/dismiss`), body: { note: note ?? null } }),
    },
    settings: {
      get: (slug: string) => core.data<{ settings: TenantSettingsDto; branding: TenantPublicDto }>(p(slug, "/settings")),
      update: (slug: string, input: TenantSettingsUpdate) => core.data<TenantSettingsDto>({ method: "PATCH", ...p(slug, "/settings"), body: input }),
      updateBranding: (slug: string, input: TenantBrandingUpdate) => core.data<TenantPublicDto>({ method: "PATCH", ...p(slug, "/branding"), body: input }),
    },
    audit: {
      list: (slug: string, query?: Partial<AuditQuery>) => core.request<Page<AuditDto>>({ ...p(slug, "/audit"), query: q(query) }),
    },
  };
}
