import type {
  AssignAdminInput,
  AuditQuery,
  BillingPlanCreateInput,
  BillingPlanUpdateInput,
  BillingUsageQuery,
  PlatformTenantCreateInput,
  PlatformTenantUpdateInput,
  PlatformTenantsQuery,
  PlatformTestMessageInput,
  PlatformUsersQuery,
  SnapshotCreateInput,
  TenantSettingsUpdate,
} from "../..";
import type { AdminMemberDto, AuditDto, BillingPlanDto, BillingSnapshotDto, BillingUsageDto, OutboundMessageDto, Page, PlatformStatsDto, PlatformTenantDto, PlatformTenantRowDto, PlatformUserDto, TenantSettingsDto } from "../../types/dto";
import type { ApiCore, QueryParams } from "../core";

const q = (v: Record<string, unknown> | undefined): QueryParams | undefined => v as QueryParams | undefined;

export function platformEndpoints(core: ApiCore) {
  const path = (p: string) => `/platform${p}`;
  return {
    tenants: {
      list: (query?: Partial<PlatformTenantsQuery>) => core.request<Page<PlatformTenantRowDto>>({ path: path("/tenants"), query: q(query) }),
      create: (input: PlatformTenantCreateInput) => core.data<PlatformTenantDto>({ method: "POST", path: path("/tenants"), body: input }),
      get: (tenantId: string) => core.data<PlatformTenantDto>({ path: path(`/tenants/${tenantId}`) }),
      update: (tenantId: string, input: PlatformTenantUpdateInput) => core.data<PlatformTenantDto>({ method: "PATCH", path: path(`/tenants/${tenantId}`), body: input }),
      updateSettings: (tenantId: string, input: TenantSettingsUpdate) => core.data<TenantSettingsDto>({ method: "PATCH", path: path(`/tenants/${tenantId}/settings`), body: input }),
      admins: {
        list: (tenantId: string) => core.data<AdminMemberDto[]>({ path: path(`/tenants/${tenantId}/admins`) }),
        add: (tenantId: string, input: AssignAdminInput) => core.data<AdminMemberDto>({ method: "POST", path: path(`/tenants/${tenantId}/admins`), body: input }),
        remove: (tenantId: string, membershipId: string) => core.request<void>({ method: "DELETE", path: path(`/tenants/${tenantId}/admins/${membershipId}`) }),
      },
    },
    billing: {
      get: (tenantId: string) => core.data<{ currentPlan: BillingPlanDto | null; plans: BillingPlanDto[]; snapshots: BillingSnapshotDto[]; timeZone: string }>({ path: path(`/tenants/${tenantId}/billing`) }),
      createPlan: (tenantId: string, input: BillingPlanCreateInput) => core.data<BillingPlanDto>({ method: "POST", path: path(`/tenants/${tenantId}/billing/plans`), body: input }),
      updatePlan: (planId: string, input: BillingPlanUpdateInput) => core.data<BillingPlanDto>({ method: "PATCH", path: path(`/billing/plans/${planId}`), body: input }),
      usage: (tenantId: string, query?: Partial<BillingUsageQuery>) => core.data<BillingUsageDto>({ path: path(`/tenants/${tenantId}/billing/usage`), query: q(query) }),
      createSnapshot: (tenantId: string, input: SnapshotCreateInput) => core.data<BillingSnapshotDto>({ method: "POST", path: path(`/tenants/${tenantId}/billing/snapshots`), body: input }),
    },
    stats: () => core.data<PlatformStatsDto>({ path: path("/stats") }),
    users: {
      list: (query?: Partial<PlatformUsersQuery>) => core.request<Page<PlatformUserDto>>({ path: path("/users"), query: q(query) }),
      setPlatformAdmin: (userId: string, enabled: boolean) => core.data<PlatformUserDto>({ method: "POST", path: path(`/users/${userId}/platform-admin`), body: { enabled } }),
    },
    audit: {
      list: (query?: Partial<AuditQuery>) => core.request<Page<AuditDto>>({ path: path("/audit"), query: q(query) }),
    },
    messages: {
      /** Sends the platform test message (checks WhatsApp/SMS/email configuration). */
      test: (input: PlatformTestMessageInput) => core.data<OutboundMessageDto>({ method: "POST", path: path("/messages/test"), body: input }),
      get: (id: string) => core.data<OutboundMessageDto>({ path: path(`/messages/${id}`) }),
    },
  };
}
