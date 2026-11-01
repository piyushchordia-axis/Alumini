import type { CursorPage, DirectoryFiltersDto, DirectoryQuery, MemberCardDto, MemberProfileDto } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toMemberCardDto, toMemberProfileDto } from "../dto/membership.dto";
import { AppError } from "../lib/errors";
import { keys } from "../redis/keys";
import { directoryFacets, findApprovedMemberWithUser, searchDirectory } from "../repositories/directory.repo";
import { openToWorkSet } from "../repositories/memberships.repo";
import { answersForOne, getActiveFields } from "./profileFields.service";

export async function searchMembers(ctx: AppContext, tenantId: string, query: DirectoryQuery): Promise<CursorPage<MemberCardDto>> {
  const page = await searchDirectory(ctx.db, tenantId, query);
  const open = await openToWorkSet(
    ctx.db,
    tenantId,
    page.data.map((m) => m.id),
  );
  return { data: page.data.map((m) => toMemberCardDto(m, open.has(m.id))), nextCursor: page.nextCursor };
}

export async function getDirectoryFilters(ctx: AppContext, tenantId: string): Promise<DirectoryFiltersDto> {
  const key = keys.cacheDirectoryFilters(tenantId);
  const cached = await ctx.redis.get(key);
  if (cached) return JSON.parse(cached) as DirectoryFiltersDto;
  const [facets, fields] = await Promise.all([directoryFacets(ctx.db, tenantId), getActiveFields(ctx, tenantId)]);
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

export async function getMemberProfile(ctx: AppContext, tenantId: string, membershipId: string): Promise<MemberProfileDto> {
  const found = await findApprovedMemberWithUser(ctx.db, tenantId, membershipId);
  if (!found) throw AppError.notFound("Member not found");
  const [open, fields] = await Promise.all([openToWorkSet(ctx.db, tenantId, [membershipId]), answersForOne(ctx, tenantId, membershipId, "public")]);
  return toMemberProfileDto(found.membership, found.user, open.has(membershipId), fields);
}
