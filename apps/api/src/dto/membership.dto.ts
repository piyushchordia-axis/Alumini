import type { AdminMemberDto, AuditDto, MemberCardDto, MemberProfileDto, MembershipDto, NotificationDto, ProfileFieldAnswerDto } from "@illuminize/shared";
import type { AuditRow } from "../repositories/audit.repo";
import type { NotificationRow } from "../repositories/notifications.repo";
import type { UserRow } from "../repositories/users.repo";
import type { MembershipRow } from "../types/request";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** `fields`: the answers this viewer may see (load them with answersFor). */
export function toMembershipDto(m: MembershipRow, fields: ProfileFieldAnswerDto[] = []): MembershipDto {
  return {
    id: m.id,
    tenantId: m.tenantId,
    role: m.role,
    status: m.status,
    statusReason: m.statusReason,
    statusChangedAt: iso(m.statusChangedAt),
    fullName: m.fullName,
    batchYear: m.batchYear,
    dateOfBirth: m.dateOfBirth,
    professionType: m.professionType,
    companyName: m.companyName,
    designation: m.designation,
    city: m.city,
    country: m.country,
    maritalStatus: m.maritalStatus,
    kidsCount: m.kidsCount,
    bio: m.bio,
    linkedinUrl: m.linkedinUrl,
    interests: m.interests,
    avatarUrl: m.avatarUrl,
    isPhoneVisible: m.isPhoneVisible,
    celebrateBirthday: m.celebrateBirthday,
    celebrateAnniversary: m.celebrateAnniversary,
    fields,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export function toMemberCardDto(m: MembershipRow, isOpenToWork = false): MemberCardDto {
  return {
    id: m.id,
    fullName: m.fullName,
    batchYear: m.batchYear,
    professionType: m.professionType,
    companyName: m.companyName,
    designation: m.designation,
    city: m.city,
    country: m.country,
    avatarUrl: m.avatarUrl,
    role: m.role,
    isOpenToWork,
  };
}

export function toMemberProfileDto(m: MembershipRow, user: Pick<UserRow, "phoneE164">, isOpenToWork = false, fields: ProfileFieldAnswerDto[] = []): MemberProfileDto {
  return {
    ...toMemberCardDto(m, isOpenToWork),
    bio: m.bio,
    linkedinUrl: m.linkedinUrl,
    interests: m.interests,
    fields,
    phone: m.isPhoneVisible ? user.phoneE164 : null,
    memberSince: m.createdAt.toISOString(),
  };
}

export function toAdminMemberDto(m: MembershipRow, user: UserRow, fields: ProfileFieldAnswerDto[] = []): AdminMemberDto {
  return {
    ...toMembershipDto(m, fields),
    userId: user.id,
    phone: user.phoneE164,
    lastActiveAt: iso(m.lastActiveAt),
    lastLoginAt: iso(user.lastLoginAt),
  };
}

export function toNotificationDto(n: NotificationRow): NotificationDto {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    data: n.data,
    readAt: iso(n.readAt),
    createdAt: n.createdAt.toISOString(),
  };
}

export function toAuditDto(a: AuditRow, actorName: string | null = null): AuditDto {
  return {
    id: a.id,
    tenantId: a.tenantId,
    actorUserId: a.actorUserId,
    actorMembershipId: a.actorMembershipId,
    actorName,
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    metadata: a.metadata,
    createdAt: a.createdAt.toISOString(),
  };
}
