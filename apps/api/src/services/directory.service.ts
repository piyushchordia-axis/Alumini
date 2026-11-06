import { isCurrentPupil, mentorshipAvailable, resolveFeatures, type CursorPage, type DirectoryCardDto, type DirectoryFiltersDto, type DirectoryQuery, type MemberProfileDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toMemberCardDto, toMemberProfileDto } from "../dto/membership.dto";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";
import { directoryFacets, findApprovedMemberWithUser, searchDirectory } from "../repositories/directory.repo";
import { openToWorkSet } from "../repositories/memberships.repo";
import { listedMentorsAmong } from "../repositories/mentorship.repo";
import type { MembershipRow, TenantContext, TenantRow } from "../types/request";
import { answersForOne, getActiveFields } from "./profileFields.service";

/**
 * A page of the directory. `isMentor` says who the Mentors list would show this viewer, so it's false for everyone while
 * mentorship is off here or the viewer can't use it, and for anyone they blocked, whom that list leaves out.
 */
export async function searchMembers(ctx: AppContext, tenantCtx: TenantContext, viewer: MembershipRow, query: DirectoryQuery): Promise<CursorPage<DirectoryCardDto>> {
  const { tenant, settings } = tenantCtx;
  const now = new Date();
  const page = await searchDirectory(ctx.db, tenant, query, now);
  const ids = page.data.map((m) => m.id);
  const mentors = mentorshipAvailable(resolveFeatures(tenant.type, settings.features), !isCurrentPupil(tenant, viewer, now)) ? listedMentorsAmong(ctx.db, tenant, viewer.id, ids, now) : Promise.resolve(new Set<string>());
  const [open, mentoring] = await Promise.all([openToWorkSet(ctx.db, tenant.id, ids), mentors]);
  return {
    data: page.data.map((m) => ({ ...toMemberCardDto(m, open.has(m.id)), isMentor: mentoring.has(m.id), openTo: isCurrentPupil(tenant, m, now) ? [] : m.openTo })),
    nextCursor: page.nextCursor,
  };
}

export async function getDirectoryFilters(ctx: AppContext, tenant: Pick<TenantRow, "id" | "timezone">): Promise<DirectoryFiltersDto> {
  const key = keys.cacheDirectoryFilters(tenant.id);
  const cached = await ctx.redis.get(key);
  if (cached) return JSON.parse(cached) as DirectoryFiltersDto;
  const [facets, fields] = await Promise.all([directoryFacets(ctx.db, tenant), getActiveFields(ctx, tenant.id)]);
  const out: DirectoryFiltersDto = {
    ...facets,
    fields: fields
      .filter((f) => f.filterable && f.visibility === "MEMBERS")
      .map((f) => ({
        key: f.key,
        label: f.label,
        options: f.type === "BOOLEAN" ? [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] : f.options,
      })),
  };
  await ctx.redis.set(key, JSON.stringify(out), "EX", 300);
  return out;
}

/** `isMentor` follows the directory's rule (see searchMembers). */
export async function getMemberProfile(ctx: AppContext, tenantCtx: TenantContext, viewer: MembershipRow, membershipId: string): Promise<MemberProfileDto> {
  const { tenant, settings } = tenantCtx;
  const tenantId = tenant.id;
  const found = await findApprovedMemberWithUser(ctx.db, tenantId, membershipId);
  if (!found) throw AppError.notFound("Member not found");
  const now = new Date();
  const features = resolveFeatures(tenant.type, settings.features);
  const viewerIsPupil = isCurrentPupil(tenant, viewer, now);
  // Deliberately says nothing about blocks, in either direction: this would be how a blocked member found out.
  const canMessage = features.messaging && viewer.id !== membershipId && !viewerIsPupil && !isCurrentPupil(tenant, found.membership, now);
  const mentors = mentorshipAvailable(features, !viewerIsPupil) ? listedMentorsAmong(ctx.db, tenant, viewer.id, [membershipId], now) : Promise.resolve(new Set<string>());
  const [open, fields, mentoring] = await Promise.all([openToWorkSet(ctx.db, tenantId, [membershipId]), answersForOne(ctx, tenantId, membershipId, "public"), mentors]);
  return toMemberProfileDto(found.membership, found.user, {
    tenant,
    viewerMembershipId: viewer.id,
    isOpenToWork: open.has(membershipId),
    isMentor: mentoring.has(membershipId),
    canMessage,
    fields,
    now,
  });
}
