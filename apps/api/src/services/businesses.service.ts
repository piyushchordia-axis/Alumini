import { MAX_BUSINESS_LISTINGS, type BusinessCardDto, type BusinessCreateInput, type BusinessDto, type BusinessListQuery, type BusinessUpdateInput, type CursorPage } from "@illuminize/shared";
import type { AppContext } from "../context";
import type { DbClient } from "../db/client";
import { toBusinessCardDto, toBusinessDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { runInTransaction } from "../lib/transaction";
import { countLiveBusinessesByAuthor, deleteBusiness, findBusinessWithAuthor, insertBusiness, listBusinesses, updateBusiness } from "../repositories/businesses.repo";
import { lockMembership } from "../repositories/memberships.repo";
import { resolveOpenReportsForContent } from "../repositories/reports.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor, viewerOf } from "./content.common";

export async function listTenantBusinesses(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: BusinessListQuery): Promise<CursorPage<BusinessCardDto>> {
  const page = await listBusinesses(ctx.db, tenantCtx.tenant.id, query, actor.membership.id);
  return { data: page.data.map((r) => toBusinessCardDto(r, viewerOf(actor))), nextCursor: page.nextCursor };
}

/** Holds the author's row until the transaction ends, or two writers could both count four and end on six. */
export async function hasRoomForBusiness(tx: DbClient, tenantId: string, authorMembershipId: string): Promise<boolean> {
  await lockMembership(tx, tenantId, authorMembershipId);
  return (await countLiveBusinessesByAuthor(tx, tenantId, authorMembershipId)) < MAX_BUSINESS_LISTINGS;
}

export async function createBusiness(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: BusinessCreateInput): Promise<BusinessDto> {
  const tenantId = tenantCtx.tenant.id;
  const status = initialStatusFor(tenantCtx, actor, "BUSINESS");
  const row = await runInTransaction(ctx, async (tx) => {
    if (!(await hasRoomForBusiness(tx, tenantId, actor.membership.id))) {
      throw AppError.conflict(`You can have up to ${MAX_BUSINESS_LISTINGS} business listings. Delete one to add another.`);
    }
    return insertBusiness(tx, { ...input, tenantId, authorMembershipId: actor.membership.id, moderationStatus: status, moderatedAt: status === "APPROVED" ? new Date() : null });
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "BUSINESS", id: row.id, title: row.name, status, action: "create" });
  return toBusinessDto({ listing: row, author: actor.membership }, viewerOf(actor));
}

export async function getBusiness(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<BusinessDto> {
  const found = await findBusinessWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Business listing not found");
  assertCanView(actor, found.listing.moderationStatus, found.listing.authorMembershipId, "Business listing", found.author.status);
  return toBusinessDto(found, viewerOf(actor));
}

export async function getBusinessForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<BusinessDto> {
  const found = await findBusinessWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Business listing not found");
  return toBusinessDto(found, viewerOf(actor));
}

export async function updateBusinessListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: BusinessUpdateInput): Promise<BusinessDto> {
  const tenantId = tenantCtx.tenant.id;
  const { row, author, status } = await runInTransaction(ctx, async (tx) => {
    // Locked until the write. The status comes from this read, so an admin's removal landing after it would be overwritten and the listing published again.
    const found = await findBusinessWithAuthor(tx, tenantId, id, true);
    if (!found) throw AppError.notFound("Business listing not found");
    assertAuthor(actor, found.listing.authorMembershipId);
    const status = statusAfterEdit(tenantCtx, actor, found.listing.moderationStatus);
    const row = await updateBusiness(tx, tenantId, id, {
      ...input,
      moderationStatus: status,
      moderationNote: status === found.listing.moderationStatus ? found.listing.moderationNote : null,
    });
    if (!row) throw AppError.notFound("Business listing not found");
    return { row, author: found.author, status };
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "BUSINESS", id, title: row.name, status, action: "update" });
  return toBusinessDto({ listing: row, author }, viewerOf(actor));
}

export async function removeBusinessListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const tenantId = tenantCtx.tenant.id;
  const found = await findBusinessWithAuthor(ctx.db, tenantId, id);
  if (!found) throw AppError.notFound("Business listing not found");
  assertAuthor(actor, found.listing.authorMembershipId);
  await runInTransaction(ctx, async (tx) => {
    await deleteBusiness(tx, tenantId, id);
    // No foreign key ties a report to its content, so an open one would be left pointing at nothing.
    await resolveOpenReportsForContent(tx, tenantId, "BUSINESS", id, { resolvedByUserId: actor.userId, resolutionNote: "auto: author deleted" });
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "BUSINESS", id, title: found.listing.name, status: found.listing.moderationStatus, action: "delete" });
}
