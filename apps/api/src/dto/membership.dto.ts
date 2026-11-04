import {
  PROFILE_MAX_EDUCATION,
  isCurrentPupil,
  profileLinkSchemas,
  sortEducation,
  type AdminMemberDto,
  type AuditDto,
  type MemberCardDto,
  type MemberProfileDto,
  type MembershipDto,
  type NotificationDto,
  type PortableProfileDto,
  type ProfileFieldAnswerDto,
  type ProfileLinkKey,
} from "@illuminize/shared";
import type { AuditRow } from "../repositories/audit.repo";
import type { NotificationRow } from "../repositories/notifications.repo";
import type { UserRow } from "../repositories/users.repo";
import type { MembershipRow, TenantRow } from "../types/request";
import { toTenantSummaryDto } from "./tenant.dto";

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

function membershipFields(m: MembershipRow, fields: ProfileFieldAnswerDto[]): Omit<MembershipDto, "chatEligible" | "profileNudgeDismissedAt"> {
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
    headline: m.headline,
    industry: m.industry,
    careerStartYear: m.careerStartYear,
    skills: m.skills,
    degree: m.degree,
    fieldOfStudy: m.fieldOfStudy,
    experiences: m.experiences,
    education: m.education,
    websiteUrl: m.websiteUrl,
    githubUrl: m.githubUrl,
    instagramUrl: m.instagramUrl,
    xUrl: m.xUrl,
    openTo: m.openTo,
    fields,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/** `fields`: the answers this viewer may see (load them with answersFor). */
export function toMembershipDto(m: MembershipRow, tenant: Pick<TenantRow, "type" | "timezone">, fields: ProfileFieldAnswerDto[] = []): MembershipDto {
  return {
    ...membershipFields(m, fields),
    chatEligible: m.status === "APPROVED" && !isCurrentPupil(tenant, m),
    profileNudgeDismissedAt: iso(m.profileNudgeDismissedAt),
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
    headline: m.headline,
  };
}

export interface MemberProfileView {
  tenant: Pick<TenantRow, "type" | "timezone">;
  viewerMembershipId: string;
  isOpenToWork: boolean;
  isMentor: boolean;
  canMessage: boolean;
  /** The answers members may see. */
  fields: ProfileFieldAnswerDto[];
  now?: Date;
}

type ProfileLinks = Pick<MemberProfileDto, ProfileLinkKey>;

/**
 * The member's links as the profile's rules take them today (see profileLinkSchemas), each null if it fails them. The
 * LinkedIn check used to accept any text with "linkedin.com/" in it ("https://evil.com/?linkedin.com/"); migration 0028
 * cleared those, and this keeps any other link saved under an older rule from reaching other members or another
 * institution's registration form, which would refuse it.
 */
function linksOf(m: MembershipRow): ProfileLinks {
  const checked = (key: ProfileLinkKey): string | null => {
    const url = m[key];
    if (url === null) return null;
    const parsed = profileLinkSchemas[key].safeParse(url);
    return parsed.success ? parsed.data : null;
  };
  return { linkedinUrl: checked("linkedinUrl"), websiteUrl: checked("websiteUrl"), githubUrl: checked("githubUrl"), instagramUrl: checked("instagramUrl"), xUrl: checked("xUrl") };
}

const NO_LINKS: ProfileLinks = { linkedinUrl: null, websiteUrl: null, githubUrl: null, instagramUrl: null, xUrl: null };

/** A member's profile as another member (or they themself) opens it. Nobody else sees a current pupil's links or Open to. */
export function toMemberProfileDto(m: MembershipRow, user: Pick<UserRow, "phoneE164">, view: MemberProfileView): MemberProfileDto {
  const hide = view.viewerMembershipId !== m.id && isCurrentPupil(view.tenant, m, view.now);
  return {
    ...toMemberCardDto(m, view.isOpenToWork),
    bio: m.bio,
    interests: m.interests,
    industry: m.industry,
    careerStartYear: m.careerStartYear,
    skills: m.skills,
    degree: m.degree,
    fieldOfStudy: m.fieldOfStudy,
    experiences: m.experiences,
    education: m.education,
    ...(hide ? NO_LINKS : linksOf(m)),
    openTo: hide ? [] : m.openTo,
    isMentor: view.isMentor,
    fields: view.fields,
    phone: m.isPhoneVisible ? user.phoneE164 : null,
    memberSince: m.createdAt.toISOString(),
    canMessage: view.canMessage,
  };
}

/**
 * The member's details at `tenant` that they may take to another institution (see PortableProfileDto). Their degree and
 * field there become an entry of studies elsewhere, named after it, unless they already list it; the list keeps to
 * PROFILE_MAX_EDUCATION so it can be saved as it is. Their date of birth isn't offered when they keep their birthday off
 * that institution's feed: a new profile celebrates it until they turn that off, so copying it would show it.
 */
export function toPortableProfileDto(m: MembershipRow, tenant: TenantRow): PortableProfileDto {
  const listed = m.education.some((e) => e.institution.trim().toLowerCase() === tenant.name.trim().toLowerCase());
  const here = (m.degree || m.fieldOfStudy) && !listed ? [{ institution: tenant.name, degree: m.degree, fieldOfStudy: m.fieldOfStudy, startYear: null, endYear: null }] : [];
  return {
    source: toTenantSummaryDto(tenant),
    headline: m.headline,
    companyName: m.companyName,
    designation: m.designation,
    industry: m.industry,
    careerStartYear: m.careerStartYear,
    skills: m.skills,
    experiences: m.experiences,
    education: sortEducation([...m.education, ...here]).slice(0, PROFILE_MAX_EDUCATION),
    ...linksOf(m),
    openTo: m.openTo,
    bio: m.bio,
    interests: m.interests,
    city: m.city,
    country: m.country,
    dateOfBirth: m.celebrateBirthday ? m.dateOfBirth : null,
  };
}

export function toAdminMemberDto(m: MembershipRow, user: UserRow, fields: ProfileFieldAnswerDto[] = []): AdminMemberDto {
  return {
    ...membershipFields(m, fields),
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
