import type { MembershipSummaryDto, UserDto } from "@illuminize/shared";
import type { UserRow } from "../repositories/users.repo";
import type { MembershipRow, TenantRow } from "../types/request";
import { toTenantSummaryDto } from "./tenant.dto";

export function toUserDto(u: UserRow): UserDto {
  return {
    id: u.id,
    phone: u.phoneE164,
    displayName: u.displayName,
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt ? u.emailVerifiedAt.toISOString() : null,
    isPlatformAdmin: u.isPlatformAdmin,
    createdAt: u.createdAt.toISOString(),
  };
}

export function toMembershipSummaryDto(m: MembershipRow, t: TenantRow): MembershipSummaryDto {
  return {
    id: m.id,
    tenant: toTenantSummaryDto(t),
    role: m.role,
    status: m.status,
    statusReason: m.statusReason,
    fullName: m.fullName,
    startYear: m.startYear,
    batchYear: m.batchYear,
    avatarUrl: m.avatarUrl,
  };
}
