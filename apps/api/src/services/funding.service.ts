import type { CursorPage, FundingCreateInput, FundingDto, FundingListQuery, FundingUpdateInput } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toFundingDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { deleteFunding, findFundingWithAuthor, insertFunding, listFunding, updateFunding } from "../repositories/funding.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor, viewerOf } from "./content.common";

function fundingColumns(input: FundingCreateInput | FundingUpdateInput) {
  const out: Record<string, unknown> = {};
  for (const key of ["title", "stage", "amountMinMinor", "amountMaxMinor", "currency", "pitch", "sectors", "websiteUrl", "contactEmail", "contactPhone"] as const) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  return out;
}

export async function listTenantFunding(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: FundingListQuery): Promise<CursorPage<FundingDto>> {
  const page = await listFunding(ctx.db, tenantCtx.tenant.id, query, actor.membership.id);
  return { data: page.data.map((r) => toFundingDto(r, viewerOf(actor))), nextCursor: page.nextCursor };
}

export async function createFunding(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: FundingCreateInput): Promise<FundingDto> {
  const status = initialStatusFor(tenantCtx, actor, "FUNDING");
  const row = await insertFunding(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    authorMembershipId: actor.membership.id,
    kind: input.kind,
    title: input.title,
    pitch: input.pitch,
    ...fundingColumns(input),
    moderationStatus: status,
    moderatedAt: status === "APPROVED" ? new Date() : null,
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "FUNDING", id: row.id, title: row.title, status, action: "create" });
  return toFundingDto({ listing: row, author: actor.membership }, viewerOf(actor));
}

export async function getFunding(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<FundingDto> {
  const found = await findFundingWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Funding listing not found");
  assertCanView(actor, found.listing.moderationStatus, found.listing.authorMembershipId, "Funding listing", found.author.status);
  return toFundingDto(found, viewerOf(actor));
}

export async function getFundingForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<FundingDto> {
  const found = await findFundingWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Funding listing not found");
  return toFundingDto(found, viewerOf(actor));
}

export async function updateFundingListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: FundingUpdateInput): Promise<FundingDto> {
  const found = await findFundingWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Funding listing not found");
  assertAuthor(actor, found.listing.authorMembershipId);
  const status = statusAfterEdit(tenantCtx, actor, found.listing.moderationStatus);
  const row = (await updateFunding(ctx.db, tenantCtx.tenant.id, id, {
    ...fundingColumns(input),
    moderationStatus: status,
    moderationNote: status === found.listing.moderationStatus ? found.listing.moderationNote : null,
  }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "FUNDING", id, title: row.title, status, action: "update" });
  return toFundingDto({ listing: row, author: found.author }, viewerOf(actor));
}

export async function removeFundingListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const found = await findFundingWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Funding listing not found");
  assertAuthor(actor, found.listing.authorMembershipId);
  await deleteFunding(ctx.db, tenantCtx.tenant.id, id);
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "FUNDING", id, title: found.listing.title, status: found.listing.moderationStatus, action: "delete" });
}

export async function closeFundingListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<FundingDto> {
  const found = await findFundingWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Funding listing not found");
  assertAuthor(actor, found.listing.authorMembershipId);
  const row = (await updateFunding(ctx.db, tenantCtx.tenant.id, id, { isClosed: true }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "FUNDING", id, title: row.title, status: row.moderationStatus, action: "close" });
  return toFundingDto({ listing: row, author: found.author }, viewerOf(actor));
}
