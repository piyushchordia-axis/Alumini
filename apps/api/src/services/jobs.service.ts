import type { CursorPage, JobCreateInput, JobDto, JobListQuery, JobSeekerDto, JobSeekerUpsertInput, JobUpdateInput } from "@illuminize/shared";
import type { AppContext } from "../context";
import { toJobDto, toJobSeekerDto } from "../dto/content.dto";
import { AppError } from "../lib/errors";
import { deleteJob, deleteSeeker, findJobWithAuthor, findSeeker, insertJob, listJobs, listSeekers, updateJob, upsertSeeker } from "../repositories/jobs.repo";
import type { TenantContext } from "../types/request";
import { afterContentWrite, assertAuthor, assertCanView, initialStatusFor, statusAfterEdit, type ContentActor, viewerOf } from "./content.common";

function jobColumns(input: JobCreateInput | JobUpdateInput) {
  const out: Record<string, unknown> = {};
  for (const key of ["title", "companyName", "location", "isRemote", "jobType", "description", "applyUrl", "contactEmail", "contactPhone", "salaryRange"] as const) {
    if (input[key] !== undefined) out[key] = input[key];
  }
  if (input.expiresAt !== undefined) out.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  return out;
}

export async function listTenantJobs(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, query: JobListQuery): Promise<CursorPage<JobDto>> {
  const page = await listJobs(ctx.db, tenantCtx.tenant.id, query, actor.membership.id);
  return { data: page.data.map((r) => toJobDto(r, viewerOf(actor))), nextCursor: page.nextCursor };
}

export async function createJob(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, input: JobCreateInput): Promise<JobDto> {
  const status = initialStatusFor(tenantCtx, actor, "JOB");
  const row = await insertJob(ctx.db, {
    tenantId: tenantCtx.tenant.id,
    authorMembershipId: actor.membership.id,
    title: input.title,
    companyName: input.companyName,
    jobType: input.jobType,
    description: input.description,
    ...jobColumns(input),
    moderationStatus: status,
    moderatedAt: status === "APPROVED" ? new Date() : null,
  });
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id: row.id, title: row.title, status, action: "create" });
  return toJobDto({ job: row, author: actor.membership }, viewerOf(actor));
}

export async function getJob(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Job not found");
  assertCanView(actor, found.job.moderationStatus, found.job.authorMembershipId, "Job", found.author.status);
  return toJobDto(found, viewerOf(actor));
}

export async function getJobForAdmin(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Job not found");
  return toJobDto(found, viewerOf(actor));
}

export async function updateJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string, input: JobUpdateInput): Promise<JobDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Job not found");
  assertAuthor(actor, found.job.authorMembershipId);
  const status = statusAfterEdit(tenantCtx, actor, found.job.moderationStatus);
  const row = (await updateJob(ctx.db, tenantCtx.tenant.id, id, {
    ...jobColumns(input),
    moderationStatus: status,
    moderationNote: status === found.job.moderationStatus ? found.job.moderationNote : null,
  }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: row.title, status, action: "update" });
  return toJobDto({ job: row, author: found.author }, viewerOf(actor));
}

export async function removeJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<void> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Job not found");
  assertAuthor(actor, found.job.authorMembershipId);
  await deleteJob(ctx.db, tenantCtx.tenant.id, id);
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: found.job.title, status: found.job.moderationStatus, action: "delete" });
}

export async function closeJobListing(ctx: AppContext, tenantCtx: TenantContext, actor: ContentActor, id: string): Promise<JobDto> {
  const found = await findJobWithAuthor(ctx.db, tenantCtx.tenant.id, id);
  if (!found) throw AppError.notFound("Job not found");
  assertAuthor(actor, found.job.authorMembershipId);
  const row = (await updateJob(ctx.db, tenantCtx.tenant.id, id, { isClosed: true }))!;
  await afterContentWrite(ctx, tenantCtx, actor, { contentType: "JOB", id, title: row.title, status: row.moderationStatus, action: "close" });
  return toJobDto({ job: row, author: found.author }, viewerOf(actor));
}

// ---- seekers ----

export async function listJobSeekers(ctx: AppContext, tenantId: string, query: { cursor?: string; limit: number }): Promise<CursorPage<JobSeekerDto>> {
  const page = await listSeekers(ctx.db, tenantId, query);
  return { data: page.data.map((r) => toJobSeekerDto(r.seeker, r.member)), nextCursor: page.nextCursor };
}

export async function getMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor): Promise<JobSeekerDto | null> {
  const row = await findSeeker(ctx.db, tenantId, actor.membership.id);
  return row ? toJobSeekerDto(row, actor.membership) : null;
}

export async function upsertMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor, input: JobSeekerUpsertInput): Promise<JobSeekerDto> {
  const row = await upsertSeeker(ctx.db, {
    tenantId,
    membershipId: actor.membership.id,
    note: input.note,
    preferredRoles: input.preferredRoles ?? null,
    preferredLocations: input.preferredLocations ?? null,
    isActive: input.isActive ?? true,
  });
  return toJobSeekerDto(row, actor.membership);
}

export async function deleteMySeekerProfile(ctx: AppContext, tenantId: string, actor: ContentActor): Promise<void> {
  await deleteSeeker(ctx.db, tenantId, actor.membership.id);
}
