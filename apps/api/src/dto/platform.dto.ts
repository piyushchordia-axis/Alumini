import type { BillingPlanDto, BillingSnapshotDto, PlatformTenantRowDto, PlatformUserDto, TenantCountsDto } from "@illuminize/shared";
import type { BillingPlanRow, BillingSnapshotRow } from "../repositories/billing.repo";
import type { TenantCountsRow } from "../repositories/tenants.repo";
import type { UserRow } from "../repositories/users.repo";
import type { MembershipRow, TenantRow } from "../types/request";
import { toTenantSummaryDto } from "./tenant.dto";
import { toMembershipSummaryDto, toUserDto } from "./user.dto";

export function toTenantCountsDto(c: TenantCountsRow): TenantCountsDto {
  return {
    approvedMembers: c.approvedMembers,
    pendingMembers: c.pendingMembers,
    suspendedMembers: c.suspendedMembers,
    activeMembers30d: c.activeMembers30d,
    newMembers30d: c.newMembers30d,
  };
}

export function toPlatformTenantRowDto(t: TenantRow, c: TenantCountsRow): PlatformTenantRowDto {
  return { ...toTenantSummaryDto(t), status: t.status, createdAt: t.createdAt.toISOString(), counts: toTenantCountsDto(c), billingModel: c.billingModel };
}

export function toBillingPlanDto(p: BillingPlanRow): BillingPlanDto {
  return {
    id: p.id,
    tenantId: p.tenantId,
    billingModel: p.billingModel,
    billingCycle: p.billingCycle,
    currency: p.currency,
    pricePerActiveUserMinor: p.pricePerActiveUserMinor,
    flatFeeMinor: p.flatFeeMinor,
    effectiveFrom: p.effectiveFrom,
    effectiveTo: p.effectiveTo,
    notes: p.notes,
    includedChannels: p.includedChannels,
    messageRatesMinor: p.messageRatesMinor,
    createdAt: p.createdAt.toISOString(),
  };
}

export function toBillingSnapshotDto(s: BillingSnapshotRow): BillingSnapshotDto {
  return {
    id: s.id,
    tenantId: s.tenantId,
    billingPlanId: s.billingPlanId,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    approvedMemberCount: s.approvedMemberCount,
    activeMemberCount: s.activeMemberCount,
    newMemberCount: s.newMemberCount,
    messageCounts: s.messageCounts,
    messageAmountMinor: s.messageAmountMinor,
    amountMinor: s.amountMinor,
    currency: s.currency,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toPlatformUserDto(u: UserRow, memberships: Array<{ membership: MembershipRow; tenant: TenantRow }>): PlatformUserDto {
  return {
    ...toUserDto(u),
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    memberships: memberships.map((m) => toMembershipSummaryDto(m.membership, m.tenant)),
  };
}
